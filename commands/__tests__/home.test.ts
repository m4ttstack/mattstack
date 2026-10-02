import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import {
  claudePluginsPointerMessage,
  defaultAgeKeyInputSeam,
  defaultMaterializeEnv,
  gatherHomeState,
  homeClaim,
  homeInit,
  homeKeyExport,
  homeKeyImport,
  homeRelease,
  homeSnapshot,
  InvalidUrlArgError,
  probeDeckHealthy,
  readStdinTrimmed,
  resolveHomeUrl,
  type AgeKeyInputSeam,
  type DeckHealthProbe,
  type HomeDaemonSeam,
  type HomeProbes,
  type MachineProfilePickerSeam,
  type SopsYamlSeam,
} from "../home.ts";
import type { SetupIntent } from "../../lib/setup/intent.ts";
import { setSetting } from "../../lib/settings/write.ts";
import { Readable } from "stream";
import { EventEmitter } from "events";
import type { PromptIO, PromptStdin } from "../../lib/prompt-secret.ts";
import { STATE_DIR_NAMES } from "../../lib/home/init-plan.ts";
import type { ExecResult, ExecSeam } from "../../lib/home/init-exec.ts";
import { renderSopsYaml, type AgeExecResult, type AgeKeySeam } from "../../lib/home/age-key.ts";
import { logsDir, mattstackHome } from "../../lib/rt-paths.ts";
import { __test__ as gateTest } from "../../lib/ui/gate.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { keyExport } from "../../lib/home/age-key.ts";
import { readOwners } from "../../lib/home/snapshot-owners.ts";
import type { DaemonResponse } from "../../lib/daemon-client.ts";
import type { SnapshotResult, SnapshotStatus } from "../../lib/daemon/home-snapshot.ts";
import type { MaterializeEnv, MaterializeExecResult, MaterializeExecSeam } from "../../lib/home/materialize.ts";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

const FAKE_PUBLIC_KEY = "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
const FAKE_PRIVATE_KEY = "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ";
const SOPS_YAML_PATH = join(mattstackHome(), "user", ".sops.yaml");
const KEY = "mbp-14";
const TEST_URL = "https://github.com/example/mattstack-home.git";

/** In-memory .sops.yaml — never touches the real filesystem. */
class FakeSopsYamlSeam implements SopsYamlSeam {
  files = new Map<string, string>();
  writes: { path: string; content: string }[] = [];

  constructor(initial?: { path: string; content: string }) {
    if (initial) this.files.set(initial.path, initial.content);
  }

  read(path: string): string | null {
    return this.files.get(path) ?? null;
  }

  write(path: string, content: string): void {
    this.files.set(path, content);
    this.writes.push({ path, content });
  }
}

/** No key in the keychain yet; ensureAgeKey MINTS one — never touches the real keychain. */
class FakeAgeKeySeam implements AgeKeySeam {
  calls: string[][] = [];

  async run(cmd: string[]): Promise<AgeExecResult> {
    this.calls.push(cmd);
    if (cmd[1] === "find-generic-password") {
      return { code: 44, stdout: "", stderr: "The specified item could not be found in the keychain." };
    }
    if (cmd[0] === "age-keygen") {
      return { code: 0, stdout: `# public key: ${FAKE_PUBLIC_KEY}\n${FAKE_PRIVATE_KEY}\n`, stderr: "" };
    }
    if (cmd[1] === "add-generic-password") return { code: 0, stdout: "", stderr: "" };
    throw new Error(`FakeAgeKeySeam: unexpected call ${cmd.join(" ")}`);
  }
}

/** A key ALREADY exists in the keychain; ensureAgeKey only DERIVES its public half, never mints — never touches the real keychain. */
class FakeAgeKeySeamWithExistingKey implements AgeKeySeam {
  calls: string[][] = [];

  async run(cmd: string[]): Promise<AgeExecResult> {
    this.calls.push(cmd);
    if (cmd[1] === "find-generic-password") {
      return { code: 0, stdout: `${FAKE_PRIVATE_KEY}\n`, stderr: "" };
    }
    if (cmd[0] === "age-keygen" && cmd[1] === "-y") {
      return { code: 0, stdout: `${FAKE_PUBLIC_KEY}\n`, stderr: "" };
    }
    throw new Error(`FakeAgeKeySeamWithExistingKey: unexpected call ${cmd.join(" ")}`);
  }
}

function fakeProbes(overrides: Partial<HomeProbes>): HomeProbes {
  return {
    isGitRepo: () => false,
    exists: () => false,
    readSymlinkTarget: () => null,
    isFile: () => false,
    listProfiles: () => [],
    ...overrides,
  };
}

const FULLY_PROVISIONED_PROBES = (): HomeProbes =>
  fakeProbes({
    isGitRepo: (dir) => dir.endsWith("/user"),
    exists: () => true,
    readSymlinkTarget: (path) => (path.endsWith("/skills.jsonc") ? join("user", "skills.jsonc") : null),
  });

describe("gatherHomeState", () => {
  test("userRepoPresent is true only when user/ is itself a git clone", () => {
    const probes = fakeProbes({ isGitRepo: (dir) => dir.endsWith("/user") });
    const state = gatherHomeState("/home", probes, KEY);
    expect(state.userRepoPresent).toBe(true);
  });

  test("a plain (non-git) user/ directory does not count as a clone", () => {
    const probes = fakeProbes({ exists: (path) => path.endsWith("/user"), isGitRepo: () => false });
    const state = gatherHomeState("/home", probes, KEY);
    expect(state.userRepoPresent).toBe(false);
  });

  test("machineKeyFilePresent reflects the root machine-key file only", () => {
    const probes = fakeProbes({ exists: (path) => path === "/home/machine-key" });
    const state = gatherHomeState("/home", probes, KEY);
    expect(state.machineKeyFilePresent).toBe(true);
  });

  test("profileDirPresent checks user/local/<key>/, not just any local dir", () => {
    const probes = fakeProbes({ exists: (path) => path === join("/home", "user", "local", KEY) });
    const state = gatherHomeState("/home", probes, KEY);
    expect(state.profileDirPresent).toBe(true);
  });

  test("skillsSymlinkPresent is true only when the symlink target is exactly user/skills.jsonc", () => {
    const correct = fakeProbes({ readSymlinkTarget: () => join("user", "skills.jsonc") });
    expect(gatherHomeState("/home", correct, KEY).skillsSymlinkPresent).toBe(true);

    const wrong = fakeProbes({ readSymlinkTarget: () => "/some/other/path" });
    expect(gatherHomeState("/home", wrong, KEY).skillsSymlinkPresent).toBe(false);
  });

  test("skillsSymlinkBlocked is true only when a REAL file (not a symlink) sits at the root path", () => {
    const realFile = fakeProbes({ readSymlinkTarget: () => null, exists: (path) => path.endsWith("/skills.jsonc") });
    expect(gatherHomeState("/home", realFile, KEY).skillsSymlinkBlocked).toBe(true);

    const absent = fakeProbes({ readSymlinkTarget: () => null, exists: () => false });
    expect(gatherHomeState("/home", absent, KEY).skillsSymlinkBlocked).toBe(false);

    const validSymlink = fakeProbes({ readSymlinkTarget: () => join("user", "skills.jsonc") });
    expect(gatherHomeState("/home", validSymlink, KEY).skillsSymlinkBlocked).toBe(false);
  });

  test("stateDirsMissing lists only the state dirs absent under home", () => {
    const probes = fakeProbes({ exists: (path) => path === "/home/rt" || path === "/home/deck" });
    const state = gatherHomeState("/home", probes, KEY);
    expect(state.stateDirsMissing).toEqual(STATE_DIR_NAMES.filter((n) => n !== "rt" && n !== "deck"));
  });
});

/** Records argv only; used to prove init-step execution and idempotence. */
class FakeSeam implements ExecSeam {
  calls: { kind: string; arg: unknown }[] = [];
  constructor(private opts: { failRun?: (cmd: string[]) => boolean } = {}) {}

  async run(cmd: string[]): Promise<ExecResult> {
    this.calls.push({ kind: "run", arg: cmd });
    if (this.opts.failRun?.(cmd)) return { code: 1, stdout: "", stderr: "boom" };
    // commitInitialUserRepo probes identity before committing; default to
    // "configured" so fixtures not exercising the no-identity path stay
    // green, mirroring lib/daemon/__tests__/home-snapshot.test.ts's
    // defaultResponders.
    if (cmd[cmd.length - 2] === "config" && cmd[cmd.length - 1] === "user.name") {
      return { code: 0, stdout: "rt test\n", stderr: "" };
    }
    if (cmd[cmd.length - 2] === "config" && cmd[cmd.length - 1] === "user.email") {
      return { code: 0, stdout: "rt@example.test\n", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.calls.push({ kind: "writeFile", arg: { path, content } });
  }
  async mkdirp(path: string): Promise<void> {
    this.calls.push({ kind: "mkdirp", arg: path });
  }
  async exists(path: string): Promise<boolean> {
    this.calls.push({ kind: "exists", arg: path });
    return false;
  }
  async blocksSymlink(path: string): Promise<boolean> {
    this.calls.push({ kind: "blocksSymlink", arg: path });
    return false;
  }
  async writeSymlink(path: string, target: string): Promise<void> {
    this.calls.push({ kind: "writeSymlink", arg: { path, target } });
  }
}

/** Never picks anything — used as the default injected picker so a test that doesn't expect the prompt fails loudly instead of hanging on a real picker. */
class UnreachablePickerSeam implements MachineProfilePickerSeam {
  async pick(): Promise<string | null> {
    throw new Error("MachineProfilePickerSeam.pick should not have been called");
  }
}

/** Records the (profiles, hostnameSlug) it was called with and returns a scripted choice. */
class FakePickerSeam implements MachineProfilePickerSeam {
  calls: { profiles: string[]; hostnameSlug: string }[] = [];
  constructor(private result: string | null) {}
  async pick(profiles: string[], hostnameSlug: string): Promise<string | null> {
    this.calls.push({ profiles, hostnameSlug });
    return this.result;
  }
}

/** Nothing installed, nothing tracked — `planMaterialize` reduces this to a single `rtInterceptInstall` step. The default materialize env for every test below that isn't exercising materialize itself. */
const NOOP_MATERIALIZE_ENV: MaterializeEnv = { deckOnPath: false, deckHealthy: false, deckHelperLabel: null, boardRepoPath: null, daemonInstalled: true, trackedRepos: [] };

/** Never spawns a real process. Records every argv it's asked to run; scripts a result per exact argv, defaulting to a clean exit 0. */
class FakeMaterializeExecSeam implements MaterializeExecSeam {
  calls: string[][] = [];
  constructor(private scripted: Map<string, MaterializeExecResult> = new Map()) {}
  script(argv: string[], result: MaterializeExecResult): void {
    this.scripted.set(argv.join(" "), result);
  }
  async run(argv: [string, ...string[]]): Promise<MaterializeExecResult> {
    this.calls.push(argv);
    return this.scripted.get(argv.join(" ")) ?? { stdout: "", stderr: "", exitCode: 0 };
  }
}

/** Runs `homeInit`, catching the `process.exit` call the failure paths make. */
async function runHomeInit(
  probes: HomeProbes,
  exec: ExecSeam,
  ageKeySeam: AgeKeySeam = new FakeAgeKeySeam(),
  args: string[] = [],
  sopsYamlSeam: SopsYamlSeam = new FakeSopsYamlSeam(),
  key: string = KEY,
  pickerSeam: MachineProfilePickerSeam = new UnreachablePickerSeam(),
  isInteractive: () => boolean = () => false,
  materializeEnv: () => Promise<MaterializeEnv> = async () => NOOP_MATERIALIZE_ENV,
  materializeExec: MaterializeExecSeam = new FakeMaterializeExecSeam(),
  env: Record<string, string | undefined> = {},
  readIntent: (() => SetupIntent | null) | "real-disk-read" = () => null,
): Promise<{ exitCode: number | undefined; logs: string[]; errors: string[] }> {
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  try {
    // Omitting `readIntent` entirely is what makes homeInit fall through to
    // its real ~/.mattstack/rt/setup-intent.json read; the default above
    // keeps every other case off disk, so nothing a preload or a later test
    // writes there can move an assertion.
    const intentSeam = readIntent === "real-disk-read" ? {} : { readIntent };
    await homeInit(args, {}, { probes, exec, ageKeySeam, sopsYamlSeam, key, pickerSeam, isInteractive, materializeEnv, materializeExec, env, ...intentSeam });
    return { exitCode: undefined, logs: io.lines(), errors: io.errLines() };
  } catch {
    const code = exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
    return { exitCode: code, logs: io.lines(), errors: io.errLines() };
  } finally {
    exitSpy.mockRestore();
    io.restore();
  }
}

describe("homeInit", () => {
  test("fully provisioned: runs no step, but still ensures the age key (idempotent)", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeam();
    const { exitCode } = await runHomeInit(FULLY_PROVISIONED_PROBES(), seam, ageKeySeam);

    expect(exitCode).toBeUndefined();
    expect(seam.calls).toEqual([]);
    expect(ageKeySeam.calls.some((c) => c[1] === "find-generic-password")).toBe(true);
  });

  test("fully provisioned: backfills .sops.yaml when it's missing (a home repo that predates this step)", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeam();
    const sopsYamlSeam = new FakeSopsYamlSeam();

    await runHomeInit(FULLY_PROVISIONED_PROBES(), seam, ageKeySeam, [], sopsYamlSeam);

    expect(sopsYamlSeam.files.get(SOPS_YAML_PATH)).toBe(renderSopsYaml(FAKE_PUBLIC_KEY));
  });

  test("fully provisioned: an existing .sops.yaml with the current key's recipient is left untouched", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeam();
    const sopsYamlSeam = new FakeSopsYamlSeam({ path: SOPS_YAML_PATH, content: renderSopsYaml(FAKE_PUBLIC_KEY) });

    await runHomeInit(FULLY_PROVISIONED_PROBES(), seam, ageKeySeam, [], sopsYamlSeam);

    expect(sopsYamlSeam.writes).toEqual([]);
  });

