# rt Output Layer, Phase 6f (session verbs, rt cd and rt nav) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt run`, the preflight and teardown lines of `rt runner` and `rt glitter`, and the non-rt-ui prints of `rt cd` and `rt nav` (with the paths of `lib/pickers.ts` and `commands/code.ts` they reach) leave the raw-output allowlist; `rt cd` stops erasing the person's typed command line; `rt nav` stops leaking editor and shell output into the folder its shell wrapper changes into; and `rt code` remembers an editor choice again (the `savePrefs` bug). Eight allowlist lines go. Nothing rt-ui draws (pickers, the navigator, prompts, the runner board, the glitter board) changes.

**This plan waits on Matt's Decision 1** (scoping document, "Decision 1"). It is written for option B (a narrow conversion of only the non-rt-ui prints), which the scoping document recommends. If Matt chooses option A (an explicit, tested exemption), run Tasks 1 to 4 and 8 to 11 unchanged, replace Tasks 5 to 7 with the "Option A" section at the end, and skip Task 2 Step 2's `holdStdout`. Task 1 stops if the ledger does not record Matt's answer.

**Architecture:** One new layer export, `out.holdStdout()`, replaces the two hand-rolled `process.stdout.write` swaps: until released, writes to stdout go to stderr and human text follows them, so the shell wrapper's `$(...)` reads only the path `out.payload` writes after release. Every other print moves onto `out.print`, `out.note` or `out.fail`. Children of `rt nav` that used to inherit stdout get the terminal through stderr's descriptor instead. `rt run` keeps its JSON on stdout (`--resolve-only`, the seed) and draws its human lines on stderr after `payloadOnStdout()`.

