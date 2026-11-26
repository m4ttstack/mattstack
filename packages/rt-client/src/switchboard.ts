import { emitSettingsWarning } from "./settings/resolve.ts";

export const SWITCHBOARD_URL = "https://switchboard.mattstack.dev";

/** Declared again in `apps/board/switchboard/orgs.ts`, because the relay image cannot import rt-client; a parity test pins the two equal. */
export const ORG_TOKEN_PREFIX = "sbo_";
const ORG_TOKEN_RE = new RegExp(`^${ORG_TOKEN_PREFIX}[0-9a-f]{64}$`);

/** An org's own switchboard token. The relay refuses a master token with this prefix, so anything else is the relay operator's. */
export function isOrgToken(token: string | null | undefined): boolean {
  return typeof token === "string" && ORG_TOKEN_RE.test(token);
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const warnedOverrides = new Set<string>();

/** A board token rides every relay call, so an override must be https, or plain http that never leaves this machine. */
function acceptedOverride(raw: string): string | null {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.username !== "" || parsed.password !== "") return null;
  const local = parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !local) return null;
  return trimmed.replace(/\/+$/, "");
}

/** The one switchboard every board token and invite goes to. `RT_SWITCHBOARD_URL` exists for local relay work and tests; it is never written or shown. */
export function switchboardUrl(env: Record<string, string | undefined> = process.env, warn: (message: string) => void = emitSettingsWarning): string {
  const raw = env.RT_SWITCHBOARD_URL;
  if (!raw) return SWITCHBOARD_URL;
  const accepted = acceptedOverride(raw);
  if (accepted) return accepted;
  if (!warnedOverrides.has(raw)) {
    warnedOverrides.add(raw);
    warn(`rt: ignoring RT_SWITCHBOARD_URL, which must be https or http to this machine; using ${SWITCHBOARD_URL}`);
  }
  return SWITCHBOARD_URL;
}