  test("fully provisioned, key ALREADY in the keychain (not minted), a stale .sops.yaml recipient: RULED — refuses, never silently rewrites, leaves the file untouched, exits 1", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeamWithExistingKey();
    const sopsYamlSeam = new FakeSopsYamlSeam({ path: SOPS_YAML_PATH, content: renderSopsYaml("age1stale") });

    const { exitCode, errors } = await runHomeInit(FULLY_PROVISIONED_PROBES(), seam, ageKeySeam, [], sopsYamlSeam);

    expect(exitCode).toBe(1);
    expect(sopsYamlSeam.writes).toEqual([]);
    expect(sopsYamlSeam.files.get(SOPS_YAML_PATH)).toBe(renderSopsYaml("age1stale"));
    // Names both recipients (truncated) and both recovery paths.
    expect(errors.some((e) => e.includes("age1stale"))).toBe(true);
    expect(errors.some((e) => e.includes(FAKE_PUBLIC_KEY.slice(0, 12)))).toBe(true);
    expect(errors.some((e) => e.includes("rt home key import --force"))).toBe(true);
    expect(errors).toContain("  note: To change the key on purpose, rewrite the recipient in your home repo by hand, then save each secret again with rt secrets set.");
    expect(errors).toContain(`  why: They are locked to age1stale…, but this Mac holds ${FAKE_PUBLIC_KEY.slice(0, 12)}…, and rt will not change that lock by itself.`);
    expect(errors.some((e) => e.includes("…."))).toBe(false);
  });

  test("fully provisioned, key ALREADY in the keychain, recipient matches: no-op", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeamWithExistingKey();
    const sopsYamlSeam = new FakeSopsYamlSeam({ path: SOPS_YAML_PATH, content: renderSopsYaml(FAKE_PUBLIC_KEY) });

    const { exitCode } = await runHomeInit(FULLY_PROVISIONED_PROBES(), seam, ageKeySeam, [], sopsYamlSeam);

    expect(exitCode).toBeUndefined();
    expect(sopsYamlSeam.writes).toEqual([]);
  });

  test("fully provisioned, key JUST MINTED (fresh/empty keychain), a cloned .sops.yaml names a DIFFERENT recipient: refuses, leaves the file untouched, exits 1", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeam(); // empty keychain -> mints
    const sopsYamlSeam = new FakeSopsYamlSeam({ path: SOPS_YAML_PATH, content: renderSopsYaml("age1the-other-machines-recipient") });

    const { exitCode, errors } = await runHomeInit(FULLY_PROVISIONED_PROBES(), seam, ageKeySeam, [], sopsYamlSeam);

    expect(exitCode).toBe(1);
    expect(sopsYamlSeam.writes).toEqual([]);
    expect(sopsYamlSeam.files.get(SOPS_YAML_PATH)).toBe(renderSopsYaml("age1the-other-machines-recipient"));
    expect(errors.some((e) => e.includes("age1the-other-machines-recipient"))).toBe(true);
    expect(errors.some((e) => e.includes("rt home key import"))).toBe(true);
    // A placeholder key was already minted and stored — a plain `rt home key
    // import` would hit the exists-refusal, so the message must name --force.
    expect(errors.some((e) => e.includes("already") && e.includes("minted") && e.includes("stored"))).toBe(true);
    expect(errors.some((e) => e.includes("rt home key import --force"))).toBe(true);
  });

  test("fully provisioned, key JUST MINTED, a cloned .sops.yaml already names the SAME recipient: no-op (the astronomically unlikely match is still safe)", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeam();
    const sopsYamlSeam = new FakeSopsYamlSeam({ path: SOPS_YAML_PATH, content: renderSopsYaml(FAKE_PUBLIC_KEY) });

    const { exitCode } = await runHomeInit(FULLY_PROVISIONED_PROBES(), seam, ageKeySeam, [], sopsYamlSeam);

    expect(exitCode).toBeUndefined();
    expect(sopsYamlSeam.writes).toEqual([]);
  });

  test("the printed .sops.yaml commit hint pins cwd to user/, not the (no-longer-a-repo) root", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeam();
    const sopsYamlSeam = new FakeSopsYamlSeam();

    const { logs } = await runHomeInit(FULLY_PROVISIONED_PROBES(), seam, ageKeySeam, [], sopsYamlSeam);

    const userDir = join(mattstackHome(), "user");
    const hint = logs.find((l) => l.includes("git -C"));
    expect(hint).toBeDefined();
    expect(hint).toContain(`git -C ${userDir} add .sops.yaml`);
    expect(hint).toContain(`git -C ${userDir} commit -m "home: sops recipient"`);
    expect(hint).not.toContain(`git -C ${mattstackHome()} add`);
  });

  test("fully provisioned --dry-run: never touches the age key either", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeam();
    const sopsYamlSeam = new FakeSopsYamlSeam();
    const { exitCode } = await runHomeInit(FULLY_PROVISIONED_PROBES(), seam, ageKeySeam, ["--dry-run"], sopsYamlSeam);

    expect(exitCode).toBeUndefined();
    expect(ageKeySeam.calls).toEqual([]);
    expect(sopsYamlSeam.writes).toEqual([]);
  });

  test("a fresh, fully successful init clones the given URL, mints the age key, and writes .sops.yaml after adoption", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeam();
    const sopsYamlSeam = new FakeSopsYamlSeam();
    const { exitCode, logs } = await runHomeInit(fakeProbes({}), seam, ageKeySeam, ["--url", TEST_URL], sopsYamlSeam);

    expect(exitCode).toBeUndefined();
    const cloneCall = seam.calls.find((c) => c.kind === "run") as { kind: string; arg: string[] } | undefined;
    expect(cloneCall?.arg).toEqual(["git", "clone", TEST_URL, "user"]);
    expect(ageKeySeam.calls.some((c) => c[1] === "find-generic-password")).toBe(true);
    expect(ageKeySeam.calls.some((c) => c[0] === "age-keygen")).toBe(true);
    expect(sopsYamlSeam.files.get(SOPS_YAML_PATH)).toBe(renderSopsYaml(FAKE_PUBLIC_KEY));

    // The mint (and the age-key-ready line) happen BEFORE the success line —
    // never print success ahead of a mint that could still fail.
    const readyIdx = logs.findIndex((l) => l.includes("secrets key is ready"));
    const successIdx = logs.findIndex((l) => l.includes("This Mac is set up"));
    expect(readyIdx).toBeGreaterThanOrEqual(0);
    expect(successIdx).toBeGreaterThan(readyIdx);
  });

  test("--url is used to clone", async () => {
    const seam = new FakeSeam();
    await runHomeInit(fakeProbes({}), seam, new FakeAgeKeySeam(), ["--url", TEST_URL]);

    const cloneCall = seam.calls.find((c) => c.kind === "run") as { kind: string; arg: string[] } | undefined;
    expect(cloneCall?.arg).toEqual(["git", "clone", TEST_URL, "user"]);
  });

  test("no url anywhere: git-inits a local-only repo and commits its initial tree, never silently substituting a built-in default repo", async () => {
    const seam = new FakeSeam();
    await runHomeInit(
      fakeProbes({}),
      seam,
      new FakeAgeKeySeam(),
      [],
      new FakeSopsYamlSeam(),
      KEY,
      new UnreachablePickerSeam(),
      () => false,
      async () => NOOP_MATERIALIZE_ENV,
      new FakeMaterializeExecSeam(),
      {}, // no RT_HOME_URL — proves the "no url resolved" path, independent of the ambient shell's actual env
    );

    const runCalls = seam.calls.filter((c) => c.kind === "run").map((c) => c.arg as string[]);
    expect(runCalls).toContainEqual(["git", "init", "-b", "main", "user"]);
    expect(runCalls).toContainEqual(["git", "-C", "user", "add", "-A"]);
    expect(runCalls).toContainEqual(["git", "-c", "commit.gpgsign=false", "-C", "user", "commit", "-m", "initial home repo"]);
    expect(runCalls.some((arg) => arg[1] === "clone")).toBe(false);
  });

  test("--dry-run never touches the age key or runs any step, even on a fresh (not-yet-provisioned) home", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeam();
    const { exitCode } = await runHomeInit(fakeProbes({}), seam, ageKeySeam, ["--dry-run"]);

    expect(exitCode).toBeUndefined();
    expect(seam.calls).toEqual([]);
    expect(ageKeySeam.calls).toEqual([]);
  });

  test("a failing init step aborts before the age key is ever touched", async () => {
    const seam = new FakeSeam({ failRun: (cmd) => cmd[0] === "git" });
    const ageKeySeam = new FakeAgeKeySeam();
    const { exitCode } = await runHomeInit(fakeProbes({}), seam, ageKeySeam);

    expect(exitCode).toBe(1);
    expect(ageKeySeam.calls).toEqual([]);
  });

  test("a real file at the skills.jsonc root path: still runs every other step, still mints the age key, but exits 1", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeam();
    const probes = fakeProbes({
      readSymlinkTarget: () => null,
      exists: (path) => path.endsWith("skills.jsonc"),
    });

    const { exitCode, errors } = await runHomeInit(probes, seam, ageKeySeam);

    expect(exitCode).toBe(1);
    expect(errors[0]).toBe("[refused] Your home folder is set up, apart from your skills link");
    expect(errors.some((e) => e.includes("will not overwrite it"))).toBe(true);
    expect(ageKeySeam.calls.some((c) => c[1] === "find-generic-password")).toBe(true);
    expect(seam.calls.some((c) => c.kind === "writeSymlink")).toBe(false);
  });

  test("a real file at the skills.jsonc root path, --dry-run: reports the block and exits cleanly without running anything", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeam();
    const probes = fakeProbes({
      readSymlinkTarget: () => null,
      exists: (path) => path.endsWith("skills.jsonc"),
    });

    const { exitCode, logs } = await runHomeInit(probes, seam, ageKeySeam, ["--dry-run"]);

    expect(exitCode).toBeUndefined();
    expect(logs.some((l) => l.includes("A file is in the way of your skills link"))).toBe(true);
    expect(seam.calls).toEqual([]);
    expect(ageKeySeam.calls).toEqual([]);
  });

  test("fully provisioned but a real file blocks the symlink: never prints 'fully provisioned', still reports the block", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeam();
    // Every state-dir/machine-key/profile-dir/user-repo probe reports
    // present, so the plan is empty except for the block — exactly the
    // "steps.length === 0 AND blocked" case the fully-provisioned message
    // must not fire on.
    const probes = fakeProbes({
      isGitRepo: (dir) => dir.endsWith("/user"),
      exists: () => true,
      readSymlinkTarget: () => null,
    });

    const { exitCode, logs, errors } = await runHomeInit(probes, seam, ageKeySeam);

    expect(exitCode).toBe(1);
    expect(logs.some((l) => l.includes("Nothing to set up"))).toBe(false);
    expect(errors[0]).toBe("[refused] Your home folder is set up, apart from your skills link");
    expect(errors.some((e) => e.includes("will not overwrite it"))).toBe(true);
  });

  test("fully provisioned but blocked, --dry-run: still never prints 'fully provisioned'", async () => {
    const seam = new FakeSeam();
    const ageKeySeam = new FakeAgeKeySeam();
    const probes = fakeProbes({
      isGitRepo: (dir) => dir.endsWith("/user"),
      exists: () => true,
      readSymlinkTarget: () => null,
    });

    const { exitCode, logs } = await runHomeInit(probes, seam, ageKeySeam, ["--dry-run"]);

    expect(exitCode).toBeUndefined();
    expect(logs.some((l) => l.includes("Nothing to set up"))).toBe(false);
    expect(logs.some((l) => l.includes("A file is in the way of your skills link"))).toBe(true);
  });

  describe("--url validation", () => {
    test("--url as the last arg (no value): exits 1 with a clear error, runs nothing", async () => {
      const seam = new FakeSeam();
      const { exitCode, errors } = await runHomeInit(fakeProbes({}), seam, new FakeAgeKeySeam(), ["--url"]);

      expect(exitCode).toBe(1);
      expect(errors.some((e) => e.includes("  next: rt home init --url <remote>"))).toBe(true);
      expect(seam.calls).toEqual([]);
    });

    test("--url followed by another flag: refuses to take the flag as the URL", async () => {
      const seam = new FakeSeam();
      const { exitCode, errors } = await runHomeInit(fakeProbes({}), seam, new FakeAgeKeySeam(), ["--url", "--dry-run"]);

      expect(exitCode).toBe(1);
      expect(errors.some((e) => e.includes("  next: rt home init --url <remote>"))).toBe(true);
      expect(seam.calls).toEqual([]);
    });

    test("parseUrlArg's error type is exported and matches what homeInit catches", () => {
      expect(new InvalidUrlArgError("x")).toBeInstanceOf(Error);
    });
  });

  describe("machine-key safety guard", () => {
    test("an injected key that fails the safety guard: exits 1 with a clear error, runs no step", async () => {
      const seam = new FakeSeam();
      const { exitCode, errors } = await runHomeInit(
        fakeProbes({}),
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        "../escape",
      );

      expect(exitCode).toBe(1);
      expect(errors.some((e) => e.includes("cannot name a Mac"))).toBe(true);
      expect(seam.calls).toEqual([]);
    });

    test("an injected key with a path separator: exits 1, never reaches ensureProfileDir/writeMachineKey", async () => {
      const seam = new FakeSeam();
      const { exitCode } = await runHomeInit(
        fakeProbes({}),
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        "evil/key",
      );

      expect(exitCode).toBe(1);
      expect(seam.calls.some((c) => c.kind === "mkdirp" || c.kind === "writeFile")).toBe(false);
    });
  });

  describe("machine profile picker", () => {
    /** Repo already cloned (userRepoPresent), but no machine-key file yet — the picker's usual entry point. */
    const REPO_PRESENT_NO_KEY = (listProfiles: () => string[]): HomeProbes =>
      fakeProbes({
        isGitRepo: (dir) => dir.endsWith("/user"),
        exists: (path) => path.endsWith("/user"),
        listProfiles,
      });

    test("machine-key file present: the picker never runs, even when listProfiles would find multiple profiles", async () => {
      const seam = new FakeSeam();
      const probes = fakeProbes({
        isGitRepo: (dir) => dir.endsWith("/user"),
        exists: () => true,
        readSymlinkTarget: (path) => (path.endsWith("/skills.jsonc") ? join("user", "skills.jsonc") : null),
        listProfiles: () => {
          throw new Error("listProfiles should never be called when machine-key already exists");
        },
      });

      const { exitCode } = await runHomeInit(probes, seam, new FakeAgeKeySeam());
      expect(exitCode).toBeUndefined();
    });

    test("zero existing profiles: falls back to the hostname slug automatically — no picker, no flag needed", async () => {
      const seam = new FakeSeam();
      const probes = REPO_PRESENT_NO_KEY(() => []);

      const { exitCode } = await runHomeInit(probes, seam, new FakeAgeKeySeam(), [], new FakeSopsYamlSeam(), KEY);

      expect(exitCode).toBeUndefined();
      expect(seam.calls).toContainEqual({ kind: "writeFile", arg: { path: "machine-key", content: KEY } });
      expect(seam.calls).toContainEqual({ kind: "mkdirp", arg: join("user", "local", KEY) });
    });

    test("--profile <existing>: adopts it without ever invoking the picker seam", async () => {
      const seam = new FakeSeam();
      const probes = REPO_PRESENT_NO_KEY(() => ["desktop", "laptop"]);
      const picker = new FakePickerSeam("should-not-be-picked");

      const { exitCode } = await runHomeInit(
        probes,
        seam,
        new FakeAgeKeySeam(),
        ["--profile", "laptop"],
        new FakeSopsYamlSeam(),
        KEY,
        picker,
      );

      expect(exitCode).toBeUndefined();
      expect(picker.calls).toEqual([]);
      expect(seam.calls).toContainEqual({ kind: "writeFile", arg: { path: "machine-key", content: "laptop" } });
      // Already-existing profile dir — ensureProfileDir must not fire for it.
      expect(seam.calls.some((c) => c.kind === "mkdirp" && c.arg === join("user", "local", "laptop"))).toBe(false);
    });

    test("--profile <new> --new-profile: creates the named profile", async () => {
      const seam = new FakeSeam();
      const probes = REPO_PRESENT_NO_KEY(() => ["desktop"]);

      const { exitCode } = await runHomeInit(
        probes,
        seam,
        new FakeAgeKeySeam(),
        ["--profile", "new-box", "--new-profile"],
        new FakeSopsYamlSeam(),
        KEY,
      );

      expect(exitCode).toBeUndefined();
      expect(seam.calls).toContainEqual({ kind: "writeFile", arg: { path: "machine-key", content: "new-box" } });
      expect(seam.calls).toContainEqual({ kind: "mkdirp", arg: join("user", "local", "new-box") });
    });

    test("--profile naming a non-existent profile without --new-profile: exits 1, directs to --new-profile, touches nothing", async () => {
      const seam = new FakeSeam();
      const probes = REPO_PRESENT_NO_KEY(() => ["desktop"]);
      const picker = new FakePickerSeam("desktop");

      const { exitCode, errors } = await runHomeInit(
        probes,
        seam,
        new FakeAgeKeySeam(),
        ["--profile", "ghost"],
        new FakeSopsYamlSeam(),
        KEY,
        picker,
      );

      expect(exitCode).toBe(1);
      expect(errors.some((e) => e.includes("ghost") && e.includes("as a new profile"))).toBe(true);
      expect(errors).toContain("  next: rt home init --profile ghost --new-profile");
      expect(picker.calls).toEqual([]);
      expect(seam.calls).toEqual([]);
    });

    test("existing profiles, no flags, non-interactive: exits 1 directing to --profile/--new-profile, never invokes the picker", async () => {
      const seam = new FakeSeam();
      const probes = REPO_PRESENT_NO_KEY(() => ["desktop", "laptop"]);
      const picker = new FakePickerSeam("desktop");

      const { exitCode, errors } = await runHomeInit(
        probes,
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        picker,
        () => false,
      );

      expect(exitCode).toBe(1);
      expect(errors.some((e) => e.includes("no terminal to ask which"))).toBe(true);
      expect(picker.calls).toEqual([]);
      expect(seam.calls).toEqual([]);
    });

    test("existing profiles, no flags, interactive: runs the picker with the profile list + hostname slug, uses its answer", async () => {
      const seam = new FakeSeam();
      const probes = REPO_PRESENT_NO_KEY(() => ["desktop", "laptop"]);
      const picker = new FakePickerSeam("laptop");

      const { exitCode } = await runHomeInit(
        probes,
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        picker,
        () => true,
      );

      expect(exitCode).toBeUndefined();
      expect(picker.calls).toEqual([{ profiles: ["desktop", "laptop"], hostnameSlug: KEY }]);
      expect(seam.calls).toContainEqual({ kind: "writeFile", arg: { path: "machine-key", content: "laptop" } });
    });

    test("interactive picker returns null (Esc/Ctrl-C): exits 1, never writes a machine-key", async () => {
      const seam = new FakeSeam();
      const probes = REPO_PRESENT_NO_KEY(() => ["desktop", "laptop"]);
      const picker = new FakePickerSeam(null);

      const { exitCode, errors } = await runHomeInit(
        probes,
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        picker,
        () => true,
      );

      expect(exitCode).toBe(1);
      expect(errors.some((e) => e.includes("No machine profile was chosen"))).toBe(true);
      expect(seam.calls.some((c) => c.kind === "writeFile" && (c.arg as any).path === "machine-key")).toBe(false);
    });

    test("existing profiles, no flags, interactive, --dry-run: reports a prompt would run, executes nothing", async () => {
      const seam = new FakeSeam();
      const probes = REPO_PRESENT_NO_KEY(() => ["desktop", "laptop"]);
      const picker = new FakePickerSeam("laptop");

      const { exitCode, logs } = await runHomeInit(
        probes,
        seam,
        new FakeAgeKeySeam(),
        ["--dry-run"],
        new FakeSopsYamlSeam(),
        KEY,
        picker,
        () => true,
      );

      expect(exitCode).toBeUndefined();
      expect(picker.calls).toEqual([]);
      expect(logs.some((l) => l.includes("desktop") && l.includes("laptop"))).toBe(true);
      expect(logs).toContain("  next: rt home init --profile <key>");
      expect(seam.calls).toEqual([]);
    });

    test("--profile resolved by flag, --dry-run: still prints the full remaining plan instead of stopping short", async () => {
      const seam = new FakeSeam();
      const probes = REPO_PRESENT_NO_KEY(() => ["desktop", "laptop"]);

      const { exitCode, logs } = await runHomeInit(
        probes,
        seam,
        new FakeAgeKeySeam(),
        ["--profile", "laptop", "--dry-run"],
        new FakeSopsYamlSeam(),
        KEY,
      );

      expect(exitCode).toBeUndefined();
      expect(seam.calls).toEqual([]);
      expect(logs).toContain("[not yet] Name this Mac  laptop");
    });

    test("truly fresh machine (no local user/ clone yet): clones BEFORE the profile choice, then provisions with the chosen key", async () => {
      const seam = new FakeSeam();
      let cloned = false;
      const probes = fakeProbes({
        isGitRepo: () => false,
        exists: () => false,
        listProfiles: () => {
          // Only knowable once the clone has actually happened.
          if (!cloned) throw new Error("listProfiles called before the clone step ran");
          return ["desktop"];
        },
      });
      const cloneAwareSeam = new (class extends FakeSeam {
        override async run(cmd: string[]) {
          const result = await super.run(cmd);
          if (cmd[0] === "git" && cmd[1] === "clone") cloned = true;
          return result;
        }
      })();

      const { exitCode } = await runHomeInit(
        probes,
        cloneAwareSeam,
        new FakeAgeKeySeam(),
        ["--url", TEST_URL, "--profile", "desktop"],
        new FakeSopsYamlSeam(),
        KEY,
      );

      expect(exitCode).toBeUndefined();
      const cloneCall = cloneAwareSeam.calls.find((c) => c.kind === "run") as { kind: string; arg: string[] } | undefined;
      expect(cloneCall?.arg).toEqual(["git", "clone", TEST_URL, "user"]);
      expect(cloneAwareSeam.calls).toContainEqual({ kind: "writeFile", arg: { path: "machine-key", content: "desktop" } });
    });

    test("truly fresh machine, --dry-run: never clones, notes the key shown is only the no-profiles-yet fallback", async () => {
      const seam = new FakeSeam();
      const probes = fakeProbes({ isGitRepo: () => false, exists: () => false });

      const { exitCode, logs } = await runHomeInit(probes, seam, new FakeAgeKeySeam(), ["--dry-run"], new FakeSopsYamlSeam(), KEY);

      expect(exitCode).toBeUndefined();
      expect(seam.calls).toEqual([]);
      expect(logs.some((l) => l.includes("no machine-key file yet"))).toBe(true);
      expect(logs).toContain("  next: rt home init --profile <key>");
    });

    test("truly fresh machine, --dry-run: says materialize will also run, since its plan can't be previewed pre-clone", async () => {
      const seam = new FakeSeam();
      const probes = fakeProbes({ isGitRepo: () => false, exists: () => false });

      const { logs } = await runHomeInit(probes, seam, new FakeAgeKeySeam(), ["--dry-run"], new FakeSopsYamlSeam(), KEY);

      expect(logs.some((l) => l.includes("rt will also refresh"))).toBe(true);
    });

    test("truly fresh machine, --dry-run --no-materialize: stays silent about materialize", async () => {
      const seam = new FakeSeam();
      const probes = fakeProbes({ isGitRepo: () => false, exists: () => false });

      const { logs } = await runHomeInit(
        probes,
        seam,
        new FakeAgeKeySeam(),
        ["--dry-run", "--no-materialize"],
        new FakeSopsYamlSeam(),
        KEY,
      );

      expect(logs.some((l) => l.includes("rt will also refresh"))).toBe(false);
    });

    test("--new-profile as a bare flag: uses the hostname slug, no picker", async () => {
      const seam = new FakeSeam();
      const probes = REPO_PRESENT_NO_KEY(() => ["desktop"]);

      const { exitCode } = await runHomeInit(
        probes,
        seam,
        new FakeAgeKeySeam(),
        ["--new-profile"],
        new FakeSopsYamlSeam(),
        KEY,
      );

      expect(exitCode).toBeUndefined();
      expect(seam.calls).toContainEqual({ kind: "writeFile", arg: { path: "machine-key", content: KEY } });
      expect(seam.calls).toContainEqual({ kind: "mkdirp", arg: join("user", "local", KEY) });
    });
  });

  describe("--profile arg validation", () => {
    test("--profile as the last arg (no value): exits 1 with a clear error, runs nothing", async () => {
      const seam = new FakeSeam();
      const { exitCode, errors } = await runHomeInit(fakeProbes({}), seam, new FakeAgeKeySeam(), ["--profile"]);

      expect(exitCode).toBe(1);
      expect(errors.some((e) => e.includes("  next: rt home init --profile <key>"))).toBe(true);
      expect(seam.calls).toEqual([]);
    });

  });

  describe("--profile/--new-profile on an already-keyed machine", () => {
    test("--profile on a fully-provisioned machine: exits 1 with a directed message, never prints 'fully provisioned'", async () => {
      const seam = new FakeSeam();
      const picker = new FakePickerSeam("should-not-be-picked");

      const { exitCode, logs, errors } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        ["--profile", "other-box"],
        new FakeSopsYamlSeam(),
        KEY,
        picker,
      );

      expect(exitCode).toBe(1);
      expect(errors[0]).toBe("[refused] This Mac already has a machine profile");
      expect(errors.some((e) => e.includes(KEY) && e.includes("machine-key"))).toBe(true);
      expect(logs.some((l) => l.includes("Nothing to set up"))).toBe(false);
      expect(picker.calls).toEqual([]);
      expect(seam.calls).toEqual([]);
    });

    test("--new-profile on a fully-provisioned machine: exits 1 with the same directed message, touches nothing", async () => {
      const seam = new FakeSeam();

      const { exitCode, errors } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        ["--new-profile"],
        new FakeSopsYamlSeam(),
        KEY,
      );

      expect(exitCode).toBe(1);
      expect(errors.some((e) => e.includes(KEY) && e.includes("machine-key"))).toBe(true);
      expect(seam.calls).toEqual([]);
    });

    test("neither flag, machine-key already present: unaffected — still runs (or no-ops) normally", async () => {
      const seam = new FakeSeam();
      const { exitCode, logs } = await runHomeInit(FULLY_PROVISIONED_PROBES(), seam, new FakeAgeKeySeam());

      expect(exitCode).toBeUndefined();
      expect(logs.some((l) => l.includes("machine-key"))).toBe(false);
    });
  });

  describe("materialize (last phase)", () => {
    test("runs on a fully-provisioned machine too, even though no init step is due", async () => {
      const seam = new FakeSeam();
      const exec = new FakeMaterializeExecSeam();

      const { exitCode, logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => NOOP_MATERIALIZE_ENV,
        exec,
      );

      expect(exitCode).toBeUndefined();
      expect(exec.calls).toEqual([["rt", "intercept", "install"]]);
      expect(logs.some((l) => l.includes("Set up rt's git intercept"))).toBe(true);
      expect(logs.some((l) => l.includes("Set up rt's git intercept"))).toBe(true);
      // Materialize always does at least rtInterceptInstall, so a live run
      // must never claim "nothing to do" one breath before doing something.
      expect(logs.some((l) => l.includes("Nothing to set up"))).toBe(false);
    });

    test("--no-materialize on a live, fully-provisioned run: 'nothing to do' is honest again since materialize is actually skipped", async () => {
      const seam = new FakeSeam();
      const { logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        ["--no-materialize"],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => NOOP_MATERIALIZE_ENV,
      );

      expect(logs.some((l) => l.includes("Nothing to set up"))).toBe(true);
    });

    test("--no-materialize skips gathering the env and running any step", async () => {
      const seam = new FakeSeam();
      const exec = new FakeMaterializeExecSeam();
      let envCalled = false;

      const { exitCode, logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        ["--no-materialize"],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => {
          envCalled = true;
          return NOOP_MATERIALIZE_ENV;
        },
        exec,
      );

      expect(exitCode).toBeUndefined();
      expect(envCalled).toBe(false);
      expect(exec.calls).toEqual([]);
      expect(logs.some((l) => l.includes("Skipped the refresh"))).toBe(true);
    });

    test("--dry-run previews the materialize plan (read-only env gathering) without running any step", async () => {
      const seam = new FakeSeam();
      const exec = new FakeMaterializeExecSeam();
      const env: MaterializeEnv = { ...NOOP_MATERIALIZE_ENV, deckOnPath: true };

      const { exitCode, logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        ["--dry-run"],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => env,
        exec,
      );

      expect(exitCode).toBeUndefined();
      expect(exec.calls).toEqual([]); // env gathering never spawns a materialize step
      expect(logs.some((l) => l.includes("rt would also refresh"))).toBe(true);
      expect(logs.some((l) => l.includes("Set up rt's git intercept"))).toBe(true);
      expect(logs.some((l) => l.includes("Set up deck"))).toBe(true);
    });

    test("--dry-run previews an already-healthy deck as skipped, not as a pending deck setup", async () => {
      const seam = new FakeSeam();
      const env: MaterializeEnv = { ...NOOP_MATERIALIZE_ENV, deckOnPath: true, deckHealthy: true };

      const { logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        ["--dry-run"],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => env,
      );

      expect(logs.some((l) => l.includes("[skipped] Set up deck") && l.includes("already running well"))).toBe(true);
    });

    test("--dry-run on a fully-provisioned machine no longer claims 'nothing to do' once materialize would run something", async () => {
      const seam = new FakeSeam();
      const { logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        ["--dry-run"],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => NOOP_MATERIALIZE_ENV, // still plans rtInterceptInstall
      );

      expect(logs.some((l) => l.includes("Nothing to set up"))).toBe(false);
      expect(logs.some((l) => l.includes("rt would also refresh"))).toBe(true);
    });

    test("--dry-run --no-materialize: no preview, 'nothing to do' still prints on a fully-provisioned machine", async () => {
      const seam = new FakeSeam();
      let envCalled = false;
      const { logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        ["--dry-run", "--no-materialize"],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => {
          envCalled = true;
          return NOOP_MATERIALIZE_ENV;
        },
      );

      expect(envCalled).toBe(false);
      expect(logs.some((l) => l.includes("rt would also refresh"))).toBe(false);
      expect(logs.some((l) => l.includes("Nothing to set up"))).toBe(true);
    });

    test("a missing rt daemon runs rtDaemonInstall too, in addition to rtInterceptInstall", async () => {
      const seam = new FakeSeam();
      const exec = new FakeMaterializeExecSeam();
      const env: MaterializeEnv = { ...NOOP_MATERIALIZE_ENV, daemonInstalled: false };

      await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => env,
        exec,
      );

      expect(exec.calls).toEqual([
        ["rt", "intercept", "install"],
        ["rt", "daemon", "install"],
      ]);
    });

    test("deck on PATH and mr-board cloned locally: both setup steps run", async () => {
      const seam = new FakeSeam();
      const exec = new FakeMaterializeExecSeam();
      const env: MaterializeEnv = { ...NOOP_MATERIALIZE_ENV, deckOnPath: true, boardRepoPath: "/repos/mr-board" };

      const { logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => env,
        exec,
      );

      expect(exec.calls).toEqual([["rt", "intercept", "install"], ["deck", "setup"]]);
      // boardSetup never spawns — mr-board's setup prompts interactively — it only prints the manual command, once.
      expect(logs.some((l) => l.includes("Set up mr-board"))).toBe(true);
      const manualCommandLines = logs.filter((l) => l.includes("/repos/mr-board") && l.includes("scripts/setup.ts"));
      expect(manualCommandLines).toEqual(['  next: Run this yourself, it asks questions: cd "/repos/mr-board" && bun run scripts/setup.ts']);
      expect(logs[logs.indexOf(manualCommandLines[0]!) - 1]).toBe("[needs you] Set up mr-board  you run this one yourself");
    });

    test("deck on PATH but already healthy: deck setup never spawns (it restarts the live proxy) — reported as skipped instead", async () => {
      const seam = new FakeSeam();
      const exec = new FakeMaterializeExecSeam();
      const env: MaterializeEnv = { ...NOOP_MATERIALIZE_ENV, deckOnPath: true, deckHealthy: true };

      const { logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => env,
        exec,
      );

      expect(exec.calls).toEqual([["rt", "intercept", "install"]]); // deck setup never spawned
      expect(logs.some((l) => l.includes("already running well"))).toBe(true);
      expect(logs.some((l) => l.includes("deck is already running well"))).toBe(true);
    });

    test("a tracked repo missing from disk is reported by name, never cloned", async () => {
      const seam = new FakeSeam();
      const exec = new FakeMaterializeExecSeam();
      const env: MaterializeEnv = {
        ...NOOP_MATERIALIZE_ENV,
        trackedRepos: [{ name: "gitq", path: "/repos/gitq", present: false }],
      };

      const { logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => env,
        exec,
      );

      expect(exec.calls).toEqual([["rt", "intercept", "install"]]); // report-only: no clone spawned
      expect(logs.some((l) => l.includes("gitq") && l.includes("not on this Mac yet"))).toBe(true);
    });

    test("an rt-own step failing exits 1, but a non-rt-own step failing does not", async () => {
      const seam = new FakeSeam();
      const exec = new FakeMaterializeExecSeam();
      exec.script(["rt", "intercept", "install"], { stdout: "", stderr: "boom", exitCode: 1 });
      const env: MaterializeEnv = { ...NOOP_MATERIALIZE_ENV, deckOnPath: true };
      exec.script(["deck", "setup"], { stdout: "", stderr: "deck exploded", exitCode: 1 });

      const { exitCode, errors, logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => env,
        exec,
      );

      expect(exitCode).toBe(1);
      expect(errors.some((e) => e.includes("one of its own pieces"))).toBe(true);
      // The failing non-rt-own step still ran and is reported, not swallowed.
      expect(logs.some((l) => l.includes("Set up deck"))).toBe(true);
      expect(logs.some((l) => l.includes("deck exploded"))).toBe(true);
      // The failed-check runs BEFORE the success line — an rt-own failure must never claim "provisioned."
      expect(logs.some((l) => l.includes("This Mac is set up"))).toBe(false);
    });

    test("a deckSetup failure alone (rt-own steps all ok) still prints success and exits 0", async () => {
      const seam = new FakeSeam();
      const exec = new FakeMaterializeExecSeam();
      const env: MaterializeEnv = { ...NOOP_MATERIALIZE_ENV, deckOnPath: true };
      exec.script(["deck", "setup"], { stdout: "", stderr: "deck exploded", exitCode: 1 });

      const { exitCode, logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => env,
        exec,
      );

      expect(exitCode).toBeUndefined();
      expect(logs.some((l) => l.includes("This Mac is set up"))).toBe(true);
    });

    test("an unhealthy deck owned by the app's helper is reported, never repaired with deck setup, and init still exits 0", async () => {
      const seam = new FakeSeam();
      const exec = new FakeMaterializeExecSeam();
      const env: MaterializeEnv = { ...NOOP_MATERIALIZE_ENV, deckOnPath: true, deckHelperLabel: "com.mattstack.deck.dev" };

      const { exitCode, logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => env,
        exec,
      );

      expect(exitCode).toBeUndefined();
      expect(exec.calls.some((argv) => argv[0] === "deck")).toBe(false);
      expect(logs.some((l) => l.includes("owns deck"))).toBe(true);
      expect(logs.some((l) => l.includes("launchctl print gui/$(id -u)/com.mattstack.deck.dev"))).toBe(true);
    });

    test("rt-own steps' stdout is printed even on a clean exit — rt daemon install's approval guidance must not be discarded", async () => {
      const seam = new FakeSeam();
      const exec = new FakeMaterializeExecSeam();
      exec.script(["rt", "daemon", "install"], {
        stdout: "daemon not yet responding — approve it in System Settings",
        stderr: "",
        exitCode: 0,
      });
      const env: MaterializeEnv = { ...NOOP_MATERIALIZE_ENV, daemonInstalled: false };

      const { exitCode, logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => env,
        exec,
      );

      expect(exitCode).toBeUndefined();
      expect(logs.some((l) => l.includes("approve it in System Settings"))).toBe(true);
      const daemon = logs.indexOf("[ok] Set up the rt daemon");
      expect(daemon).toBeGreaterThanOrEqual(0);
      expect(logs.slice(daemon + 1).some((l) => l.includes("approve it in System Settings"))).toBe(true);
    });

    test("multi-line captured stdout is indented per line, not just on its first line", async () => {
      const seam = new FakeSeam();
      const exec = new FakeMaterializeExecSeam();
      exec.script(["rt", "daemon", "install"], {
        stdout: "line one\nline two\nline three",
        stderr: "",
        exitCode: 0,
      });
      const env: MaterializeEnv = { ...NOOP_MATERIALIZE_ENV, daemonInstalled: false };

      const { logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => env,
        exec,
      );

      // Each source line is its own output line, never one line carrying an embedded "\n".
      expect(logs.some((l) => l.includes("line one"))).toBe(true);
      expect(logs.some((l) => l.includes("line two"))).toBe(true);
      expect(logs.some((l) => l.includes("line three"))).toBe(true);
      expect(logs.some((l) => l.includes("line one") && l.includes("\n"))).toBe(false);
      expect(logs.some((l) => l.includes("line two") && l.includes("\n"))).toBe(false);
      expect(logs.some((l) => l.includes("line three") && l.includes("\n"))).toBe(false);
    });

    test("a throwing materializeEnv on the real (non-dry-run) run is caught, reported, and never crashes init — provisioning already succeeded", async () => {
      const seam = new FakeSeam();
      const exec = new FakeMaterializeExecSeam();

      const { exitCode, logs } = await runHomeInit(
        FULLY_PROVISIONED_PROBES(),
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => {
          throw new Error("boom: env gathering exploded");
        },
        exec,
      );

      expect(exitCode).toBeUndefined(); // a non-rt-own materialize failure never gates the exit code
      expect(logs.some((l) => l.includes("boom: env gathering exploded"))).toBe(true);
      expect(logs.some((l) => l.includes("This Mac is set up"))).toBe(true);
      expect(exec.calls).toEqual([]); // never reached runMaterialize
    });

    test("a symlink-blocked run never reaches materialize at all", async () => {
      const seam = new FakeSeam();
      const exec = new FakeMaterializeExecSeam();
      const probes = fakeProbes({
        isGitRepo: (dir) => dir.endsWith("/user"),
        exists: () => true,
        readSymlinkTarget: () => null, // a real file blocks the skills.jsonc symlink
      });

      const { exitCode } = await runHomeInit(
        probes,
        seam,
        new FakeAgeKeySeam(),
        [],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => {
          throw new Error("materializeEnv should not have been called");
        },
        exec,
      );

      expect(exitCode).toBe(1);
      expect(exec.calls).toEqual([]);
    });

    test("--dry-run on a symlink-blocked plan never previews materialize — the live run would exit 1 before ever reaching it", async () => {
      const seam = new FakeSeam();
      const probes = fakeProbes({
        isGitRepo: (dir) => dir.endsWith("/user"),
        exists: () => true,
        readSymlinkTarget: () => null, // a real file blocks the skills.jsonc symlink
      });

      const { exitCode, logs } = await runHomeInit(
        probes,
        seam,
        new FakeAgeKeySeam(),
        ["--dry-run"],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => {
          throw new Error("materializeEnv should not have been called on a blocked dry-run either");
        },
      );

      expect(exitCode).toBeUndefined();
      expect(logs.some((l) => l.includes("rt would also refresh"))).toBe(false);
    });

    test("a configured claude.marketplaces prints the installer pointer, never replays anything itself", async () => {
      const origHome = process.env.HOME;
      const isolatedHome = realpathSync(mkdtempSync(join(tmpdir(), "rt-home-claude-pointer-")));
      process.env.HOME = isolatedHome;
      try {
        const seam = new FakeSeam();
        setSetting("claude.marketplaces", ["acme/claude-plugins"], "user");

        const { logs } = await runHomeInit(FULLY_PROVISIONED_PROBES(), seam, new FakeAgeKeySeam());

        expect(logs.some((l) => l.includes("Claude plugin") && l.includes("installer"))).toBe(true);
      } finally {
        process.env.HOME = origHome;
        rmSync(isolatedHome, { recursive: true, force: true });
      }
    });
  });

  test("a failed clone leads with one plain title, and what git said follows with escapes stripped", async () => {
    class FailingCloneSeam extends FakeSeam {
      override async run(cmd: string[]): Promise<ExecResult> {
        if (cmd[1] === "clone") return { code: 128, stdout: "", stderr: "\x1b[2Jfatal: repository not found\n\nline two" };
        return super.run(cmd);
      }
    }
    const { exitCode, logs, errors } = await runHomeInit(fakeProbes({}), new FailingCloneSeam(), new FakeAgeKeySeam(), ["--url", TEST_URL]);

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["rt could not clone your home repo", "what it said:", "  fatal: repository not found", "  line two"]);
    expect(logs).toContain(`[failed] Clone your home repo  ${TEST_URL}`);
  });

  test("each stage ends in its own line, and the run ends with one line when the Mac is set up", async () => {
    const { exitCode, logs } = await runHomeInit(fakeProbes({}), new FakeSeam(), new FakeAgeKeySeam(), ["--url", TEST_URL, "--no-materialize"]);

    expect(exitCode).toBeUndefined();
    expect(logs[0]).toBe(`Setting up your home folder (${mattstackHome()})`);
    const plan = logs.indexOf(`[not yet] Clone your home repo  ${TEST_URL}`);
    const ran = logs.indexOf(`[ok] Clone your home repo  ${TEST_URL}`);
    expect(plan).toBeGreaterThan(0);
    expect(ran).toBeGreaterThan(plan);
    expect(logs).toContain("[skipped] Skipped the refresh of what rt generates from your settings");
    expect(logs.at(-1)).toBe(`[ok] This Mac is set up  ${mattstackHome()}`);
    expect(logs.join("\n")).not.toContain("\x1b[");
    expect(logs.join("\n")).not.toContain("Cloning ");
  });

  test("a wrong key in the keychain is one failure with its why and the import command", async () => {
    const sopsYamlSeam = new FakeSopsYamlSeam({ path: SOPS_YAML_PATH, content: renderSopsYaml("age1stale-recipient-from-another-machine") });
    const { exitCode, errors } = await runHomeInit(FULLY_PROVISIONED_PROBES(), new FakeSeam(), new FakeAgeKeySeamWithExistingKey(), [], sopsYamlSeam);

    expect(exitCode).toBe(1);
    expect(errors[0]).toBe("This Mac's key does not match your secrets");
    expect(errors[1]).toStartWith("  why: They are locked to age1stale-re");
    expect(errors[2]).toBe("  next: rt home key import --force");
  });

  test("the tray's dry run with no terminal to pick a profile leads with the question, and nothing before it", async () => {
    const probes = fakeProbes({ isGitRepo: (dir) => dir.endsWith("/user"), exists: (path) => path.endsWith("/user"), listProfiles: () => ["desktop", "laptop"] });
    const { exitCode, logs, errors } = await runHomeInit(probes, new FakeSeam(), new FakeAgeKeySeam(), ["--dry-run", "--json"], new FakeSopsYamlSeam(), KEY, new UnreachablePickerSeam(), () => false);

    expect(exitCode).toBe(1);
    expect(logs).toEqual([]);
    expect(errors[0]).toBe("Which machine profile should this Mac use?");
    expect(errors[1]).toBe("  why: This Mac could use any of 2 machine profiles (desktop, laptop), and there is no terminal to ask which.");
    expect(errors).toContain("  next: rt home init --profile <key>");
    // TeamChoiceModel.homeInitCheck shows the first 200 bytes of stderr with its newlines turned into spaces.
    expect(errors.join("\n").slice(0, 200).replace(/\n/g, " ")).toStartWith("Which machine profile should this Mac use?   why: This Mac could use");
  });

  test("a credential in the clone url never reaches the CLI log", async () => {
    const cliLogs = (): Map<string, string> =>
      new Map(
        existsSync(logsDir())
          ? readdirSync(logsDir())
              .filter((f) => f.startsWith("cli.") && f.endsWith(".log"))
              .map((f) => [f, readFileSync(join(logsDir(), f), "utf8")])
          : [],
      );
    const before = cliLogs();
    const secretUrl = "https://x-access-token:ghp_sample0credcheck@forge.example.test/sample/credential-check.git";
    const { exitCode } = await runHomeInit(fakeProbes({}), new FakeSeam(), new FakeAgeKeySeam(), ["--url", secretUrl, "--no-materialize"]);

    expect(exitCode).toBeUndefined();
    const written = [...cliLogs()].map(([file, text]) => text.slice(before.get(file)?.length ?? 0)).join("");
    expect(written).toContain('"msg":"Cloning <remote>"');
    expect([...cliLogs().values()].join("")).not.toContain("ghp_sample0credcheck");
  });
});

