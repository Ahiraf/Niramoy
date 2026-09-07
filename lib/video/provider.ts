/**
 * Niramoy — video consultation
 * -----------------------------------------------------------------------------
 * A provider interface, because the consultation itself is the one part of this
 * platform we should not be building. What matters here is not which vendor is
 * used but what is true regardless of vendor:
 *
 *   - Rooms are created SERVER-SIDE. Provider credentials never reach a browser.
 *   - A join token is minted per participant, per request, and expires. There is
 *     no long-lived URL that grants entry, and none is stored.
 *   - Only the two people on the appointment can obtain a token, and only in a
 *     window around the appointment time.
 *   - Recording is off. Turning it on is a separate feature requiring separate
 *     consent and a retention policy, not a flag someone flips (brief §14).
 */

import { createHmac, randomBytes } from "node:crypto";

import { getEnv } from "../config/env";
import { AppError } from "../errors";

export type VideoRole = "doctor" | "patient";

export interface RoomHandle {
  /** Our name for the room. Not a URL and not a credential. */
  roomName: string;
  /** The provider's own identifier, when it issues one. */
  providerRoomId: string | null;
  expiresAt: Date;
}

export interface JoinGrant {
  /** Where the client connects. May embed a short-lived token. */
  url: string;
  /** Passed to the provider's SDK. Short-lived. Never persisted. */
  token: string;
  expiresAt: Date;
  provider: string;
  /** Signals to the UI that no real provider is configured. */
  isDemo: boolean;
  /**
   * A URL a plain <iframe> may load to carry the actual media, with the token
   * already attached. Null when the provider needs an SDK, or when there is no
   * media to carry at all. The UI renders a frame when this is present and says
   * so plainly when it is not, so a placeholder is never mistaken for a call.
   */
  embedUrl: string | null;
}

