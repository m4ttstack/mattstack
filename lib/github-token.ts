/**
 * The GitHub token rt's forge calls use: the stored `rt/githubToken` secret,
 * else the local `gh` session. Without the fallback a machine with only a
 * `gh` login reads every PR as absent, which silently disables the picker's PR
 * state and merge-driven worktree cleanup.
 */

import { statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { runCapture } from "./subprocess.ts";

const GH_TTL_MS = 10 * 60_000;

export interface GhTokenSeams {
  ghToken(): Promise<string | null>;
  now(): number;
  /** Changes whenever the gh session may have changed; a change re-reads the token at once. */
  sessionFingerprint(): string;
}

export interface ResolvedGithubToken {
  token: string;
  source: "stored" | "gh";
}

/** The daemon runs under launchd's minimal PATH, so gh is looked up in the usual install dirs too. */
function ghSearchPath(): string {
  const home = homedir();
  return ["/opt/homebrew/bin", "/usr/local/bin", `${home}/.local/bin`, process.env.PATH ?? ""].join(":");
}

async function realGhToken(): Promise<string | null> {
  // test-setup.ts sets this so no unit test can read the developer's real gh login.
  if (process.env.RT_GH_TOKEN_FALLBACK === "off") return null;
  const gh = Bun.which("gh", { PATH: ghSearchPath() });
  if (!gh) return null;
  const res = await runCapture([gh, "auth", "token", "--hostname", "github.com"], { timeoutMs: 5000 });
  const token = res.stdout.trim();
  return res.exitCode === 0 && token ? token : null;
}

/** gh's own lookup order for its config dir (Windows aside). */
function ghConfigDir(env: Record<string, string | undefined>): string {
  if (env.GH_CONFIG_DIR) return env.GH_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "gh");
  return join(env.HOME || homedir(), ".config", "gh");
}

/**
 * gh rewrites hosts.yml on every login, logout and account switch, even when
 * the token itself lives in the keychain, so its stat stands in for the
 * session without running gh.
 */
export function ghSessionFingerprint(env: Record<string, string | undefined> = process.env): string {
  if (env.RT_GH_TOKEN_FALLBACK === "off") return "off";
  try {
    const st = statSync(join(ghConfigDir(env), "hosts.yml"));
    return `${st.ino}:${st.mtimeMs}:${st.size}`;
  } catch {
    return "absent";
  }
}

export function createGithubTokenResolver(
  seams: GhTokenSeams = { ghToken: realGhToken, now: Date.now, sessionFingerprint: () => ghSessionFingerprint() },
): (stored: string | undefined) => Promise<ResolvedGithubToken | null> {
  let cached: { token: string | null; at: number; fingerprint: string } | undefined;
  return async (stored) => {
    if (stored) return { token: stored, source: "stored" };
    const fingerprint = seams.sessionFingerprint();
    if (!cached || cached.fingerprint !== fingerprint || seams.now() - cached.at > GH_TTL_MS) {
      cached = { token: await seams.ghToken(), at: seams.now(), fingerprint };
    }
    return cached.token ? { token: cached.token, source: "gh" } : null;
  };
}

export const resolveGithubToken = createGithubTokenResolver();