describe("homeInit at a terminal", () => {
  const FAKE_UI = join(import.meta.dir, "..", "..", "lib", "ui", "__tests__", "fake-rt-ui.ts");
  let dir: string;
  let record: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rt-home-steps-"));
    record = join(dir, "record.ndjson");
    process.env.RT_UI_BIN = FAKE_UI;
    process.env.RT_UI_FAKE = JSON.stringify({ record });
    gateTest.setInteractive(() => true);
  });
  afterEach(() => {
    gateTest.setInteractive(undefined);
    delete process.env.RT_UI_BIN;
    delete process.env.RT_UI_FAKE;
    rmSync(dir, { recursive: true, force: true });
  });

  type Sent = { t: string; title?: string; text?: string; hint?: string; status?: string };

  /** Each stage is its own helper process, which appends what it received when it ends: one list per stage, hello dropped. */
  function stages(): Sent[][] {
    const out: Sent[][] = [];
    for (const line of readFileSync(record, "utf8").trim().split("\n")) {
      const msg = JSON.parse(line) as Sent;
      if (msg.t === "hello") out.push([]);
      else out.at(-1)!.push(msg);
    }
    return out;
  }

  const REFRESH_ENV: MaterializeEnv = {
    ...NOOP_MATERIALIZE_ENV,
    daemonInstalled: false,
    deckOnPath: true,
    deckHealthy: true,
    boardRepoPath: "/repos/mr-board",
    trackedRepos: [{ name: "gitq", path: "/repos/gitq", present: false }],
  };

  function refreshExec(): FakeMaterializeExecSeam {
    const exec = new FakeMaterializeExecSeam();
    exec.script(["rt", "daemon", "install"], { stdout: "daemon not yet responding: approve it in System Settings", stderr: "", exitCode: 0 });
    return exec;
  }

  const refreshRun = (exec: FakeMaterializeExecSeam = refreshExec(), env: MaterializeEnv = REFRESH_ENV) =>
    runHomeInit(FULLY_PROVISIONED_PROBES(), new FakeSeam(), new FakeAgeKeySeam(), [], new FakeSopsYamlSeam(), KEY, new UnreachablePickerSeam(), () => false, async () => env, exec);

  test("each refresh stage is its own rt-ui step, ended in its own state, and nothing it painted reaches stdout", async () => {
    const { exitCode, logs } = await refreshRun();

    expect(exitCode).toBeUndefined();
    expect(stages()).toEqual([
      [{ t: "start", title: "Set up rt's git intercept" }, { t: "done", title: "Set up rt's git intercept" }],
      [{ t: "start", title: "Set up the rt daemon" }, { t: "done", title: "Set up the rt daemon" }],
      [
        { t: "start", title: "Some tracked repos are not on this Mac yet" },
        { t: "done", title: "Some tracked repos are not on this Mac yet", hint: "gitq", status: "needs-you" },
      ],
      [{ t: "start", title: "Set up deck" }, { t: "done", title: "Set up deck", hint: "deck is already running well", status: "skipped" }],
      [{ t: "start", title: "Set up mr-board" }, { t: "done", title: "Set up mr-board", hint: "you run this one yourself", status: "needs-you" }],
    ]);
    expect(logs.some((l) => /^\[[a-z ]+\] (Set up (rt's git intercept|the rt daemon|deck|mr-board)|Some tracked repos)/.test(l))).toBe(false);
    expect(logs.some((l) => l.includes("approve it in System Settings"))).toBe(true);
    expect(logs.at(-1)).toBe(`[ok] This Mac is set up  ${mattstackHome()}`);
  });

  test("a refresh step rt does not own that fails ends warn, with what it said printed after it", async () => {
    const exec = new FakeMaterializeExecSeam();
    exec.script(["deck", "setup"], { stdout: "", stderr: "deck exploded", exitCode: 1 });
    const { exitCode, logs } = await refreshRun(exec, { ...NOOP_MATERIALIZE_ENV, deckOnPath: true });

    expect(exitCode).toBeUndefined();
    expect(stages()[1]).toEqual([{ t: "start", title: "Set up deck" }, { t: "done", title: "Set up deck", status: "warn" }]);
    expect(logs.some((l) => l.includes("deck exploded"))).toBe(true);
  });

  test("a failed stage keeps its progress line and ends failing", async () => {
    const seam = new FakeSeam({ failRun: (cmd) => cmd[1] === "clone" });
    const { exitCode, logs, errors } = await runHomeInit(fakeProbes({}), seam, new FakeAgeKeySeam(), ["--url", TEST_URL]);

    expect(exitCode).toBe(1);
    expect(stages().find((s) => s[0]?.title === "Clone your home repo")).toEqual([
      { t: "start", title: "Clone your home repo" },
      { t: "sub", text: `Cloning ${TEST_URL}` },
      { t: "fail", title: "Clone your home repo", hint: TEST_URL },
    ]);
    expect(logs).not.toContain(`[failed] Clone your home repo  ${TEST_URL}`);
    expect(errors[0]).toBe("rt could not clone your home repo");
  });

  test("a helper that dies leaves one plain line per stage, each with its guidance after it", async () => {
    process.env.RT_UI_FAKE = JSON.stringify({ dieOn: "start" });
    const { exitCode, logs } = await refreshRun();

    expect(exitCode).toBeUndefined();
    expect(logs).toContain("[ok] Set up rt's git intercept");
    const daemon = logs.indexOf("[ok] Set up the rt daemon");
    expect(daemon).toBeGreaterThan(logs.indexOf("[ok] Set up rt's git intercept"));
    expect(logs[daemon + 1]).toContain("approve it in System Settings");
    expect(logs).toContain("[needs you] Some tracked repos are not on this Mac yet  gitq");
    expect(logs).toContain("[skipped] Set up deck  deck is already running well");
    expect(logs).toContain("[needs you] Set up mr-board  you run this one yourself");
  });
});

describe("resolveHomeUrl", () => {
  test("--url wins over intent and env", () => {
    const url = resolveHomeUrl(["--url", "https://x/a.git"], {
      readIntent: () => ({ v: 1, at: "", mode: "create", homeRepo: "https://x/b.git" }) as SetupIntent,
      env: { RT_HOME_URL: "https://x/c.git" },
    });
    expect(url).toBe("https://x/a.git");
  });

  test("intent homeRepo beats RT_HOME_URL", () => {
    const url = resolveHomeUrl([], {
      readIntent: () => ({ v: 1, at: "", mode: "create", homeRepo: "https://x/b.git" }) as SetupIntent,
      env: { RT_HOME_URL: "https://x/c.git" },
    });
    expect(url).toBe("https://x/b.git");
  });

  test("RT_HOME_URL is used when nothing else supplies one", () => {
    expect(resolveHomeUrl([], { readIntent: () => null, env: { RT_HOME_URL: "https://x/c.git" } })).toBe("https://x/c.git");
  });

  test("no url anywhere resolves to null — local-only, never a built-in default", () => {
    expect(resolveHomeUrl([], { readIntent: () => null, env: {} })).toBeNull();
  });

  test("--url with no value still throws rather than falling through to local-only", () => {
    expect(() => resolveHomeUrl(["--url"], { readIntent: () => null, env: {} })).toThrow(InvalidUrlArgError);
  });

  test("an exported-but-empty RT_HOME_URL is unset, never a clone of \"\"", () => {
    expect(resolveHomeUrl([], { readIntent: () => null, env: { RT_HOME_URL: "" } })).toBeNull();
  });

  test("restore.homeRepo is honoured — otherwise a local-only repo squats the path home.restore needs", () => {
    const url = resolveHomeUrl([], {
      readIntent: () => ({ v: 1, at: "", mode: "restore", restore: { homeRepo: "https://x/restore.git" } }) as SetupIntent,
      env: { RT_HOME_URL: "https://x/c.git" },
    });
    expect(url).toBe("https://x/restore.git");
  });
});

/**
 * Deliberately NOT seamed: the seamed tests above pass `readIntent` in
 * directly and so cannot catch a default wired at the wrong path.
 */
describe("homeInit — the real intent read", () => {
  test("reads the setup-intent.json that setup actually writes, so intent still outranks RT_HOME_URL", async () => {
    const origHome = process.env.HOME;
    const isolatedHome = realpathSync(mkdtempSync(join(tmpdir(), "rt-home-intent-")));
    process.env.HOME = isolatedHome;
    try {
      const intentFile = join(isolatedHome, ".mattstack", "rt", "setup-intent.json");
      mkdirSync(dirname(intentFile), { recursive: true });
      writeFileSync(intentFile, JSON.stringify({ v: 1, at: "", mode: "create", homeRepo: "https://x/from-intent.git" }));

      const probes = fakeProbes({ exists: (path) => path.endsWith("/machine-key") });
      const { logs } = await runHomeInit(
        probes,
        new FakeSeam(),
        new FakeAgeKeySeam(),
        ["--dry-run", "--no-materialize"],
        new FakeSopsYamlSeam(),
        KEY,
        new UnreachablePickerSeam(),
        () => false,
        async () => NOOP_MATERIALIZE_ENV,
        new FakeMaterializeExecSeam(),
        { RT_HOME_URL: "https://x/from-env.git" },
        "real-disk-read",
      );

      expect(logs.join("\n")).toContain("Clone your home repo  https://x/from-intent.git");
    } finally {
      process.env.HOME = origHome;
      rmSync(isolatedHome, { recursive: true, force: true });
    }
  });
});

describe("claudePluginsPointerMessage", () => {
  test("neither key resolved: no message", () => {
    expect(claudePluginsPointerMessage(undefined, undefined)).toBeNull();
  });

  test("marketplaces resolved, plugins not: points at the installer", () => {
    const message = claudePluginsPointerMessage([{ name: "x" }], undefined);
    expect(message).toContain("marketplace settings");
    expect(message).toContain("installer");
  });

  test("plugins resolved, marketplaces not: points at the installer", () => {
    const message = claudePluginsPointerMessage(undefined, ["some-plugin"]);
    expect(message).toContain("Claude plugin");
  });

  test("never suggests rt home init itself replays them", () => {
    const message = claudePluginsPointerMessage([{ name: "x" }], ["y"]);
    expect(message).toContain("not by rt home init");
  });
});

/** Scripts readPort/checkHealthz; never touches a real file or the network. */
function fakeDeckHealthProbe(overrides: Partial<DeckHealthProbe> & { checkHealthzCalls?: number[] } = {}): DeckHealthProbe {
  const calls = overrides.checkHealthzCalls ?? [];
  return {
    readPort: overrides.readPort ?? (() => 41000),
    checkHealthz: overrides.checkHealthz ?? (async (port: number) => { calls.push(port); return true; }),
  };
}

describe("probeDeckHealthy", () => {
  test("api.json present, healthz answers ok: healthy", async () => {
    const probe = fakeDeckHealthProbe({ readPort: () => 41000, checkHealthz: async (port) => port === 41000 });
    expect(await probeDeckHealthy(probe)).toBe(true);
  });

  test("api.json present, healthz refused/times out: unhealthy", async () => {
    const probe = fakeDeckHealthProbe({ readPort: () => 41000, checkHealthz: async () => false });
    expect(await probeDeckHealthy(probe)).toBe(false);
  });

  test("api.json missing or corrupt (readPort null): unhealthy, and healthz is never even attempted", async () => {
    let checkHealthzCalled = false;
    const probe = fakeDeckHealthProbe({
      readPort: () => null,
      checkHealthz: async () => {
        checkHealthzCalled = true;
        return true;
      },
    });
    expect(await probeDeckHealthy(probe)).toBe(false);
    expect(checkHealthzCalled).toBe(false);
  });
});

describe("defaultMaterializeEnv (deck health wiring)", () => {
  /** which deck exits 0 with a real path — deck is on PATH. */
  const deckOnPathExec = { run: async (argv: string[]) => argv[0] === "which" ? { stdout: "/usr/local/bin/deck\n", stderr: "", exitCode: 0 } : { stdout: "", stderr: "", exitCode: 0 } };
  const deckOffPathExec = { run: async () => ({ stdout: "", stderr: "not found", exitCode: 1 }) };

  test("deck on PATH and healthy: env.deckHealthy is true", async () => {
    const env = await defaultMaterializeEnv(deckOnPathExec, fakeDeckHealthProbe({ checkHealthz: async () => true }));
    expect(env.deckOnPath).toBe(true);
    expect(env.deckHealthy).toBe(true);
  });

  test("deck on PATH but unhealthy: env.deckHealthy is false", async () => {
    const env = await defaultMaterializeEnv(deckOnPathExec, fakeDeckHealthProbe({ checkHealthz: async () => false }));
    expect(env.deckOnPath).toBe(true);
    expect(env.deckHealthy).toBe(false);
  });

  test("the bundle deck helper label is carried into the env", async () => {
    const owned = await defaultMaterializeEnv(deckOnPathExec, fakeDeckHealthProbe({ checkHealthz: async () => false }), () => "com.mattstack.deck.dev");
    expect(owned.deckHelperLabel).toBe("com.mattstack.deck.dev");
    const unowned = await defaultMaterializeEnv(deckOnPathExec, fakeDeckHealthProbe({ checkHealthz: async () => false }), () => null);
    expect(unowned.deckHelperLabel).toBeNull();
  });

  test("deck off PATH: the health probe is never even invoked", async () => {
    let probed = false;
    const env = await defaultMaterializeEnv(
      deckOffPathExec,
      fakeDeckHealthProbe({
        readPort: () => {
          probed = true;
          return 41000;
        },
      }),
    );
    expect(env.deckOnPath).toBe(false);
    expect(env.deckHealthy).toBe(false);
    expect(probed).toBe(false);
  });
});

/** Records calls and returns a scripted response; used as the injected daemon seam. */
class FakeDaemonSeam implements HomeDaemonSeam {
  calls: { cmd: string; payload?: Record<string, any> }[] = [];
  constructor(private responder: (cmd: string, payload?: Record<string, any>) => DaemonResponse | null) {}

  async query(cmd: string, payload?: Record<string, any>): Promise<DaemonResponse | null> {
    this.calls.push({ cmd, payload });
    return this.responder(cmd, payload);
  }
}

/** Runs an async CLI function, catching the `process.exit` call the failure paths make. `logs` is stdout by line, `errors` is stderr by line, both as plain text. */
async function runCatchingExit(
  fn: () => Promise<void>,
): Promise<{ exitCode: number | undefined; logs: string[]; errors: string[] }> {
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  try {
    await fn();
    return { exitCode: undefined, logs: io.lines(), errors: io.errLines() };
  } catch {
    const code = exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
    return { exitCode: code, logs: io.lines(), errors: io.errLines() };
  } finally {
    exitSpy.mockRestore();
    io.restore();
  }
}

describe("homeSnapshot", () => {
  const okResult: SnapshotResult = { committed: true, sha: "abc123def456", paths: ["prefs/settings.json"], reason: "manual" };
  const skippedResult: SnapshotResult = { committed: false, sha: null, paths: [], reason: "manual", skipped: "no-changes" };
  const okStatus: SnapshotStatus = {
    id: "home",
    enabled: true,
    watching: true,
    repoDir: "/home/.mattstack",
    lastRunAt: 1_700_000_000_000,
    lastCommit: { sha: "abc123def456", message: "snapshot: 2 paths", at: 1_700_000_000_000 },
    lastCommitError: null,
    pushPending: false,
    lastPushAt: 1_700_000_000_000,
    lastPushError: null,
    lastPullAt: 0,
    lastPullError: null,
    lastPullSkipped: null,
    conflicted: null,
    pullOnly: false,
    claimedZones: ["prefs/"],
    firstSeenDirty: {},
    ownersError: null,
  };

  test("no flag: POSTs home:snapshot with reason manual and prints the sha and paths", async () => {
    const seam = new FakeDaemonSeam((cmd) => (cmd === "home:snapshot" ? { ok: true, data: okResult } : null));
    const { exitCode, logs } = await runCatchingExit(() => homeSnapshot([], {}, seam));

    expect(exitCode).toBeUndefined();
    expect(seam.calls).toEqual([{ cmd: "home:snapshot", payload: { reason: "manual" } }]);
    expect(logs.some((l) => l.includes("abc123de"))).toBe(true);
    expect(logs.some((l) => l.includes("prefs/settings.json"))).toBe(true);
  });

  test("no flag, daemon skipped the run: prints the skip reason, not a fabricated commit", async () => {
    const seam = new FakeDaemonSeam(() => ({ ok: true, data: skippedResult }));
    const { exitCode, logs } = await runCatchingExit(() => homeSnapshot([], {}, seam));

    expect(exitCode).toBeUndefined();
    expect(logs.some((l) => l.includes("no-changes"))).toBe(true);
  });

  test("--status: queries home:snapshot-status (not home:snapshot) and prints the status table", async () => {
    const seam = new FakeDaemonSeam((cmd) => (cmd === "home:snapshot-status" ? { ok: true, data: okStatus } : null));
    const { exitCode, logs } = await runCatchingExit(() => homeSnapshot(["--status"], {}, seam));

    expect(exitCode).toBeUndefined();
    expect(seam.calls).toEqual([{ cmd: "home:snapshot-status", payload: undefined }]);
    expect(logs.some((l) => l.includes("enabled"))).toBe(true);
    expect(logs.some((l) => l.includes("watching: yes"))).toBe(true);
    expect(logs.some((l) => l.includes("abc123de"))).toBe(true);
    expect(logs.some((l) => l.includes("prefs/"))).toBe(true);
  });

  test("--status surfaces an owners-read error and a push error instead of hiding them", async () => {
    const status: SnapshotStatus = { ...okStatus, ownersError: "malformed jsonc", lastPushError: "push failed: non-fast-forward" };
    const seam = new FakeDaemonSeam(() => ({ ok: true, data: status }));
    const { logs } = await runCatchingExit(() => homeSnapshot(["--status"], {}, seam));

    expect(logs.some((l) => l.includes("malformed jsonc"))).toBe(true);
    expect(logs.some((l) => l.includes("push failed: non-fast-forward"))).toBe(true);
  });

  test("--status surfaces a persistent commit failure instead of hiding it", async () => {
    const status: SnapshotStatus = { ...okStatus, lastCommitError: "fatal: unable to create index.lock" };
    const seam = new FakeDaemonSeam(() => ({ ok: true, data: status }));
    const { logs } = await runCatchingExit(() => homeSnapshot(["--status"], {}, seam));

    expect(logs.some((l) => l.includes("fatal: unable to create index.lock"))).toBe(true);
  });

  test("daemon down (null response): exits 1 with the directed 'rt daemon start' message, no stack trace", async () => {
    const seam = new FakeDaemonSeam(() => null);
    const { exitCode, errors } = await runCatchingExit(() => homeSnapshot([], {}, seam));

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("rt daemon start"))).toBe(true);
  });

  test("daemon down: --status also exits 1 with the directed message", async () => {
    const seam = new FakeDaemonSeam(() => null);
    const { exitCode, errors } = await runCatchingExit(() => homeSnapshot(["--status"], {}, seam));

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("rt daemon start"))).toBe(true);
  });

  test("daemon replies with an error envelope: exits 1 and surfaces the error text", async () => {
    const seam = new FakeDaemonSeam(() => ({ ok: false, error: "git commit failed" }));
    const { exitCode, errors } = await runCatchingExit(() => homeSnapshot([], {}, seam));

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("git commit failed"))).toBe(true);
  });

  test("status reads as a state line and five facts, with a warning per fault", async () => {
    const seam = new FakeDaemonSeam(() => ({ ok: true, data: { ...okStatus, enabled: false, lastCommitError: "fatal: unable to create index.lock" } }));
    const { logs } = await runCatchingExit(() => homeSnapshot(["--status"], {}, seam));
    expect(logs[0]).toBe("[off] Saving your home repo is disabled  /home/.mattstack");
    expect(logs).toContain("watching: yes");
    expect(logs).toContain("[warning] The last save did not commit  fatal: unable to create index.lock");
  });

  test("a daemon that is down is one failure with the command to start it", async () => {
    const seam = new FakeDaemonSeam(() => null);
    const { exitCode, logs, errors } = await runCatchingExit(() => homeSnapshot([], {}, seam));
    expect(exitCode).toBe(1);
    expect(logs).toEqual([]);
    expect(errors).toEqual(["The rt daemon is not running", "  next: rt daemon start"]);
  });
});

