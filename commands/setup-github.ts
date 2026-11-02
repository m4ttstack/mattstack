/**
 * `rt setup github sign-in`: signs in to GitHub for the settings backup with
 * GitHub's device flow. The start call hands the person a code and spawns
 * itself again with `--wait`, detached, to poll for the token. The waiter gets
 * the device code on stdin and finishes the sign-in: it stores the token and
 * stages the remote the run creates. The token goes only to the secret writer
 * or the staging store, never to argv, an envelope or a log.
 */
import { spawn } from "child_process";
import type { CommandContext } from "../lib/command-tree.ts";
import { UserActionableError } from "../lib/errors.ts";
import { rtSelfArgv } from "../lib/rt-self.ts";
import { envelope } from "../lib/setup/contract.ts";
import { FORM_COPY } from "../lib/setup/form.ts";
import {
  clearGitHubSignIn,
  GITHUB_OAUTH_CLIENT_ID,
  pollDeviceToken,
  readGitHubSignIn,
  readGitHubSignInRaw,
  requestDeviceCode,
  writeGitHubSignIn,
  type GitHubSignIn,
} from "../lib/setup/github-signin.ts";
import { stageHomeRemote } from "../lib/setup/home-remote.ts";
import { createRealProbes, readStdinJson, type Probes } from "../lib/setup/probes.ts";
import { stageSecret } from "../lib/setup/staging.ts";
import { pidAlive } from "../lib/setup/update-lock.ts";
import { exitWithUserError, type UserErrorSink } from "../lib/setup/user-failure.ts";
import { childEnv } from "../lib/subprocess.ts";
import * as out from "../lib/ui/out.ts";
import { realSecretWriter, type SecretWriter } from "./setup.ts";

export interface GitHubSignInDeps {
  probes: Probes;
  json: (v: unknown) => void;
  exit: (code: number) => never;
  /** Starts the waiter detached with `input` on its stdin; its pid, or null when it did not start. */
  spawnWaiter(argv: string[], input: string): number | null;
  readWaiterInput(): Promise<WaiterInput>;
  writer: SecretWriter;
  sleep(ms: number): Promise<void>;
  alive(pid: number): boolean;
  /** Overrides the build's OAuth client id. */
  clientId?: string;
}

export interface WaiterInput {
  deviceCode: string;
  intervalSec: number;
}

const DEFAULT_INTERVAL_SEC = 5;

function realSpawnWaiter(argv: string[], input: string): number | null {
  try {
    const child = spawn(argv[0]!, argv.slice(1), { detached: true, stdio: ["pipe", "ignore", "ignore"], env: childEnv() });
    child.on("error", () => {});
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

async function readWaiterInputFromStdin(): Promise<WaiterInput> {
  const input = (await readStdinJson<Partial<WaiterInput>>()) ?? {};
  if (typeof input.deviceCode !== "string" || input.deviceCode === "") {
    throw new UserActionableError("github-signin-failed", "rt lost track of the GitHub sign-in. Sign in again");
  }
  return { deviceCode: input.deviceCode, intervalSec: typeof input.intervalSec === "number" && input.intervalSec > 0 ? input.intervalSec : DEFAULT_INTERVAL_SEC };
}

function realDeps(): GitHubSignInDeps {
  return {
    probes: createRealProbes(),
    json: (v) => out.json(v),
    exit: process.exit,
    spawnWaiter: realSpawnWaiter,
    readWaiterInput: readWaiterInputFromStdin,
    writer: realSecretWriter(),
    sleep: (ms) => Bun.sleep(ms),
    alive: pidAlive,
  };
}

function sinkOf(deps: GitHubSignInDeps): UserErrorSink {
  return { json: deps.json, exit: deps.exit, now: () => deps.probes.now() };
}

function report(deps: GitHubSignInDeps, json: boolean, record: GitHubSignIn): void {
  if (json) deps.json(envelope({ integration: "github", status: "needs-you", userCode: record.userCode, url: record.url }, deps.probes.now()));
  else out.print(out.line("needs-you", "GitHub", FORM_COPY.connect.teamTool.code(record.userCode)), out.kv("URL", record.url));
}

async function start(deps: GitHubSignInDeps, json: boolean): Promise<void> {
  const p = deps.probes;
  const live = readGitHubSignIn(p, deps.alive);
  if (live !== null && live.outcome === undefined) return report(deps, json, live);

  const code = await requestDeviceCode(p, deps.clientId ?? GITHUB_OAUTH_CLIENT_ID);
  const record: GitHubSignIn = { userCode: code.userCode, url: code.verificationUri, expiresAt: code.expiresAt, pid: null };
  writeGitHubSignIn(p, record);
  const pid = deps.spawnWaiter([...rtSelfArgv(), "setup", "github", "sign-in", "--wait"], JSON.stringify({ deviceCode: code.deviceCode, intervalSec: code.intervalSec } satisfies WaiterInput));
  if (pid === null) {
    clearGitHubSignIn(p);
    throw new UserActionableError("github-signin-failed", "rt couldn't start waiting for GitHub. Try again");
  }
  writeGitHubSignIn(p, { ...record, pid });
  report(deps, json, { ...record, pid });
}

async function storeToken(deps: GitHubSignInDeps, token: string): Promise<void> {
  if (await deps.writer.storeReady()) {
    try {
      await deps.writer.write("rt", "githubToken", token);
      return;
    } catch {
      // The sign-in is spent: staging keeps the token for the secrets step instead of losing it.
    }
  }
  stageSecret(deps.probes, "rt", "githubToken", token);
}

async function wait(deps: GitHubSignInDeps): Promise<void> {
  const p = deps.probes;
  const record = readGitHubSignIn(p, () => true);
  if (record === null || record.outcome !== undefined) return;
  const { deviceCode, intervalSec: startInterval } = await deps.readWaiterInput();
  const expiresAt = Date.parse(record.expiresAt);
  const clientId = deps.clientId ?? GITHUB_OAUTH_CLIENT_ID;
  let intervalSec = startInterval;

  // A second sign-in started meanwhile owns the record; this waiter must not touch it.
  const finish = (outcome?: "expired" | "declined") => {
    if (readGitHubSignInRaw(p)?.userCode !== record.userCode) return;
    if (outcome === undefined) clearGitHubSignIn(p);
    else writeGitHubSignIn(p, { ...record, outcome });
  };

  while (p.now().getTime() < expiresAt) {
    await deps.sleep(intervalSec * 1000);
    const result = await pollDeviceToken(p, deviceCode, clientId);
    switch (result.kind) {
      case "token":
        await storeToken(deps, result.token);
        stageHomeRemote(p, { create: true });
        return finish();
      case "expired":
      case "declined":
        return finish(result.kind);
      case "slow-down":
        intervalSec = result.intervalSec;
        break;
      case "pending":
        break;
    }
  }
  finish("expired");
}

export async function setupGitHubSignIn(args: string[], _ctx: CommandContext = {}, deps: GitHubSignInDeps = realDeps()): Promise<void> {
  const json = args.includes("--json");
  if (json) out.payloadOnStdout();
  try {
    if (args.includes("--wait")) await wait(deps);
    else await start(deps, json);
  } catch (err) {
    if (err instanceof UserActionableError) return exitWithUserError(err, json, sinkOf(deps));
    throw err;
  }
}
