/**
 * Which video provider is selected, and what it hands the browser.
 *
 * The interesting cases are the two ends of the range: the default provider,
 * which carries no media and must say so, and the credential-free public Jitsi
 * mode, which carries real media but is not access-controlled and must
 * therefore be impossible to select in production.
 */
import { getEnv, resetEnvCache } from "../../lib/config/env";
import { getVideoProvider, resetVideoProvider } from "../../lib/video/provider";
import { contentSecurityPolicy } from "../../lib/security/headers";

const ORIGINAL = { ...process.env };

function withEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
  resetVideoProvider();
}

afterEach(() => {
  process.env = { ...ORIGINAL };
  resetEnvCache();
  resetVideoProvider();
});

const room = { roomName: "niramoy-test", providerRoomId: null, expiresAt: new Date(Date.now() + 60_000) };
const participant = { userId: "u1", displayName: "Nabila Begum", ttlSeconds: 600 } as const;

describe("video provider selection", () => {
  it("defaults to the demo provider, which offers nothing to embed", async () => {
    withEnv({ VIDEO_PROVIDER: undefined, VIDEO_API_KEY: undefined, VIDEO_API_SECRET: undefined });

    const grant = await getVideoProvider().getJoinToken({ ...participant, room, role: "patient" });

    expect(grant.provider).toBe("demo");
    expect(grant.isDemo).toBe(true);
    // The UI keys off this to say "no media is carried" rather than drawing a
    // frame that would sit there empty.
    expect(grant.embedUrl).toBeNull();
  });

  it("falls back to public Jitsi when asked for Jitsi with no credentials", async () => {
    withEnv({ VIDEO_PROVIDER: "jitsi", VIDEO_API_KEY: undefined, VIDEO_API_SECRET: undefined });

    const provider = getVideoProvider();
    expect(provider.name).toBe("jitsi-public");

    const grant = await provider.getJoinToken({ ...participant, room, role: "patient" });

    expect(grant.isDemo).toBe(false);
    expect(grant.embedUrl).toContain("https://meet.jit.si/niramoy-test");
    // No token is minted, because the public service accepts none. An empty
    // string here is the honest answer, not a credential.
    expect(grant.token).toBe("");
    // The name is carried in so the other side sees who joined.
    expect(grant.embedUrl).toContain("Nabila%20Begum");
    expect(grant.embedUrl).toContain("prejoinPageEnabled=false");
  });

  it("gives every appointment an unguessable public room name", async () => {
    withEnv({ VIDEO_PROVIDER: "jitsi" });
    const provider = getVideoProvider();

    const a = await provider.createRoom({ appointmentId: "11111111-2222-3333-4444-555555555555", expiresAt: room.expiresAt });
    const b = await provider.createRoom({ appointmentId: "11111111-2222-3333-4444-555555555555", expiresAt: room.expiresAt });

    // Same appointment, different rooms: the name is not derived from anything
    // an outsider could know or guess.
    expect(a.roomName).not.toBe(b.roomName);
    expect(a.roomName.length).toBeGreaterThan(30);
  });

  it("opens the CSP only to the provider that is configured", () => {
    withEnv({ VIDEO_PROVIDER: "jitsi" });
    expect(contentSecurityPolicy()).toContain("frame-src 'self' https://meet.jit.si");

    withEnv({ VIDEO_PROVIDER: undefined });
    expect(contentSecurityPolicy()).toContain("frame-src 'self';");
  });

  it("refuses the credential-free public room in production", () => {
    withEnv({
      APP_ENV: "production",
      VIDEO_PROVIDER: "jitsi",
      VIDEO_API_KEY: undefined,
      VIDEO_API_SECRET: undefined,
      DATABASE_URL: "postgresql://u:p@example.com:5432/db",
      SESSION_SECRET: "x".repeat(40),
      CRON_SECRET: "y".repeat(40),
      NIRAMOY_ADMIN_CODE: "z".repeat(12),
    });

    // The environment is parsed lazily, so the refusal surfaces on first read.
    expect(() => getEnv()).toThrow(/VIDEO_API_SECRET/);
  });

  it("allows the public room in production only when explicitly acknowledged", () => {
    withEnv({
      APP_ENV: "production",
      VIDEO_PROVIDER: "jitsi",
      VIDEO_API_KEY: undefined,
      VIDEO_API_SECRET: undefined,
      ALLOW_PUBLIC_VIDEO_ROOM: "true",
      DATABASE_URL: "postgresql://u:p@example.com:5432/db",
      SESSION_SECRET: "x".repeat(40),
      CRON_SECRET: "y".repeat(40),
      NIRAMOY_ADMIN_CODE: "z".repeat(12),
    });

    // A deployed demonstration: it boots, and it is still the public room.
    expect(getEnv().isProd).toBe(true);
    expect(getVideoProvider().name).toBe("jitsi-public");
  });
});