**Tech Stack:** Bun + TypeScript, `bun:test` (the cd and nav harnesses with `lib/ui/pick.ts`'s fake pick), the e2e suite, Fast Browser.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (RT-369): "Rules" 1 (the `rt cd` and `rt nav` path is a payload), 2 (their human text goes to stderr), "Non-goals" (`rt runner` and `rt glitter`: only their preflight errors). **Scoping:** `docs/superpowers/plans/2026-10-02-rt-output-layer-phase-6-scoping.md`, 6f, Decision 1, shared item 3, warnings row 52. 5c's record of the bugs: `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5c-worktree-nav.md`, "Rulings"/"Findings" (the two-row erase; the no-editor lines on stdout; three children inheriting fd 1). House style: the 5f2 chat plan.

**Size:** about 1,900 changed lines (option B). One PR.

**What was run while writing this plan:** nothing was compiled except one probe: `setSetting("rt.workspacePrefs", { editors: { a: "code" }, workspaces: {}, defaultEditor: undefined }, "machine")` under a temp HOME throws `Instances of "undefined" type are not supported.`, and the same object without the `undefined` key saves. That is the `savePrefs` bug (Task 3). Written against `origin/main` at `658e704b9`.

## Global Constraints

- Never use em dashes or en dashes anywhere. `missingRepoRefusal`, `ghostPathRefusal`, the shell-wrapper notes, `savePrefs`' warning, `rt run`'s lines and `rt runner`'s lines hold several; each is replaced.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show.
- `rt cd` and `rt nav`: stdout is exactly the chosen path and a newline, or empty; exit codes unchanged (0 on a path or an esc, 1 on a refusal). Pinned before any edit (Task 4).
- `rt run --resolve-only` and the seed envelope on stdout are byte-identical (`commands/runner.ts` parses them). Exit codes unchanged.
- No picker, prompt, navigator, runner board or glitter board changes how it draws (Matt, 2026-10-01). No change to `lib/ui/pick.ts`, `lib/pick-wrappers.ts`, `lib/navigate.ts`, `lib/mission/**`, `lib/runner/**` beyond the two stderr lines in `lib/runner/runner.ts`.
- Coral only for failures. Copy to "you", plainly; no paths or flags in sentences; commands in a `next` callout. A path may be a hint where it is the thing chosen.
- Run `bun test` only from the repo root. Never run a built `rt` outside an isolated HOME. No test writes the real `~/.zshrc`: the cd harness's temp HOME only.
- Git commands plain and alone from the worktree root. Never `git add -A`, `.` or `-u`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Files this slice must not edit: every file another phase 6 slice owns; `lib/ui/**` except `holdStdout` in `lib/ui/out.ts` (option B); `lib/repo-index.ts` except `missingRepoRefusal` and `ghostPathRefusal` (6k deletes `healErrorClause` there later; 6h does not touch the file).
- UI validation is mandatory (Task 10). Matt also checks `rt cd` and `rt nav` by hand after the release; this PR waits for that check before merging (Decision 1, option B).

## Review Focus

1. **`dir="$(rt cd)"` after the shell wrapper upgrade prompt.** The upgrade notes and the confirm must reach the person on stderr, and stdout must still be the path alone. Pinned in Task 5 (`the wrapper upgrade notes go to stderr and leave stdout empty`).
2. **`rt nav`'s ctrl-o with no editor installed.** Today two lines land in `$dir` and the shell tries to `cd` into them. After: stdout empty, a failure on stderr, exit 1. Pinned in Task 6 (`no editor under rt nav leaves stdout empty`).
3. **"Open terminal here" from `rt nav`.** The spawned shell's output must reach the terminal, not the `$(...)` capture. Pinned in Task 6 (`the shell nav opens writes to the terminal, never to the path pipe`).
4. **A cached `rt cd`.** After choosing a worktree nothing erases rows above the cursor, so the typed `rt cd` line stays on screen. Pinned in Task 5 (`rt cd registers no exit-time erase`).
5. **A repo whose folder moved, chosen in `rt cd`.** A plain failure naming the command that finds it again, in a form `--repo` resolves, on stderr; stdout empty; exit 1. Pinned in Task 5 (`a missing repo is a failure with the locate command; stdout stays empty`).

## Readers

| Reader | Reads | After |
|---|---|---|
| the `rt()` shell wrapper (`SHELL_FUNCTION`, `commands/cd.ts:40`) in every user's rc file | `dir="$(rt cd ...)"`, `dir="$(rt nav ...)"`, then `builtin cd "$dir"` | stdout is the path or empty, pinned |
| `commands/runner.ts:32,182,204` | `rt run --resolve-only`'s `{"seed":[...]}` and `RunResolveResult` JSON | unchanged bytes |
| `e2e/tests/glitter.test.ts:11,24` | `rt glitter needs an interactive terminal` on stderr | updated to the new title (Task 8) |
| `commands/__tests__/cd.test.ts`, `cd-identity-match.test.ts`, `nav.test.ts`, `code-output.test.ts`, `code-prefs.test.ts`, `run-*.test.ts`, `runner-command.test.ts` | the old lines | updated where they read text |

## Copy table

### `rt cd` (`commands/cd.ts`, `lib/pickers.ts`, `lib/repo-index.ts`)

| Today (stderr) | After (stderr) |
|---|---|
| yellow `Upgrading rt shell wrapper: <reason>` (seven variants) | `out.print(out.line("warn", "Your rt shell function is out of date", <reason>))`, reasons: `it can loop forever in zsh`, `it does not rehash after a dev mode switch`, `it cannot cd for rt nav`, `it still jumps on rt worktree`, `it finds the dev app's rt by name, not by path`, `it does not follow rt x`, `it is the old rtcd function` |
| yellow `rt cd needs a shell function to change your directory.` | `line("needs-you", "rt cd needs a shell function to change your directory")` |
| `Add this to your shell config manually:` + the function | `out.print(out.copy(SHELL_FUNCTION, "add this to your shell config"))` |
| green `✓ Installed rt shell wrapper in <rc>` + `Restart your terminal or run: source <rc>` | `line("done", "Installed the rt shell function", <rc>)`, `callout("next", cmd("source <rc>"))` |
| `\x1b[2A\x1b[0J` on exit 0 | removed |
| `missingRepoRefusal`: `<label> is no longer at <path> -- run: rt repos locate <new-path> --repo <wire>` | `out.fail(missingRepoFailure(repo))` (the failure `lib/repo.ts` already builds for other callers: read it in Task 2 and confirm its `next` names a form `--repo` resolves; if it prints the wire identity, `missingRepoRefusal` is reworded instead, below) |
| `ghostPathRefusal`: `<path> no longer exists (the cd cache may be stale) - run: rt repos prune` | `out.fail({ title: "That folder is gone", hint: <path>, why: "rt's list of folders was out of date.", next: cmd("rt repos prune") })` |
| `lib/pickers.ts` `no known repos found -- run rt from inside a git repo first` (the `rt cd` path) | the same failure the other callers already get: `{ title: "rt does not know any repos yet", next: "Run rt once from inside a git repo, so it learns where that repo is" }` |
| `lib/pickers.ts:416` `no worktree found matching branch: "<b>"` | `out.fail({ title: "No worktree has a branch starting with <b>", next: cmd("rt worktree list") })` |

`missingRepoRefusal(r)` and `ghostPathRefusal(path)` in `lib/repo-index.ts`: once no caller remains (Task 5 removes the last two), delete both and their tests' cases (`lib/__tests__/repo-index-missing.test.ts:147`, `lib/__tests__/cd-cache-read.test.ts:146`), keeping the tests' other cases.

### `rt nav` (`commands/nav.ts`, `commands/code.ts`)

| Today | After |
|---|---|
| stderr `Quick Look: <name>  (close the preview to return)` | `out.print(out.line("running", \`Quick Look: ${name}\`, "close the preview to come back"))` (human stream is stderr under `holdStdout`) |
| stderr `Quick Look failed: <detail>` / `(exit <n>)` | `out.fail({ title: "Quick Look did not open", why: <first line of detail or "it exited <n>"> })` |
| stdout (bug) `No supported editor CLI found.` + `Install one of: ...` | `noEditorFailure()` (5c's, stderr), exit 1 |
| stderr `✓ Opened <dir> in <editor>` | `out.print(out.line("done", \`Opened ${dir} in ${label}\`))` |
| stderr `Failed to open <editor>. Is '<cmd>' CLI installed?` | `out.fail({ title: \`${label} did not open\`, why: \`Its shell command, ${cmd}, failed. Check that it is installed.\` })` |
| `launchEditor`: `execSync(\`${editor} "${target}"\`, { stdio: "inherit" })` | `spawnSync("/bin/sh", ["-c", \`${editor} "$1"\`, "sh", target], { stdio: ["inherit", 2, "inherit"], env: childEnv() })`: the target is `$1`, never spliced, and the editor's stdout reaches the terminal |
| open-with `deps.spawnSync(app, [target], { stdio: "inherit" })` | `{ stdio: ["inherit", 2, "inherit"] }` |
| terminal here `deps.spawnSync(shell, [], { cwd, stdio: "inherit" })` | `{ cwd, stdio: ["inherit", 2, "inherit"] }` |
| `savePrefs` stderr `rt: could not save workspace prefs -- <err>` | scoping row 52 through `warn` |

### `rt run`, `rt runner`, `rt glitter`

| Today (stderr) | After (stderr: `rt run` calls `out.payloadOnStdout()` first) |
|---|---|
| green `✓ saved <kind> "<label>"` | `out.print(out.line("done", \`Saved the ${kind} ${label}\`))` |
| yellow `⚠ not saved -- no repo identity for <repo>; pin one with \`rt settings set rt.repoIdentityOverrides\`` | `out.print(out.line("warn", \`The ${kind} was not saved\`, "rt cannot tell which repo this is")`, `out.callout("next", out.cmd("rt settings set rt.repoIdentityOverrides"))` |
| `⚠ not saved -- <message>` | `line("warn", \`The ${kind} was not saved\`, <message>)` |
| `  ↳ package: <label> (from cwd)` | `line("skipped", \`Package ${label}\`, "picked from where you are")` |
| `No scripts found in <path>/package.json.` (exit 1) | `out.fail({ title: "This package has no scripts", hint: <package label> })` |
| `No known repos. Run rt from inside a git repo to register it.` | `out.fail({ title: "rt does not know any repos yet", next: "Run rt once from inside a git repo, so it learns where that repo is" })` |
| `No accessible worktrees for <repo>.` | `out.fail({ title: \`${repo} has no worktree rt can open\` })` |
| `\x1b[2J\x1b[H` (two picker back-steps) | `clearScreen()` from `lib/ui/screen.ts` (5a; guarded to a person at a terminal) |
| `preset <name>` echo | `line("running", \`Running the ${name} preset\`)` |
| `Running: <cmd>` + `  in: <dir>` (two sites) | `line("running", \`Running ${cmd}\`, <dir>)` |
| `rt run again`: `No run history yet -- no repos registered.` + `Run rt run from a repo first ...` | `line("skipped", "No run history yet")`, `callout("next", cmd("rt run"))`; exit 0 |
| `skipping -- directory no longer exists: <cwd>` | `out.fail({ title: "That folder is gone", hint: <cwd> })`, exit 1 |
| runner `rt runner needs an interactive terminal (...)` | `out.fail({ title: "rt runner needs an interactive terminal", why: "It draws a live board in the terminal you are in." })` |
| `the rt daemon is required for --herdr mode; start it and retry` | `out.fail({ title: "The herdr board needs the rt daemon", next: cmd("rt daemon start") })` |
| `rt runner needs tmux on PATH (or pass --herdr to use herdr panes)` | `out.fail({ title: "rt runner needs tmux", next: cmd("rt runner --herdr") })` |
| `  rt runner: <message>` / `rt runner: <seed-file error>` | `out.fail({ title: <message> })` |
| `  rt runner: bg release failed (<err>)`, `orphan reconcile failed (<err>)`, `tmux orphan reconcile failed (<err>)`, `lib/runner/runner.ts` `picker failed (<err>)`, `could not close workspace <id> (<err>)` | `warn("runner", <the same words without the prefix>)`, log only: housekeeping a person cannot act on, and printing over a live board would tear it |
| `<SessionDied message>; the workspace was closed` (runner and glitter) | `out.fail({ title: "The board's terminal session ended", why: \`${err.message}. Its workspace was closed.\` })` |
| glitter `rt glitter needs an interactive terminal (...)` | `out.fail({ title: "rt glitter needs an interactive terminal", why: "It draws a live board in the terminal you are in." })` |
| `rt glitter: not in a git repo and no repos found under your repo roots` | `out.fail({ title: "You are not in a git repo, and rt does not know any repos yet", next: "Run rt once from inside a git repo, so it learns where that repo is" })` |

Row 52 (`commands/code.ts:64`): `warn("code", \`could not save workspace prefs: ${message}\`, { show: { title: "rt could not remember your editor choice", hint: message.split("\n")[0], next: cmd("rt settings check") } })`.

## File Structure

| File | Responsibility |
|---|---|
| `lib/ui/out.ts`, `lib/ui/__tests__/out.test.ts` (modify) | `holdStdout` (option B) |
| `commands/cd.ts`, `commands/nav.ts`, `commands/code.ts`, `lib/pickers.ts`, `lib/repo-index.ts` (modify) | Decision 1's work, the erase, `savePrefs` |
| `commands/run.ts`, `commands/runner.ts`, `commands/glitter.ts`, `lib/runner/runner.ts` (modify) | session verbs |
| `commands/__tests__/cd-nav-bytes.test.ts` (create) | stdout pins for `rt cd` and `rt nav` |
| the tests named in Readers (modify) | |
| `lib/__tests__/raw-output-allowlist.json` (modify) | eight lines |

---

### Task 1: Confirm the base and the decision

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`.
- [ ] **Step 2:** Read the task ledger. If it does not record Matt's answer to Decision 1 (A or B), **stop**: report "6f waits on Decision 1" and do not start Task 2.
- [ ] **Step 3:** Run each alone: `grep -n "export function clearScreen" lib/ui/screen.ts`; `grep -n "export function warn" lib/ui/warn.ts`; `grep -n "export function missingRepoFailure" lib/repo.ts`. One line each, or stop. `grep -c "commands/run.ts\|commands/runner.ts\|commands/glitter.ts\|lib/runner/runner.ts\|commands/cd.ts\|commands/nav.ts\|commands/code.ts\|lib/pickers.ts" lib/__tests__/raw-output-allowlist.json`: `8`, or stop.
- [ ] **Step 4:** Run `bun test commands/__tests__/cd.test.ts commands/__tests__/cd-identity-match.test.ts commands/__tests__/nav.test.ts commands/__tests__/code-output.test.ts commands/__tests__/code-prefs.test.ts commands/__tests__/code-launch.test.ts commands/__tests__/run-report-save.test.ts commands/__tests__/run-abort-message.test.ts commands/__tests__/runner-command.test.ts lib/__tests__/pickers.test.ts lib/__tests__/repo-index-missing.test.ts lib/__tests__/cd-cache-read.test.ts`. PASS, or stop and report.

---

### Task 2: `out.holdStdout` (option B), and the audit

**Files:** `lib/ui/out.ts`, `lib/ui/__tests__/out.test.ts`.

**Interfaces:**
- Produces: `holdStdout(): () => void`.

- [ ] **Step 1: Read for the audit.** Read `missingRepoFailure` in `lib/repo.ts` and record in the ledger what its `next` prints. If it prints `rt repos locate <new-path> --repo <label>` with a label `--repo` resolves (`tryResolveRepoArg` in `lib/repo-arg.ts` resolves a label through `reverseLookupByName`), use it as the copy table says. If it prints the wire identity, note it: Task 5 then words `rt cd`'s failure itself with `repoLabel(repo.repoName)` in the command.

- [ ] **Step 2: Failing test** (append to `lib/ui/__tests__/out.test.ts`):

```ts
describe("holdStdout", () => {
  test("until released, stdout writes and human text go to stderr; a payload after release is stdout's alone", () => {
    const io = captureOut();
    out.__test__.setHuman(() => false);
    try {
      const release = out.holdStdout();
      process.stdout.write("picker chrome\n");
      out.print(out.line("done", "Installed"));
      release();
      out.payload("/code/sample-app\n");
      expect(io.stdout()).toBe("/code/sample-app\n");
      expect(io.stderr()).toBe("picker chrome\n[ok] Installed\n");
    } finally {
      io.restore();
    }
  });
});
```

- [ ] **Step 3:** Run: FAIL (`out.holdStdout is not a function`).
- [ ] **Step 4: Implement** (after `payloadOnStdout` in `lib/ui/out.ts`):

```ts
/**
 * For a verb whose stdout is a path another program reads (rt cd, rt nav):
 * until the returned release runs, anything written to stdout lands on
 * stderr, so a picker's chrome or a stray child line never reaches the
 * reader. Human text moves to stderr for the rest of the process, as
 * payloadOnStdout does.
 */
export function holdStdout(): () => void {
  humanStream = "stderr";
  const real = process.stdout.write;
  if (!process.stdout.columns && process.stderr.columns) {
    Object.defineProperty(process.stdout, "columns", { value: process.stderr.columns, configurable: true });
  }
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
  return () => {
    process.stdout.write = real;
  };
}
```

The test's `captureOut` replaces both writers before `holdStdout` runs, so the swap binds to the capture's stderr function and the release puts the capture's stdout function back.

- [ ] **Step 5:** Run `bun test lib/ui/__tests__/out.test.ts`: PASS. Commit (`lib/ui/out.ts`, `lib/ui/__tests__/out.test.ts`), message `ui: out.holdStdout for the verbs whose stdout is a path`.

---

### Task 3: `savePrefs` saves again

**Files:** `commands/code.ts` (`savePrefs`), `commands/__tests__/code-prefs.test.ts`.

- [ ] **Step 1: Failing test** (append to `code-prefs.test.ts`, which already runs under a temp HOME and imports `__test__` and `getSetting`):

```ts
test("saving prefs with no default editor keeps the editor choice (no undefined field reaches the store)", () => {
  const prefs = { editors: { myrepo: "zed" }, workspaces: {}, defaultEditor: undefined };
  __test__.savePrefs(prefs);
  const stored = getSetting<{ editors: Record<string, string>; defaultEditor?: string }>("rt.workspacePrefs").value;
  expect(stored?.editors).toEqual({ myrepo: "zed" });
  expect(stored && "defaultEditor" in stored).toBe(false);
});
```

- [ ] **Step 2:** Run: FAIL (today the write throws `Instances of "undefined" type are not supported.`, `savePrefs` warns, and nothing is stored).
- [ ] **Step 3: Implement**

```ts
function savePrefs(prefs: Prefs): void {
  const value = { editors: prefs.editors, workspaces: prefs.workspaces, ...(prefs.defaultEditor !== undefined ? { defaultEditor: prefs.defaultEditor } : {}) };
  try {
    setSetting("rt.workspacePrefs", value, "machine");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn("code", `could not save workspace prefs: ${message}`, {
      show: { title: "rt could not remember your editor choice", hint: message.split("\n")[0], next: out.cmd("rt settings check") },
    });
  }
}
```

(`warn` from `../lib/ui/warn.ts`; `out` is already imported by 5c.)

- [ ] **Step 4:** Run `bun test commands/__tests__/code-prefs.test.ts commands/__tests__/code-output.test.ts`. PASS. (`code-output.test.ts:61` expects today's warning text with `next: rt settings set rt.workspacePrefs '{}' --scope machine`; change it to the row 52 copy, `next: rt settings check`.)
- [ ] **Step 5:** Commit (`commands/code.ts`, the two tests), message `code: save editor prefs without an undefined field, so the choice is remembered; the warning goes through warn`.

---

### Task 4: Pin `rt cd` and `rt nav`'s stdout before converting

**Files:** Create `commands/__tests__/cd-nav-bytes.test.ts`.

- [ ] **Step 1: Write the tests** (they use the fake pick of `lib/ui/pick.ts`, as `commands/__tests__/cd.test.ts` and `nav.test.ts` do; read both files' `installCancelPick` / fake pick helpers and the temp-HOME `beforeEach` first, and reuse them by copying them into this file):

```ts
/**
 * The rt() shell wrapper runs dir="$(rt cd ...)" and cds into whatever stdout
 * holds. Pinned before the output layer touches cd and nav: stdout is the
 * chosen path and a newline, or empty; exit codes as today.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb, setKvValue } from "../../lib/state/index.ts";
import { __test__ as pickImplTest } from "../../lib/ui/pick.ts";
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
    const wt = join(scratch, "sample-app");
    mkdirSync(wt);
    setKvValue("repo-index", "sample-app", wt);
    pickImplTest.setImpl(async () => ({ value: wt, key: "enter" }) as never);
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
    pickImplTest.setImpl(async () => null as never);
    const r = await run(() => navigate([scratch]));
    expect(r.stdout).toBe("");
  });
});
```

The fake pick's result shape must match `lib/ui/pick.ts`'s `PickImpl` (read it; `cd.test.ts`'s `installCancelPick` shows the cancel shape). If the single-repo case above auto-selects without calling the pick, the first test still holds; if the worktree picker needs a second pick (packages), adjust the fake to return the worktree path for every call.

- [ ] **Step 2:** Run: PASS on today's code (stdout is the path; the refusal is on stderr). Twice more: PASS.
- [ ] **Step 3:** Commit, message `cd, nav: pin stdout for the shell wrapper before the output layer touches them`.

---

### Task 5: `rt cd` (option B)

**Files:** `commands/cd.ts`, `lib/pickers.ts`, `lib/repo-index.ts`, `commands/__tests__/cd.test.ts`, `commands/__tests__/cd-identity-match.test.ts`, `lib/__tests__/pickers.test.ts`, `lib/__tests__/repo-index-missing.test.ts`, `lib/__tests__/cd-cache-read.test.ts`, the allowlist.

- [ ] **Step 1: Failing tests.** In `cd-nav-bytes.test.ts`, add:

```ts
  test("rt cd registers no exit-time erase", async () => {
    const before = process.listenerCount("exit");
    pickImplTest.setImpl(async () => null as never);
    await run(() => worktreePicker([]));
    expect(process.listenerCount("exit")).toBe(before);
  });

  test("the wrapper upgrade notes go to stderr and leave stdout empty", async () => {
    writeFileSync(join(home, ".zshrc"), 'rt() {\n  command rt cd\n}\n');
    const wt = join(scratch, "sample-app");
    mkdirSync(wt);
    setKvValue("repo-index", "sample-app", wt);
    // The upgrade confirm is a prompt; answer it no through the prompt fake the
    // repo uses for confirm (lib/rt-render.ts's confirm reads lib/ui/prompts.ts).
    pickImplTest.setImpl(async () => ({ value: wt, key: "enter" }) as never);
    const r = await run(() => worktreePicker([]));
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Your rt shell function is out of date");
    expect(r.stderr).toContain("add this to your shell config:");
    expect(r.code).toBe(0);
  });
```

For the second test, a declined confirm exits 0 after printing the function (today's behavior); make the confirm answer "no" with the fake `lib/ui/prompts.ts` offers (read it: `prompts.test.ts` shows how a test answers a confirm), and record the call in the ledger. In `cd.test.ts` and `cd-identity-match.test.ts`, change `toContain("rt repos locate")` assertions on `console.error` to read stderr through the same capture, and any `missingRepoRefusal` import to `missingRepoFailure`.

- [ ] **Step 2:** Run: FAIL (the exit listener is registered; the notes are yellow text).
- [ ] **Step 3: Implement.**

`commands/cd.ts`:

```ts
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { missingRepoFailure } from "../lib/repo.ts";
```

(remove `yellow`, `green`, `reset`, `missingRepoRefusal`, `ghostPathRefusal` from the imports).

```ts
function wrapperNotes(rcLabel: string, flags: { funcnest: boolean; preRehash: boolean; noNav: boolean; worktreeNav: boolean; hashCache: boolean; oldWrapper: boolean; legacyRtcd: boolean }): Block {
  const reason = flags.funcnest
    ? "it can loop forever in zsh"
    : flags.preRehash
      ? "it does not rehash after a dev mode switch"
      : flags.noNav
        ? "it cannot cd for rt nav"
        : flags.worktreeNav
          ? "it still jumps on rt worktree"
          : flags.hashCache
            ? "it finds the dev app's rt by name, not by path"
            : flags.oldWrapper
              ? "it does not follow rt x"
              : flags.legacyRtcd
                ? "it is the old rtcd function"
                : null;
  return reason ? out.line("warn", "Your rt shell function is out of date", reason) : out.line("needs-you", "rt cd needs a shell function to change your directory", rcLabel);
}
```

`ensureShellFunction` holds stdout for its prompt with `const release = out.holdStdout();` in place of the swap, prints `out.print(wrapperNotes(rcLabel, {...}))` in place of the `if/else` chain, on decline prints `out.print(out.copy(SHELL_FUNCTION, "add this to your shell config"))`, calls `release()` and exits 0, and on install prints `out.print(out.line("done", "Installed the rt shell function", rcLabel), out.callout("next", out.cmd(\`source ${rcLabel}\`)))` then `release()`.

`worktreePicker`: delete the `process.once("exit", ...)` erase hook and its comment. Replace the swap with `const release = out.holdStdout();` (delete the `columns` lines: `holdStdout` does it). The two refusals become `out.fail(missingRepoFailure(pickedRepo)); process.exit(1);` and `out.fail({ title: "That folder is gone", hint: selectedPath, why: "rt's list of folders was out of date.", next: out.cmd("rt repos prune") }); process.exit(1);`. The end: `release(); out.payload(\`${selectedPath}\n\`);` in place of `process.stdout.write = realStdoutWrite; realStdoutWrite(selectedPath + "\n");`, with the ghost check between `release()` and the payload as today.

`lib/pickers.ts`: delete `legacyCd` and its two raw branches (every caller now gets the failures the others get); in `resolveWorktreeByBranch`, replace the `writer` lines with `out.fail({ title: \`No worktree has a branch starting with ${branch}\`, next: out.cmd("rt worktree list") }); process.exit(1);`. The `stderr` option stays on the signatures (the pickers still draw on stderr for `rt cd`).

`lib/repo-index.ts`: delete `missingRepoRefusal` and `ghostPathRefusal` (no caller remains: `grep -rn "missingRepoRefusal\|ghostPathRefusal" --include=*.ts lib commands` prints only test files, whose cases for them are deleted) and drop them from `lib/repo.ts`'s re-export line.

Delete `commands/cd.ts` and `lib/pickers.ts` from the allowlist.

- [ ] **Step 4:** Run the cd, pickers and repo-index test files, `cd-nav-bytes.test.ts`, and the guard. PASS; `grep -n "console\.\|process\.std\(out\|err\)\.write\|\\\\x1b" commands/cd.ts lib/pickers.ts` prints nothing.
- [ ] **Step 5:** Commit, message `cd: notes and refusals on the layer, stdout held for the path, no erase of the typed command line`.

---

### Task 6: `rt nav` and the editor opener (option B)

**Files:** `commands/nav.ts`, `commands/code.ts`, `commands/__tests__/nav.test.ts`, `commands/__tests__/code-output.test.ts`, `commands/__tests__/code-launch.test.ts`, the allowlist.

- [ ] **Step 1: Failing tests.** In `nav.test.ts`, inside `describe("rt nav: terminal-owning exits re-invoke with resume")` (it has `installSequentialFakePick`, `resultStep`, `fakeSpawnSync`, `baseDeps` and `withRealStdoutRestore` in scope), add:

```ts
  test("the shell nav opens writes to the terminal, never to the path pipe", async () => {
    const root = mkdtempSync(join(tmpdir(), "nav-test-"));
    mkdirSync(join(root, "sub"));
    const seq = installSequentialFakePick([[resultStep("terminal", "d:sub", "")]]);
    const spawn = fakeSpawnSync();
    await withRealStdoutRestore(() => navigate([root], baseDeps({ spawnSync: spawn.fn })));
    const shell = spawn.calls.find((c) => (c.opts as { cwd?: string }).cwd === join(root, "sub"));
    expect((shell?.opts as { stdio?: unknown }).stdio).toEqual(["inherit", 2, "inherit"]);
    seq.restore();
    rmSync(root, { recursive: true, force: true });
  });

  test("an app picked in open-with writes to the terminal, never to the path pipe", async () => {
    const root = mkdtempSync(join(tmpdir(), "nav-test-"));
    writeFileSync(join(root, "notes.txt"), "x");
    const seq = installSequentialFakePick([[resultStep("open-with", "f:notes.txt", "")], [resultStep("enter", "nvim")]]);
    const spawn = fakeSpawnSync();
    await withRealStdoutRestore(() => navigate([root], baseDeps({ spawnSync: spawn.fn })));
    const app = spawn.calls.find((c) => c.cmd === "nvim");
    expect((app?.opts as { stdio?: unknown }).stdio).toEqual(["inherit", 2, "inherit"]);
    seq.restore();
    rmSync(root, { recursive: true, force: true });
  });
```

(`resultStep("enter", "nvim")` is the open-with sub-picker accepting its `nvim` row; if that picker's accept key is not `enter` in `pickOpenWith`, use the key it expects.)

In `code-output.test.ts`, the test of `openDirectoryInEditor`'s no-editor path (5c's `the opener rt nav calls prints as it does today`) becomes `no editor under rt nav leaves stdout empty`: stdout `""`, stderr starting `rt could not find an editor it can open`, exit 1. Its opened and failed cases expect `[ok] Opened <dir> in <label>` and the failure title `<label> did not open`. In `code-launch.test.ts`, assert `launchEditor` spawns `/bin/sh` with `["-c", "<editor> \"$1\"", "sh", target]` and `stdio: ["inherit", 2, "inherit"]` (read the file's existing seam for the launcher and extend it).

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement** by the copy table. `navigate` uses `const release = out.holdStdout();` and `release(); out.payload(\`${path}\n\`);` in `cdAndExit`, with `release()` in the `finally`. The Quick Look lines and failure; the two `spawnSync` sites' `stdio`. In `code.ts`: delete `noEditorAsToday`; `openDirectoryInEditor` passes `noEditorFailure`; its result lines by the table; `launchEditor`:

```ts
function launchEditor(editor: string, target: string): string | null {
  const attempt = (command: string): boolean =>
    spawnSync("/bin/sh", ["-c", `${command} "$1"`, "sh", target], { stdio: ["inherit", 2, "inherit"], env: childEnv() }).status === 0;
  if (attempt(editor)) return editor;
  const fallback = appBundleFallback(editor);
  return fallback && attempt(fallback) ? fallback : null;
}
```

(`spawnSync` from `child_process`; remove `execSync` from the import if no use remains.) Remove the `lib/tui.ts` import. Delete `commands/nav.ts` and `commands/code.ts` from the allowlist.

- [ ] **Step 4:** Run `bun test commands/__tests__/nav.test.ts commands/__tests__/code-output.test.ts commands/__tests__/code-launch.test.ts commands/__tests__/code-prefs.test.ts commands/__tests__/cd-nav-bytes.test.ts lib/__tests__/no-raw-output.test.ts`. PASS; `grep -n "console\.\|process\.std\(out\|err\)\.write\|lib/tui" commands/nav.ts commands/code.ts` prints nothing.
- [ ] **Step 5:** Commit, message `nav: Quick Look and editor lines on stderr, children write to the terminal, the editor target passed as an argument`.

---

### Task 7: `rt run`

**Files:** `commands/run.ts`, `commands/__tests__/run-report-save.test.ts`, `run-abort-message.test.ts`, and any `run-*.test.ts` that reads its lines, the allowlist.

- [ ] **Step 1: Failing tests.** In `run-report-save.test.ts` (it tests `reportSave` through `__test__`), change the expectations to blocks through `renderPlain`: a save is `[ok] Saved the preset nightly\n`; a no-identity refusal is `[warning] The preset was not saved  rt cannot tell which repo this is\n  next: rt settings set rt.repoIdentityOverrides\n`; another error is `[warning] The preset was not saved  disk full\n`. Make `reportSave` return blocks (`reportSaveBlocks(kind, label, result): Block[]`) and print them, so the test reads the builder. In `run-abort-message.test.ts`, change the no-scripts, no-repos and no-worktrees messages to the copy table's titles.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement** by the copy table. At the top of `runCommand` and `runAgainCommand`, call `out.payloadOnStdout()`: stdout carries only the `--resolve-only` and seed JSON, which keep `process.stdout.write(JSON.stringify(x) + "\n")` rewritten as `out.json(x)` (the same bytes). Every `process.stderr.write` becomes the copy table's block; the two screen clears call `clearScreen()`. The `Running` line stays the last thing before the child takes the terminal, as today. Remove the `lib/tui.ts` import; delete `commands/run.ts` from the allowlist.
- [ ] **Step 4:** Run `bun test commands/__tests__/run-*.test.ts commands/__tests__/runner-command.test.ts lib/__tests__/no-raw-output.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `run: result and running lines on the layer; the seed and resolve JSON unchanged`.

---

### Task 8: `rt runner` and `rt glitter` preflight and teardown

**Files:** `commands/runner.ts`, `commands/glitter.ts`, `lib/runner/runner.ts`, `commands/__tests__/runner-command.test.ts`, `e2e/tests/glitter.test.ts`, the allowlist.

- [ ] **Step 1: Failing tests.** In `runner-command.test.ts`, the seed-file error case expects stderr to start with the error as a failure title (no `rt runner:` prefix). Add `bg release and reconcile failures are logged, not printed`: with `setWarningLog` capturing and `acquireBgSocket` given a `bgRelease` that resolves `{ ok: false, error: "boom" }`, calling the returned `release()` logs a `runner` warning containing `bg release failed: boom` and writes nothing to stderr. In `e2e/tests/glitter.test.ts`, both assertions become `rt glitter needs an interactive terminal` (the title, which both the dispatcher's guard and the handler's now start with; read `lib/command-tree.ts`'s guard copy first and match the first test to it).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement** by the copy table: preflight lines through `out.fail`, the housekeeping lines through `warn("runner", ...)` (log only), the `SessionDied` endings through `out.fail`. Delete `commands/runner.ts`, `commands/glitter.ts` and `lib/runner/runner.ts` from the allowlist.
- [ ] **Step 4:** Run `bun test commands/__tests__/runner-command.test.ts lib/runner lib/__tests__/no-raw-output.test.ts` and `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/glitter.test.ts`; `bun run test:pty` for `e2e/pty/glitter.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `runner, glitter: preflight failures on the layer, housekeeping to the log`.

---

### Task 9: The allowlist and the readers

- [ ] **Step 1:** `git diff origin/main -- lib/__tests__/raw-output-allowlist.json`: eight deletions, nothing added.
- [ ] **Step 2:** `rg -n "Upgrading rt shell wrapper|no longer at|cd cache may be stale|No supported editor CLI|Running: |rt runner needs|rt glitter needs" skills plugins/mattstack apps/board/skills marketplace e2e rt-tray/vm`: every hit is updated in this PR or is the new title; list them in the report.

---

### Task 10: Renders, AGENTS.md and every gate

- [ ] **Step 1:** `bun run ui:build`. In the scratchpad, `blocks-6f.ts` builds: the wrapper-out-of-date warning, the copy block with `SHELL_FUNCTION` and the installed line with its `next`, the missing-repo and ghost-folder failures, the no-matching-worktree failure, the Quick Look running line and its failure, the no-editor failure, the opened line, `rt run`'s saved and not-saved lines, the running line, the no-run-history line, and the runner and glitter preflight failures. Copy 5f2's `ansi-page.ts`.
- [ ] **Step 2:** Render at width 100, dark and light (6a Task 8 Step 2).
- [ ] **Step 3:** Screenshot both with Fast Browser into `docs/design/output-layer/6f-cd-nav-run-dark.png` and `-light.png`. Write down plainly what reads wrong: the shell function in the copy block sits at column 0 and pastes clean; nothing but real failures is coral; the out-of-date line reads as a warning, not an error. Fix and re-render. Note in the report that `rt cd` and `rt nav` need Matt's hand check in a real terminal before merge.
- [ ] **Step 4:** README row: `| \`6f-cd-nav-run-dark.png\`, \`6f-cd-nav-run-light.png\` | what \`rt cd\`, \`rt nav\` and \`rt run\` print beside their pickers: the shell function notes, the refusals, Quick Look, the editor lines, the run lines, and the runner and glitter preflight failures. The pickers and boards themselves are unchanged |`.
- [ ] **Step 5:** AGENTS.md (append to "Output layer"):

```markdown
`rt cd` and `rt nav` print a path for the shell wrapper. They call
`out.holdStdout()` while their pickers run, which sends any stray write and
all human text to stderr, then release it and write the path with
`out.payload`. A child they start gets the terminal on stdout through
stderr's descriptor (`stdio: ["inherit", 2, "inherit"]`), never the
wrapper's pipe. Neither erases rows on exit.
```

- [ ] **Step 6:** The eight gates, one at a time (6a Task 8 Step 6). All pass.
- [ ] **Step 7:** Commit, message `docs: cd, nav and run renders and the rule for path verbs`.

---

### Task 11: Ship

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`; merge the allowlist, `AGENTS.md`, README and `lib/ui/out.ts` (6a's two exports, then `holdStdout`) by hand.
- [ ] **Step 2:** The eight gates again.
- [ ] **Step 3:** `git diff --shortstat origin/main...HEAD`; about 1,900 lines (option B).
- [ ] **Step 4:** Push with `git_push`; body in `<scratchpad>/pr-body-6f.md` (framing; **cd and nav** with Decision 1's option named; **code** (`savePrefs`, the editor target as an argument); **run, runner, glitter**; the renders; gates; a line that the PR waits for Matt's hand check of `rt cd` and `rt nav`; last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`); `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 6f, session-cd-nav" --body-file <scratchpad>/pr-body-6f.md`.
- [ ] **Step 5:** Report URL, gates, size, renders. Do not merge.

---

## Option A (if Matt chooses the exemption)

Replace Tasks 5 to 7's `rt cd` and `rt nav` work with these two tasks; Tasks 3 (`savePrefs`), 7 (`rt run`) and 8 (`runner`, `glitter`) run as written.

### Task 5A: Fix the erase, then exempt the four files

**Files:** `commands/cd.ts`, `lib/__tests__/raw-output-exemptions.json`, `lib/__tests__/raw-output-allowlist.json`, `commands/__tests__/cd-nav-bytes.test.ts`.

- [ ] **Step 1: Failing test:** `rt cd registers no exit-time erase` (Task 5 Step 1's first test).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Delete the `process.once("exit", ...)` erase hook and its comment in `commands/cd.ts`. Nothing else in the file changes.
- [ ] **Step 4:** Count each file's raw lines with Task 4 Step 1 of 6a's one-liner (pointed at `commands/cd.ts`, `commands/nav.ts`, `commands/code.ts`, `lib/pickers.ts`). Add four entries to `lib/__tests__/raw-output-exemptions.json`, sorted by `file`, each with its count and the reason `rt cd and rt nav are rt-ui session verbs; their raw lines are kept byte for byte (Matt, 2026-10-01)` (for `code.ts` and `pickers.ts`: `the paths rt cd and rt nav reach keep their bytes (Matt, 2026-10-01)`). Delete the four files from the allowlist.
- [ ] **Step 5:** Run `bun test lib/__tests__/no-raw-output.test.ts commands/__tests__/cd-nav-bytes.test.ts commands/__tests__/cd.test.ts`. PASS. Commit, message `cd: no erase of the typed command line; cd, nav and the paths they reach go on the exemption list`.

### Task 6A: The `rt nav` stdout bugs stay, named

No code. Report that option A leaves the two bugs 5c recorded (the no-editor lines on stdout under `rt nav`, and three children inheriting stdout) and `missingRepoRefusal`'s long dash and wire form, and that `savePrefs` (Task 3) is fixed regardless.

## Decisions this plan made

1. **Option B is the written path,** per the scoping document's recommendation; option A is a two-task substitute.
2. **`rt runner`'s and `lib/runner/runner.ts`'s housekeeping lines are log only.** They fire around or under a live board; printing over it tears the board, and the person cannot act on them.
3. **The editor target becomes `$1` in `launchEditor`**, as `spawnEditor` already does, in the same edit that redirects its stdout: the shell string spliced a path into quotes.
4. **`lib/pickers.ts` drops its `legacyCd` branches** under option B: every caller now gets the same failures.

## Self-Review

**Spec coverage.** Rules 1 and 2 for `rt cd` and `rt nav`: Tasks 4 to 6. "Non-goals": `runner` and `glitter` preflight only (Task 8). The folded-in erase (Task 5 / 5A), `savePrefs` (Task 3), `missingRepoRefusal` (Task 5), row 52 (Task 3). Eight allowlist lines (Tasks 5 to 8, or 5A).

**Placeholders.** Two tests lean on a named fake the implementer reads first (the prompt fake that answers the wrapper confirm; `code-launch.test.ts`'s launcher seam); each names the fake and every assertion.

**Type consistency.** `holdStdout(): () => void`, `wrapperNotes`, `reportSaveBlocks`, `launchEditor` match their uses.

**Review Focus.** Five lines, each pinned by a named test.
