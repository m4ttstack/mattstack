/**
 * The rt() shell wrapper runs dir="$(rt cd ...)" and cds into whatever stdout
 * holds. Pinned before the output layer touches cd and nav: stdout is the
 * chosen path and a newline, or empty; exit codes as today.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";
import { closeStateDb, setKvValue } from "../../lib/state/index.ts";
import { __test__ as pickImplTest, type PickImpl } from "../../lib/ui/pick.ts";
import { worktreePicker } from "../cd.ts";
import { navigate } from "../nav.ts";

const UP_TO_DATE_RC = 'rt() {\n  whence -p rt\n  "$rt_bin" nav\n}\n';
const origHome = process.env.HOME;
const origShell = process.env.SHELL;
const origCwd = process.cwd();
let home: string;
let scratch: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-cdnav-home-")));
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "rt-cdnav-repos-")));
  process.env.HOME = home;
  process.env.SHELL = "/bin/zsh";
  writeFileSync(join(home, ".zshrc"), UP_TO_DATE_RC);
  closeStateDb();
  process.chdir(scratch);
});

afterEach(() => {
  process.chdir(origCwd);
  process.env.HOME = origHome;
  process.env.SHELL = origShell;
  pickImplTest.setImpl(undefined);
  closeStateDb();
  rmSync(home, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

/** The handle shape of `cd.test.ts`'s `installCancelPick`: a `select` with a value, or a cancel. */
function installPick(value: string | null): void {
  const impl: PickImpl = () => ({
    update() {},
    modal: async () => null,
    result: Promise.resolve(
      value === null
        ? { t: "result", action: "cancel", value: null, query: "" }
        : { t: "result", action: "select", value, query: "" },
    ),
  });
  pickImplTest.setImpl(impl);
}

function gitRepo(name: string): string {
  const dir = join(scratch, name);
  mkdirSync(dir);
  execFileSync("git", ["init", "-q", dir]);
  return dir;
}

async function run(fn: () => Promise<void>): Promise<{ code: number | undefined; stdout: string; stderr: string }> {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  process.stdout.write = ((c: string | Uint8Array) => (outChunks.push(String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => (errChunks.push(String(c)), true)) as typeof process.stderr.write;
  const log = spyOn(console, "log").mockImplementation((...a: unknown[]) => void outChunks.push(`${a.join(" ")}\n`));
  const err = spyOn(console, "error").mockImplementation((...a: unknown[]) => void errChunks.push(`${a.join(" ")}\n`));
  const exit = spyOn(process, "exit").mockImplementation(((c?: number) => {
    throw new Error(`exit ${c}`);
  }) as unknown as typeof process.exit);
  let code: number | undefined;
  try {
    await fn();
  } catch (e) {
    const m = /^exit (\d+)$/.exec((e as Error).message);
    if (!m) throw e;
    code = Number(m[1]);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    log.mockRestore();
    err.mockRestore();
    exit.mockRestore();
  }
  return { code, stdout: outChunks.join(""), stderr: errChunks.join("") };
}

describe("rt cd and rt nav stdout (frozen for the shell wrapper)", () => {
  test("a chosen worktree is the path and a newline on stdout, nothing else", async () => {
    const wt = gitRepo("sample-app");
    setKvValue("repo-index", "sample-app", wt);
    installPick(wt);
    const r = await run(() => worktreePicker([]));
    expect(r.stdout).toBe(`${wt}\n`);
    expect(r.code).toBeUndefined();
  });

  test("a missing repo is a failure with the locate command; stdout stays empty", async () => {
    setKvValue("repo-index", "moved", join(scratch, "gone-away"));
    const r = await run(() => worktreePicker(["--repo", "--worktree", "anybranch"]));
    expect(r.stdout).toBe("");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("rt repos locate");
  });

  test("nav: esc prints nothing on stdout", async () => {
    installPick(null);
    const r = await run(() => navigate([scratch]));
    expect(r.stdout).toBe("");
  });
});
