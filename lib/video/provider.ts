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

      return {
        url: `https://${domain ?? "niramoy"}.daily.co/${room.roomName}`,
        token: token.token,
        expiresAt,
        provider: "daily",
        isDemo: false,
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

      return {
        url: `https://${domain}/${room.roomName}`,
        token: `${header}.${payload}.${signature}`,
        expiresAt,
        provider: "jitsi",
        isDemo: false,
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
  } else {
    cached = demoProvider;
  }
  return cached;
}

export function resetVideoProvider(): void {
  cached = undefined;
}