describe("homeKeyExport", () => {
  async function expectedBytes(): Promise<string> {
    let text = "";
    await keyExport(new FakeAgeKeySeamWithExistingKey(), (t) => {
      text = `${t}\n`;
    });
    return text;
  }

  test("key export writes the same bytes at a terminal and in a pipe, and nothing else on stdout", async () => {
    const expected = await expectedBytes();
    expect(expected).toContain(FAKE_PRIVATE_KEY);
    const io = captureOut();
    try {
      for (const human of [true, false]) {
        io.clear();
        ui.__test__.setHuman(() => human);
        await homeKeyExport([], {}, new FakeAgeKeySeamWithExistingKey());
        expect(io.stdout()).toBe(expected);
        expect(io.stderr()).toBe("");
      }
    } finally {
      io.restore();
    }
  });

  test("no key yet: a failure on stderr naming the command, nothing on stdout, exit 1", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const io = captureOut();
    ui.__test__.setHuman(() => false);
    try {
      await expect(homeKeyExport([], {}, new FakeAgeKeySeam())).rejects.toThrow("process.exit");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe("");
      expect(io.stderr()).toBe("This Mac has no secrets key yet\n  next: rt home init\n");
    } finally {
      exitSpy.mockRestore();
      io.restore();
    }
  });
});

