import { runCapture } from "../subprocess.ts";

export type LoginProbe = (argv: string[]) => Promise<{ exitCode: number; stdout: string }>;

const LOGIN_KEYS = ["PATH", "HOME", "SHELL", "TMPDIR", "LANG"] as const;
const IDENTITY_KEYS = ["USER", "LOGNAME"] as const;
const DROPPED_HERDR_KEYS = new Set(["HERDR_SOCKET_PATH", "HERDR_PANE_ID"]);

const defaultProbe: LoginProbe = async (argv) => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  const r = await runCapture([argv[0]!, ...argv.slice(1)], { env, timeoutMs: 15_000, stderr: "pipe" });
  return { exitCode: r.exitCode, stdout: r.stdout };
};

/** The user's terminal env as a login shell sets it, not launchd's minimal
    one. Empty on any probe failure: callers fall back to their own env. */
export async function loginShellEnv(probe: LoginProbe = defaultProbe): Promise<Record<string, string>> {
  let r: { exitCode: number; stdout: string };
  try {
    r = await probe(["zsh", "-lc", 'printf "%s\\n" "$PATH" "$HOME" "$SHELL" "$TMPDIR" "$LANG"']);
  } catch {
    return {};
  }
  if (r.exitCode !== 0) return {};
  const lines = r.stdout.split("\n");
  const env: Record<string, string> = {};
  LOGIN_KEYS.forEach((key, i) => {
    const v = lines[i];
    if (v) env[key] = v;
  });
  return env;
}

/** Built from scratch: whatever the server gets becomes every pane shell's
    env, so rt, daemon and app variables stay out by construction. */
export function herdrServerEnv(
  caller: Record<string, string | undefined>,
  login: Record<string, string>,
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of LOGIN_KEYS) {
    const v = login[key] ?? caller[key];
    if (v) env[key] = v;
  }
  for (const key of IDENTITY_KEYS) {
    const v = caller[key];
    if (v) env[key] = v;
  }
  for (const [k, v] of Object.entries(caller)) {
    if (k.startsWith("HERDR_") && !DROPPED_HERDR_KEYS.has(k) && v !== undefined) env[k] = v;
  }
  Object.assign(env, extra);
  // Without the user context, a server started from an app or the daemon
  // dies when that process goes away.
  env.HERDR_MACOS_SERVER_CONTEXT = "user";
  return env;
}