export interface VideoProvider {
  readonly name: string;
  createRoom(input: { appointmentId: string; expiresAt: Date }): Promise<RoomHandle>;
  getJoinToken(input: {
    room: RoomHandle;
    userId: string;
    displayName: string;
    role: VideoRole;
    ttlSeconds: number;
  }): Promise<JoinGrant>;
  endRoom(room: RoomHandle): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Demo provider (default)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The default when no video credentials are configured.
 *
 * It issues a real, signed, expiring token so that the authorization path is
 * exercised exactly as it would be in production — the token is verifiable and
 * scoped to one participant and one room. What it does not do is carry media.
 * `isDemo` is surfaced to the UI, which says so plainly rather than presenting
 * a placeholder as a working consultation.
 */
const demoProvider: VideoProvider = {
  name: "demo",

  async createRoom({ appointmentId, expiresAt }) {
    return {
      roomName: `niramoy-${appointmentId}`,
      providerRoomId: null,
      expiresAt,
    };
  },

  async getJoinToken({ room, userId, role, ttlSeconds }) {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const payload = `${room.roomName}.${userId}.${role}.${expiresAt.getTime()}`;
    const signature = createHmac("sha256", getEnv().sessionSecret ?? "dev")
      .update(payload)
      .digest("base64url");

    return {
      url: `/consultation/${encodeURIComponent(room.roomName)}`,
      token: `${Buffer.from(payload).toString("base64url")}.${signature}`,
      expiresAt,
      provider: "demo",
      isDemo: true,
      embedUrl: null,
    };
  },

  async endRoom() {
    /* nothing to tear down */
  },
};

/* -------------------------------------------------------------------------- */
/* Daily                                                                       */
/* -------------------------------------------------------------------------- */

function dailyProvider(apiKey: string, domain: string | undefined): VideoProvider {
  const api = "https://api.daily.co/v1";

  const request = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const res = await fetch(`${api}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new AppError("PROVIDER_UNAVAILABLE", {
        meta: { provider: "daily", status: res.status, path },
      });
    }
    return res.json();
  };

  return {
    name: "daily",

    async createRoom({ appointmentId, expiresAt }) {
      // A random suffix so a room name cannot be guessed from an appointment id.
      const roomName = `niramoy-${appointmentId.slice(0, 8)}-${randomBytes(6).toString("hex")}`;

      const room = (await request("/rooms", {
        method: "POST",
        body: JSON.stringify({
          name: roomName,
          privacy: "private", // entry requires a token, always
          properties: {
            exp: Math.floor(expiresAt.getTime() / 1000),
            enable_recording: false, // see brief §14
            enable_chat: true,
            enable_knocking: false,
            eject_at_room_exp: true,
          },
        }),
      })) as { name: string; id?: string };

      return { roomName: room.name, providerRoomId: room.id ?? null, expiresAt };
    },

    async getJoinToken({ room, userId, displayName, role, ttlSeconds }) {
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

      const token = (await request("/meeting-tokens", {
        method: "POST",
        body: JSON.stringify({
          properties: {
            room_name: room.roomName,
            user_id: userId,
            user_name: displayName,
            // The doctor runs the consultation.
            is_owner: role === "doctor",
            exp: Math.floor(expiresAt.getTime() / 1000),
            enable_recording: false,
          },
        }),
      })) as { token: string };

      const url = `https://${domain ?? "niramoy"}.daily.co/${room.roomName}`;

      return {
        url,
        token: token.token,
        expiresAt,
        provider: "daily",
        isDemo: false,
        embedUrl: `${url}?t=${encodeURIComponent(token.token)}`,
      };
    },

    async endRoom(room) {
      await request(`/rooms/${encodeURIComponent(room.roomName)}`, { method: "DELETE" }).catch(
        () => {
          /* already gone */
        },
      );
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Jitsi                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The bit after the `#` that configures the embedded Jitsi client: skip the
 * pre-join lobby (the participant has already been authorized by us, so asking
 * them to knock twice is noise) and carry their name in, so the other side sees
 * who joined rather than "Fellow Jitser".
 */
function jitsiFragment(displayName: string): string {
  const params = [
    "config.prejoinPageEnabled=false",
    "config.disableDeepLinking=true",
    `userInfo.displayName=${encodeURIComponent(JSON.stringify(displayName))}`,
  ];
  return `#${params.join("&")}`;
}

/**
 * Jitsi on the public meet.jit.si, with no account.
 *
 * This is the mode that makes a two-way consultation demonstrable without
 * signing up to a vendor: real media, two real participants, zero credentials.
 * What it is NOT is access control. The public service admits anyone who has
 * the room URL, so the guarantee here is obscurity — a random room name that is
 * never shown outside the two authorized participants' own join responses, and
 * that expires with the appointment.
 *
 * Our own rules still run in front of it: only the patient and the doctor on
 * the appointment can obtain the URL, and only inside the join window. But the
 * room itself is not token-gated, so this mode is refused in production, where
 * VIDEO_API_KEY / VIDEO_API_SECRET (JWT-authenticated Jitsi) is required.
 */
function jitsiPublicProvider(domain: string): VideoProvider {
  return {
    name: "jitsi-public",

    async createRoom({ appointmentId, expiresAt }) {
      // 12 random bytes. The room name is the only thing standing between this
      // consultation and an uninvited participant, so it is not derived from
      // anything guessable such as the appointment id or the patient's name.
      return {
        roomName: `niramoy-${appointmentId.slice(0, 8)}-${randomBytes(12).toString("hex")}`,
        providerRoomId: null,
        expiresAt,
      };
    },

    async getJoinToken({ room, displayName, ttlSeconds }) {
      const url = `https://${domain}/${room.roomName}`;
      return {
        url,
        // No token to mint: the public service does not accept one. The empty
        // string is honest about that; it is not a credential.
        token: "",
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        provider: "jitsi-public",
        isDemo: false,
        embedUrl: `${url}${jitsiFragment(displayName)}`,
      };
    },

    async endRoom() {
      /* Jitsi rooms are ephemeral; they disappear when empty */
    },
  };
}

/**
 * Jitsi with JWT authentication. The secret signs a token naming the room and
 * the participant; it never leaves the server.
 */
function jitsiProvider(appId: string, secret: string, domain: string): VideoProvider {
  const base64url = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return {
    name: "jitsi",

    async createRoom({ appointmentId, expiresAt }) {
      return {
        roomName: `niramoy-${appointmentId.slice(0, 8)}-${randomBytes(6).toString("hex")}`,
        providerRoomId: null,
        expiresAt,
      };
    },

    async getJoinToken({ room, userId, displayName, role, ttlSeconds }) {
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

      const header = base64url({ alg: "HS256", typ: "JWT" });
      const payload = base64url({
        aud: appId,
        iss: appId,
        sub: domain,
        room: room.roomName,
        exp: Math.floor(expiresAt.getTime() / 1000),
        nbf: Math.floor(Date.now() / 1000) - 10,
        context: {
          user: { id: userId, name: displayName, moderator: role === "doctor" },
          features: { recording: false, livestreaming: false, transcription: false },
        },
      });
      const signature = createHmac("sha256", secret)
        .update(`${header}.${payload}`)
        .digest("base64url");

      const url = `https://${domain}/${room.roomName}`;
      const jwt = `${header}.${payload}.${signature}`;

      return {
        url,
        token: jwt,
        expiresAt,
        provider: "jitsi",
        isDemo: false,
        embedUrl: `${url}?jwt=${encodeURIComponent(jwt)}${jitsiFragment(displayName)}`,
      };
    },

    async endRoom() {
      /* Jitsi rooms are ephemeral; they disappear when empty */
    },
  };
}

/* -------------------------------------------------------------------------- */

let cached: VideoProvider | undefined;

export function getVideoProvider(): VideoProvider {
  if (cached) return cached;
  const env = getEnv();

  if (env.videoProvider === "daily" && env.VIDEO_API_KEY) {
    cached = dailyProvider(env.VIDEO_API_KEY, env.VIDEO_DOMAIN);
  } else if (env.videoProvider === "jitsi" && env.VIDEO_API_KEY && env.VIDEO_API_SECRET) {
    cached = jitsiProvider(
      env.VIDEO_API_KEY,
      env.VIDEO_API_SECRET,
      env.VIDEO_DOMAIN ?? "meet.jit.si",
    );
  } else if (env.videoProvider === "jitsi") {
    // Asked for Jitsi with no credentials. The public service can carry the
    // call; env.ts has already refused this combination in production.
    cached = jitsiPublicProvider(env.VIDEO_DOMAIN ?? "meet.jit.si");
  } else {
    cached = demoProvider;
  }
  return cached;
}

export function resetVideoProvider(): void {
  cached = undefined;
}