describe("readStdinTrimmed", () => {
  test("reads the whole stream and trims surrounding whitespace/newline", async () => {
    const stream = Readable.from([Buffer.from("AGE-SECRET-KEY-1FOO"), Buffer.from("BAR\n")]);
    const value = await readStdinTrimmed(stream);
    expect(value).toBe("AGE-SECRET-KEY-1FOOBAR");
  });
});

/** Drives promptSecret's `data` handler synthetically, via defaultAgeKeyInputSeam — never a real TTY. */
class FakePromptStdin extends EventEmitter implements PromptStdin {
  isTTY = true;
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
}

describe("defaultAgeKeyInputSeam", () => {
  test("fromPrompt trims the typed value the same way fromStdin trims a stdin paste", async () => {
    const stdin = new FakePromptStdin();
    const io: PromptIO = { stdin, write: () => {} };

    const pending = defaultAgeKeyInputSeam(io).fromPrompt();
    stdin.emit("data", Buffer.from(`  ${FAKE_PRIVATE_KEY}  `));
    stdin.emit("data", Buffer.from("\n"));

    await expect(pending).resolves.toBe(FAKE_PRIVATE_KEY);
  });
});

describe("homeKeyImport", () => {
  const OTHER_PUBLIC_KEY = "age1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
  const OTHER_PRIVATE_KEY = "AGE-SECRET-KEY-1ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ";

  /**
   * Models the keychain well enough for import: find/derive-existing,
   * derive-new, and store — never the real keychain. importAgeKey always
   * derives the freshly-pasted key BEFORE it looks up (and, if present,
   * derives) any existing one, so the first `age-keygen -y` call is always
   * the new key and a second one (only reachable when a key already
   * exists) is always the existing key — this fake keys off that order
   * rather than inspecting which private key was piped in.
   */
  class FakeImportSeam implements AgeKeySeam {
    calls: string[][] = [];
    private deriveCalls = 0;
    constructor(private opts: { existingPrivateKey?: string; existingPublicKey?: string } = {}) {}

    async run(cmd: string[]): Promise<AgeExecResult> {
      this.calls.push(cmd);
      if (cmd[1] === "find-generic-password") {
        if (this.opts.existingPrivateKey) return { code: 0, stdout: `${this.opts.existingPrivateKey}\n`, stderr: "" };
        return { code: 44, stdout: "", stderr: "The specified item could not be found in the keychain." };
      }
      if (cmd[0] === "age-keygen" && cmd[1] === "-y") {
        this.deriveCalls++;
        if (this.deriveCalls === 1) return { code: 0, stdout: `${FAKE_PUBLIC_KEY}\n`, stderr: "" };
        return { code: 0, stdout: `${this.opts.existingPublicKey}\n`, stderr: "" };
      }
      if (cmd[1] === "add-generic-password") {
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`FakeImportSeam: unexpected call ${cmd.join(" ")}`);
    }
  }

  function fakeInput(privateKey: string): AgeKeyInputSeam {
    return {
      fromStdin: async () => {
        throw new Error("fromStdin should not be called without --stdin");
      },
      fromPrompt: async () => privateKey,
    };
  }

  async function runImport(
    args: string[],
    seam: AgeKeySeam,
    sopsYamlSeam: SopsYamlSeam = new FakeSopsYamlSeam(),
    input: AgeKeyInputSeam = fakeInput(FAKE_PRIVATE_KEY),
  ) {
    return runCatchingExit(() => homeKeyImport(args, {}, seam, sopsYamlSeam, input));
  }

  test("valid import, no existing key: succeeds, prints the truncated recipient", async () => {
    const seam = new FakeImportSeam({});

    const { exitCode, logs } = await runImport([], seam);

    expect(exitCode).toBeUndefined();
    expect(logs.some((l) => l.includes(FAKE_PUBLIC_KEY.slice(0, 12)))).toBe(true);
    expect(logs.some((l) => l.includes("can now be opened on this Mac"))).toBe(true);
    expect(seam.calls.some((c) => c.includes("add-generic-password") && !c.includes("-U"))).toBe(true);
  });

  test("malformed key (wrong prefix): refused, exits 1, never calls the seam", async () => {
    const seam = new FakeImportSeam({});

    const { exitCode, errors } = await runImport([], seam, new FakeSopsYamlSeam(), fakeInput("not-an-age-key"));

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("not a valid age private key"))).toBe(true);
    expect(seam.calls).toEqual([]);
  });

  test("the private key pasted as a positional argument: refused, exits 1, never touches the seam or the input seam — it already leaked", async () => {
    const seam = new FakeImportSeam({});
    const input: AgeKeyInputSeam = {
      fromStdin: async () => {
        throw new Error("fromStdin should not be called — the positional-key guard must run first");
      },
      fromPrompt: async () => {
        throw new Error("fromPrompt should not be called — the positional-key guard must run first");
      },
    };

    const { exitCode, errors } = await runImport([FAKE_PRIVATE_KEY], seam, new FakeSopsYamlSeam(), input);

    expect(exitCode).toBe(1);
    expect(seam.calls).toEqual([]);
    expect(errors.some((e) => e.includes("positional argument"))).toBe(true);
    expect(errors.some((e) => e.includes("shell history"))).toBe(true);
    expect(errors.some((e) => e.includes("rotate"))).toBe(true);
  });

  test("the positional-key guard fires even alongside --stdin/--force (order-independent scan)", async () => {
    const seam = new FakeImportSeam({});

    const { exitCode, errors } = await runImport(["--force", FAKE_PRIVATE_KEY, "--stdin"], seam, new FakeSopsYamlSeam(), {
      fromStdin: async () => {
        throw new Error("fromStdin should not be called");
      },
      fromPrompt: async () => {
        throw new Error("fromPrompt should not be called");
      },
    });

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("positional argument"))).toBe(true);
  });

  test("existing key, no --force: refused, exits 1, names the existing recipient, never overwrites", async () => {
    const seam = new FakeImportSeam({ existingPrivateKey: OTHER_PRIVATE_KEY, existingPublicKey: OTHER_PUBLIC_KEY });

    const { exitCode, errors } = await runImport([], seam);

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes(OTHER_PUBLIC_KEY.slice(0, 12)))).toBe(true);
    expect(errors.some((e) => e.includes("--force"))).toBe(true);
    expect(seam.calls.some((c) => c.includes("add-generic-password"))).toBe(false);
  });

  test("a key already on this Mac is refused, not failed", async () => {
    const seam = new FakeImportSeam({ existingPrivateKey: OTHER_PRIVATE_KEY, existingPublicKey: OTHER_PUBLIC_KEY });
    const { exitCode, errors } = await runImport([], seam);
    expect(exitCode).toBe(1);
    expect(errors[0]).toBe("[refused] This Mac already has a secrets key");
    expect(errors[1]).toBe(`  why: Its recipient is ${OTHER_PUBLIC_KEY.slice(0, 12)}…, and rt replaces it only when you ask.`);
    expect(errors[2]).toBe("  next: rt home key import --force");
  });

  test("existing key, --force: overwrites (-U) and succeeds", async () => {
    const seam = new FakeImportSeam({ existingPrivateKey: OTHER_PRIVATE_KEY, existingPublicKey: OTHER_PUBLIC_KEY });

    const { exitCode, logs } = await runImport(["--force"], seam);

    expect(exitCode).toBeUndefined();
    expect(logs.some((l) => l.includes(FAKE_PUBLIC_KEY.slice(0, 12)))).toBe(true);
    const addCall = seam.calls.find((c) => c.includes("add-generic-password"));
    expect(addCall).toContain("-U");
  });

  test("imported key's derived recipient does not match this repo's .sops.yaml recipient: exits 2, names both truncated", async () => {
    const seam = new FakeImportSeam({});
    const sopsYamlSeam = new FakeSopsYamlSeam({ path: SOPS_YAML_PATH, content: renderSopsYaml(OTHER_PUBLIC_KEY) });

    const { exitCode, errors } = await runImport([], seam, sopsYamlSeam);

    expect(exitCode).toBe(2);
    expect(errors.some((e) => e.includes(FAKE_PUBLIC_KEY.slice(0, 12)))).toBe(true);
    expect(errors.some((e) => e.includes(OTHER_PUBLIC_KEY.slice(0, 12)))).toBe(true);
    // The wrong key is already stored, so a plain retry hits the exists-refusal — the message must say so.
    expect(errors.some((e) => e.includes("rt home key import --force"))).toBe(true);
    expect(errors.some((e) => e.includes("…."))).toBe(false);
  });

  test("imported key's recipient matches an existing .sops.yaml: succeeds, no mismatch warning", async () => {
    const seam = new FakeImportSeam({});
    const sopsYamlSeam = new FakeSopsYamlSeam({ path: SOPS_YAML_PATH, content: renderSopsYaml(FAKE_PUBLIC_KEY) });

    const { exitCode, errors, logs } = await runImport([], seam, sopsYamlSeam);

    expect(exitCode).toBeUndefined();
    expect(errors).toEqual([]);
    expect(logs.some((l) => l.includes(FAKE_PUBLIC_KEY.slice(0, 12)))).toBe(true);
    expect(logs.some((l) => l.includes("can now be opened on this Mac"))).toBe(true);
  });

  test("--stdin: reads the key via input.fromStdin, never input.fromPrompt", async () => {
    const seam = new FakeImportSeam({});
    let stdinCalled = false;
    let promptCalled = false;
    const input: AgeKeyInputSeam = {
      fromStdin: async () => {
        stdinCalled = true;
        return FAKE_PRIVATE_KEY;
      },
      fromPrompt: async () => {
        promptCalled = true;
        return FAKE_PRIVATE_KEY;
      },
    };

    const { exitCode, errors, logs } = await runImport(["--stdin"], seam, new FakeSopsYamlSeam(), input);

    expect(exitCode).toBeUndefined();
    expect(errors).toEqual([]);
    expect(logs.some((l) => l.includes(FAKE_PUBLIC_KEY.slice(0, 12)))).toBe(true);
    expect(logs.some((l) => l.includes("can now be opened on this Mac"))).toBe(true);
    expect(stdinCalled).toBe(true);
    expect(promptCalled).toBe(false);
  });
});

describe("homeClaim / homeRelease", () => {
  let dir: string;
  let ownersPath: string;
  let realUser: string | undefined;
  // The default fixture for most tests: the home repo IS provisioned, and
  // the claimed path is never a real file on disk (so claim defaults to a
  // dir zone) — file-zone-specific tests override isFile explicitly.
  let provisioned: HomeProbes;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rt-home-owners-"));
    ownersPath = join(dir, "snapshot-owners.jsonc");
    realUser = process.env.USER;
    process.env.USER = "matt";
    provisioned = fakeProbes({ isGitRepo: () => true });
  });

  afterEach(() => {
    process.env.USER = realUser;
    rmSync(dir, { recursive: true, force: true });
  });

  test("claim writes the zone with the default owner (<user>@<machine-key>) when --owner is omitted", async () => {
    const { exitCode, logs } = await runCatchingExit(() => homeClaim(["prefs/"], {}, ownersPath, provisioned));

    expect(exitCode).toBeUndefined();
    const owners = readOwners(ownersPath);
    expect(Object.keys(owners.zones)).toEqual(["prefs/"]);
    expect(owners.zones["prefs/"]!.owner).toContain("matt@");
    expect(logs.some((l) => l.includes("Claimed"))).toBe(true);
    expect(logs.some((l) => l.includes("prefs/"))).toBe(true);
  });

  test("claim honors an explicit --owner and --note", async () => {
    await runCatchingExit(() => homeClaim(["scripts/", "--owner", "someone-else@laptop", "--note", "work in progress"], {}, ownersPath, provisioned));

    const owners = readOwners(ownersPath);
    expect(owners.zones["scripts/"]).toMatchObject({ owner: "someone-else@laptop", note: "work in progress" });
  });

  test("claim's output says the daemon snapshots the owners file like any other path", async () => {
    const { logs } = await runCatchingExit(() => homeClaim(["prefs/"], {}, ownersPath, provisioned));
    expect(logs.some((l) => l.includes("daemon") && l.includes("snapshot"))).toBe(true);
  });

  test("claim with an invalid zone: exits 1 with a clean CLI error, not a raw stack trace", async () => {
    const { exitCode, errors } = await runCatchingExit(() => homeClaim(["../escape"], {}, ownersPath, provisioned));

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("is not a path rt can track"))).toBe(true);
  });

  test("claim with no zone argument: exits 1, explains a zone is required", async () => {
    const { exitCode, errors } = await runCatchingExit(() => homeClaim([], {}, ownersPath, provisioned));

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("Which path should rt leave"))).toBe(true);
  });

  test("claim refuses when ~/.mattstack/user isn't provisioned yet, and never touches the owners file", async () => {
    const unprovisioned = fakeProbes({ isGitRepo: () => false });
    const { exitCode, errors } = await runCatchingExit(() => homeClaim(["prefs/"], {}, ownersPath, unprovisioned));

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("rt home init"))).toBe(true);
    expect(readOwners(ownersPath)).toEqual({ zones: {} });
  });

  test("claim on a path that's a real file on disk stores a FILE zone (no trailing slash), not a dir zone", async () => {
    const withFile = fakeProbes({ isGitRepo: () => true, isFile: (p) => p.endsWith("scripts/deploy.sh") });
    const { logs } = await runCatchingExit(() => homeClaim(["scripts/deploy.sh"], {}, ownersPath, withFile));

    expect(Object.keys(readOwners(ownersPath).zones)).toEqual(["scripts/deploy.sh"]);
    expect(logs.some((l) => l.includes("scripts/deploy.sh") && !l.includes("scripts/deploy.sh/"))).toBe(true);
  });

  test("claim with a trailing slash on a real file still stores a FILE zone — the stat targets the normalized bare path, not the raw arg", async () => {
    // isFile only matches the bare path (no trailing slash) — if claim ever
    // stats the RAW "scripts/deploy.sh/" (statSync would ENOTDIR on a real
    // file), this fixture reports false and the bug reproduces: a dir zone
    // that excludes nothing.
    const withFile = fakeProbes({ isGitRepo: () => true, isFile: (p) => p.endsWith("scripts/deploy.sh") });
    const { logs } = await runCatchingExit(() => homeClaim(["scripts/deploy.sh/"], {}, ownersPath, withFile));

    expect(Object.keys(readOwners(ownersPath).zones)).toEqual(["scripts/deploy.sh"]);
    expect(logs.some((l) => l.includes("scripts/deploy.sh") && !l.includes("scripts/deploy.sh/"))).toBe(true);
  });

  test("claim on a zone already claimed by a DIFFERENT owner refuses, naming the owner, unless --force", async () => {
    await runCatchingExit(() => homeClaim(["prefs/", "--owner", "matt@laptop"], {}, ownersPath, provisioned));

    const refused = await runCatchingExit(() => homeClaim(["prefs/", "--owner", "alice@desktop"], {}, ownersPath, provisioned));
    expect(refused.exitCode).toBe(1);
    expect(refused.errors.some((e) => e.includes("matt@laptop"))).toBe(true);
    expect(readOwners(ownersPath).zones["prefs/"]!.owner).toBe("matt@laptop"); // untouched

    const forced = await runCatchingExit(() => homeClaim(["prefs/", "--owner", "alice@desktop", "--force"], {}, ownersPath, provisioned));
    expect(forced.exitCode).toBeUndefined();
    expect(readOwners(ownersPath).zones["prefs/"]!.owner).toBe("alice@desktop");
  });

  test("a path someone else claimed is refused, not failed", async () => {
    await runCatchingExit(() => homeClaim(["prefs/", "--owner", "matt@laptop"], {}, ownersPath, provisioned));
    const { exitCode, errors } = await runCatchingExit(() => homeClaim(["prefs/", "--owner", "alice@desktop"], {}, ownersPath, provisioned));
    expect(exitCode).toBe(1);
    expect(errors).toEqual(["[refused] prefs/ is already claimed by matt@laptop", "  next: rt home claim prefs/ --owner alice@desktop --force"]);
  });

  test("the refusal's next keeps the owner and note the person gave, quoting what a shell would split", async () => {
    await runCatchingExit(() => homeClaim(["my prefs/", "--owner", "matt@laptop"], {}, ownersPath, provisioned));
    const { errors } = await runCatchingExit(() => homeClaim(["my prefs/", "--owner=alice@desktop", "--note", "ci box's"], {}, ownersPath, provisioned));
    expect(errors).toEqual(["[refused] my prefs/ is already claimed by matt@laptop", "  next: rt home claim 'my prefs/' --owner alice@desktop --note 'ci box'\\''s' --force"]);
  });

  test("the refusal's next leaves out an owner the person never named", async () => {
    await runCatchingExit(() => homeClaim(["prefs/", "--owner", "matt@laptop"], {}, ownersPath, provisioned));
    const { errors } = await runCatchingExit(() => homeClaim(["prefs/"], {}, ownersPath, provisioned));
    expect(errors[1]).toBe("  next: rt home claim prefs/ --force");
  });

  test("release removes a previously claimed zone and names who owned it", async () => {
    await runCatchingExit(() => homeClaim(["prefs/", "--owner", "matt@laptop"], {}, ownersPath, provisioned));
    expect(Object.keys(readOwners(ownersPath).zones)).toEqual(["prefs/"]);

    const { exitCode, logs } = await runCatchingExit(() => homeRelease(["prefs/"], {}, ownersPath, provisioned));

    expect(exitCode).toBeUndefined();
    expect(Object.keys(readOwners(ownersPath).zones)).toEqual([]);
    expect(logs.some((l) => l.includes("Released"))).toBe(true);
    expect(logs.some((l) => l.includes("matt@laptop"))).toBe(true);
  });

  test("release on a never-claimed zone prints 'nothing to release', not a ✓", async () => {
    const { exitCode, logs } = await runCatchingExit(() => homeRelease(["never-claimed/"], {}, ownersPath, provisioned));
    expect(exitCode).toBeUndefined();
    expect(logs.some((l) => l.includes("Nothing to release"))).toBe(true);
    expect(logs.some((l) => l.includes("✓"))).toBe(false);
  });

  test("release finds a FILE zone claimed earlier, without needing --kind or a fresh stat", async () => {
    const withFile = fakeProbes({ isGitRepo: () => true, isFile: (p) => p.endsWith("scripts/deploy.sh") });
    await runCatchingExit(() => homeClaim(["scripts/deploy.sh"], {}, ownersPath, withFile));

    const { logs } = await runCatchingExit(() => homeRelease(["scripts/deploy.sh"], {}, ownersPath, provisioned));

    expect(logs.some((l) => l.includes("scripts/deploy.sh"))).toBe(true);
    expect(readOwners(ownersPath).zones).toEqual({});
  });

  test("release with an invalid zone: exits 1 with a clean CLI error", async () => {
    const { exitCode, errors } = await runCatchingExit(() => homeRelease(["../escape"], {}, ownersPath, provisioned));

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("is not a path rt can track"))).toBe(true);
  });

  test("release with no zone argument: exits 1, explains a zone is required", async () => {
    const { exitCode, errors } = await runCatchingExit(() => homeRelease([], {}, ownersPath, provisioned));

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("Which claimed path should rt take back"))).toBe(true);
  });

  test("release refuses when ~/.mattstack/user isn't provisioned yet", async () => {
    const unprovisioned = fakeProbes({ isGitRepo: () => false });
    const { exitCode, errors } = await runCatchingExit(() => homeRelease(["prefs/"], {}, ownersPath, unprovisioned));

    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("rt home init"))).toBe(true);
  });
});
