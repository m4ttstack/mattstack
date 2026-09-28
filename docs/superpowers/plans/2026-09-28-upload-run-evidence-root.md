# mr_upload run evidence root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mr_upload` accepts a file under `~/.mattstack/work/<run id>/evidence/` when that run exists on this machine, with every other guard check unchanged.

**Architecture:** One new built-in root in `lib/daemon/upload-guard.ts`, derived from the file's realpath (`runEvidenceRoot`) and consulted by `checkUploadPath` after the caller's roots. The handler does not change. The tool description, its generated reference, AGENTS.md and the evidence stage skill name the new root.

**Tech Stack:** Bun, TypeScript, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-09-28-upload-run-evidence-root-design.md` (approved: option b, fence widened to the plugin files).

## Global Constraints

- The bytes-match-extension check, 50 MB cap, regular-file check and `O_NOFOLLOW` verified read stay exactly as they are.
- The run id is checked with `isPathComponent` from `lib/runs/paths.ts`; the runs root comes from `runsRoot()` in the same file.
- Work root: `join(process.env.HOME ?? homedir(), ".mattstack", "work")`, resolved at call time.
- New refusal message, verbatim: `path is outside the allowed upload roots (a worktree of the target repo, the Claude Code temp root, a run's evidence folder, or an rt.mcp.uploadRoots entry)`.
- Tests never touch the real `~/.mattstack`: pass temp `workRoot`/`runsRoot` through opts, or set `HOME`/`RT_RUNS_ROOT` to a temp dir and restore them.
- No em or en dashes anywhere. Comments only for constraints the code cannot show.
- Run `bun test` from the repo root only.

## Review Focus

- Fresh machine with no `~/.mattstack/work` or no runs root: must refuse cleanly, never throw. (Task 1 tests "missing work root" and "missing runs root".)
- A `state.db` that is a directory, not a file: must not count as a run. (Task 1 test.)
- A work root reached through a symlinked alias (`~/.mattstack` on another volume, or macOS `/var` vs `/private/var`): must still accept. (Task 1 test.)
- A non-absolute or empty `workRoot`/`runsRoot` in opts: must refuse, never resolve against the daemon's cwd. (Task 1 test.)
- Default opts must follow a changed `HOME`/`RT_RUNS_ROOT` at call time, not at module load. (Task 1 test.)

---

### Task 1: `runEvidenceRoot` in the upload guard

**Files:**
- Modify: `lib/daemon/upload-guard.ts`
- Test: `lib/daemon/__tests__/upload-guard.test.ts`

**Interfaces:**
- Consumes: `isPathComponent(s: string): boolean` and `runsRoot(): string` from `lib/runs/paths.ts`.
- Produces:
  - `export function workRoot(): string`
  - `export function runEvidenceRoot(real: string, opts: { workRoot: string; runsRoot: string }): string | null`
  - `checkUploadPath(path: unknown, roots: readonly string[], opts?: { maxBytes?: number; workRoot?: string; runsRoot?: string }): UploadCheck` (new optional fields only)

- [ ] **Step 1: Update the existing exact-message assertion**

In `lib/daemon/__tests__/upload-guard.test.ts`, the test "a file outside every root is refused naming the root classes" becomes:

```ts
  test("a file outside every root is refused naming the root classes", () => {
    const p = file(outside, "shot.png", PNG);
    expect(checkUploadPath(p, [root])).toEqual({
      ok: false,
      error: "path is outside the allowed upload roots (a worktree of the target repo, the Claude Code temp root, a run's evidence folder, or an rt.mcp.uploadRoots entry)",
    });
  });
```

- [ ] **Step 2: Write the failing tests for the evidence root**

Change the import line to:

```ts
import { UPLOAD_MAX_BYTES, checkUploadPath, claudeTempRoots, isInsideRoot, runEvidenceRoot, workRoot } from "../upload-guard.ts";
```

Append this describe block after `describe("checkUploadPath", ...)` and before `describe("root helpers", ...)`:

```ts
describe("a run's evidence folder", () => {
  let base: string;
  let work: string;
  let workReal: string;
  let runs: string;
  let outside: string;
  const RUN = "20260928-100000-abcd-123";

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "rt-upload-evidence-"));
    work = join(base, "work");
    runs = join(base, "runs");
    outside = join(base, "outside");
    mkdirSync(work);
    mkdirSync(runs);
    mkdirSync(outside);
    workReal = realpathSync(work);
    addRun(RUN);
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function addRun(id: string, repo = "gitlab.com-acme-widgets"): void {
    mkdirSync(join(runs, repo, id), { recursive: true });
    writeFileSync(join(runs, repo, id, "state.db"), "");
  }

  function put(p: string, bytes: Buffer = PNG): string {
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, bytes);
    return p;
  }

  const opts = () => ({ workRoot: work, runsRoot: runs });

  test("a png in an existing run's evidence folder passes with its realpath", () => {
    const p = put(join(work, RUN, "evidence", "before.png"));
    const res = checkUploadPath(p, [], opts());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.realpath).toBe(join(workReal, RUN, "evidence", "before.png"));
  });

  test("a subfolder of the evidence folder passes", () => {
    expect(checkUploadPath(put(join(work, RUN, "evidence", "round-2", "after.png")), [], opts()).ok).toBe(true);
  });

  test("runEvidenceRoot names the evidence folder under the work root's realpath", () => {
    const p = put(join(work, RUN, "evidence", "before.png"));
    expect(runEvidenceRoot(realpathSync(p), opts())).toBe(join(workReal, RUN, "evidence"));
  });

  test("an evidence folder whose run does not exist is refused", () => {
    const p = put(join(work, "20260101-000000-ffff-1", "evidence", "shot.png"));
    const res = checkUploadPath(p, [], opts());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("outside the allowed upload roots");
  });

  test("a state.db that is a directory does not count as a run", () => {
    mkdirSync(join(runs, "gitlab.com-acme-widgets", "dir-run", "state.db"), { recursive: true });
    expect(checkUploadPath(put(join(work, "dir-run", "evidence", "shot.png")), [], opts()).ok).toBe(false);
  });

  test("sibling folders of the evidence folder are refused", () => {
    expect(checkUploadPath(put(join(work, RUN, "other", "shot.png")), [], opts()).ok).toBe(false);
    expect(checkUploadPath(put(join(work, RUN, "shot.png")), [], opts()).ok).toBe(false);
    expect(checkUploadPath(put(join(work, "scratch", "shot.png")), [], opts()).ok).toBe(false);
    expect(checkUploadPath(put(join(work, "shot.png")), [], opts()).ok).toBe(false);
  });

  test("a .. path out of the evidence folder is refused", () => {
    put(join(work, RUN, "secret.png"));
    mkdirSync(join(work, RUN, "evidence"), { recursive: true });
    expect(checkUploadPath(`${work}/${RUN}/evidence/../secret.png`, [], opts()).ok).toBe(false);
  });

  test("a file symlink out of the evidence folder is refused", () => {
    const target = put(join(outside, "secret.png"));
    mkdirSync(join(work, RUN, "evidence"), { recursive: true });
    symlinkSync(target, join(work, RUN, "evidence", "link.png"));
    expect(checkUploadPath(join(work, RUN, "evidence", "link.png"), [], opts()).ok).toBe(false);
  });

  test("an evidence folder that is a symlink out is refused", () => {
    put(join(outside, "shot.png"));
    mkdirSync(join(work, RUN), { recursive: true });
    symlinkSync(outside, join(work, RUN, "evidence"));
    expect(checkUploadPath(join(work, RUN, "evidence", "shot.png"), [], opts()).ok).toBe(false);
  });

  test("a run folder that is a symlink out is refused", () => {
    const other = "20260928-110000-beef-456";
    addRun(other);
    put(join(outside, "evidence", "shot.png"));
    symlinkSync(outside, join(work, other));
    expect(checkUploadPath(join(work, other, "evidence", "shot.png"), [], opts()).ok).toBe(false);
  });

  test("a work root given through a symlinked alias still admits", () => {
    const alias = join(base, "work-alias");
    symlinkSync(work, alias);
    const p = put(join(work, RUN, "evidence", "shot.png"));
    expect(checkUploadPath(p, [], { workRoot: alias, runsRoot: runs }).ok).toBe(true);
  });

  test("a non-png inside a valid evidence folder still fails the byte check", () => {
    const p = put(join(work, RUN, "evidence", "fake.png"), Buffer.from("hello world, not a png"));
    expect(checkUploadPath(p, [], opts())).toEqual({ ok: false, error: "file bytes do not match a .png signature" });
  });

  test("a missing work root or runs root refuses without throwing", () => {
    const p = put(join(work, RUN, "evidence", "shot.png"));
    expect(checkUploadPath(p, [], { workRoot: join(base, "nope"), runsRoot: runs }).ok).toBe(false);
    expect(checkUploadPath(p, [], { workRoot: work, runsRoot: join(base, "nope") }).ok).toBe(false);
  });

  test("a relative or empty work root or runs root is ignored", () => {
    const p = realpathSync(put(join(work, RUN, "evidence", "shot.png")));
    expect(runEvidenceRoot(p, { workRoot: "", runsRoot: runs })).toBeNull();
    expect(runEvidenceRoot(p, { workRoot: "work", runsRoot: runs })).toBeNull();
    expect(runEvidenceRoot(p, { workRoot: work, runsRoot: "runs" })).toBeNull();
  });

  test("default opts read HOME and RT_RUNS_ROOT at call time", () => {
    const saved = { HOME: process.env.HOME, RT_RUNS_ROOT: process.env.RT_RUNS_ROOT };
    try {
      process.env.HOME = base;
      process.env.RT_RUNS_ROOT = runs;
      expect(workRoot()).toBe(join(base, ".mattstack", "work"));
      const p = put(join(base, ".mattstack", "work", RUN, "evidence", "shot.png"));
      expect(checkUploadPath(p, []).ok).toBe(true);
    } finally {
      if (saved.HOME === undefined) delete process.env.HOME;
      else process.env.HOME = saved.HOME;
      if (saved.RT_RUNS_ROOT === undefined) delete process.env.RT_RUNS_ROOT;
      else process.env.RT_RUNS_ROOT = saved.RT_RUNS_ROOT;
    }
  });
});
```

Note: a realpath can never contain a `.` or `..` component, so a bad `<id>` like `.` is unreachable through `checkUploadPath`; `isPathComponent` still guards the split.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test lib/daemon/__tests__/upload-guard.test.ts`
Expected: FAIL (import of `runEvidenceRoot`/`workRoot` is undefined, and the message test fails).

- [ ] **Step 4: Implement**

In `lib/daemon/upload-guard.ts`:

Change the imports to:

```ts
import { closeSync, constants, fstatSync, openSync, readdirSync, readSync, realpathSync, statSync, type Stats } from "fs";
import { homedir } from "os";
import { basename, extname, isAbsolute, join, relative, sep } from "path";
import { isPathComponent, runsRoot } from "../runs/paths.ts";
```

Add after `contained(...)`:

```ts
export function workRoot(): string {
  return join(process.env.HOME ?? homedir(), ".mattstack", "work");
}

function safeReaddir(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

/**
 * The pipeline saves an unbound run's captures under <work root>/<run id>/evidence/.
 * Split from the file's realpath, never the caller's string, so `..` and every
 * symlink have already resolved: a link out of the work root derives no run.
 */
export function runEvidenceRoot(real: string, opts: { workRoot: string; runsRoot: string }): string | null {
  if (!isValidRoot(opts.workRoot) || !isValidRoot(opts.runsRoot)) return null;
  const workReal = safeRealpath(opts.workRoot);
  if (workReal === null || !isInsideRoot(real, workReal)) return null;
  const [id, folder, ...rest] = relative(workReal, real).split(sep);
  if (id === undefined || !isPathComponent(id) || folder !== "evidence" || rest.length === 0) return null;
  const hasRun = safeReaddir(opts.runsRoot).some(
    (repo) => isPathComponent(repo) && safeStat(join(opts.runsRoot, repo, id, "state.db"))?.isFile() === true,
  );
  return hasRun ? join(workReal, id, "evidence") : null;
}
```

Update the header doc comment's first sentence list of roots so it reads "...under one of the caller's roots or a run's own evidence folder (see runEvidenceRoot)..." (keep the rest of the comment).

Change `checkUploadPath`'s signature and containment check:

```ts
export function checkUploadPath(
  path: unknown,
  roots: readonly string[],
  opts: { maxBytes?: number; workRoot?: string; runsRoot?: string } = {},
): UploadCheck {
```

```ts
  const evidence = { workRoot: opts.workRoot ?? workRoot(), runsRoot: opts.runsRoot ?? runsRoot() };
  if (!contained(real, roots) && runEvidenceRoot(real, evidence) === null) {
    return { ok: false, error: "path is outside the allowed upload roots (a worktree of the target repo, the Claude Code temp root, a run's evidence folder, or an rt.mcp.uploadRoots entry)" };
  }
```

- [ ] **Step 5: Run the guard and handler tests to verify they pass**

Run: `bun test lib/daemon/__tests__/upload-guard.test.ts lib/daemon/__tests__/mr-upload.test.ts`
Expected: PASS, all tests (the handler test asserts the message with `toContain`, so it needs no edit).

- [ ] **Step 6: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/daemon/upload-guard.ts lib/daemon/__tests__/upload-guard.test.ts
git commit -m "upload-guard: accept a run's own evidence folder"
```

---

### Task 2: Name the root in the tool description, AGENTS.md and the evidence stage

**Files:**
- Modify: `lib/mcp/tools.ts:513` (the `mr_upload` description)
- Test: `lib/mcp/__tests__/tools.test.ts` (test "description says GitLab only and names the allowed roots and types")
- Regenerate: `plugins/mattstack/attachments/mcp-tools/reference.md`
- Modify: `AGENTS.md` ("Gates and the `rt_verb` MCP tool", the `mr_upload` sentence)
- Modify: `plugins/mattstack/attachments/pipeline/stage-evidence/SKILL.md:174`
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (version)

**Interfaces:**
- Consumes: the root Task 1 accepts (`~/.mattstack/work/<run id>/evidence/`, run must exist).
- Produces: documentation only.

- [ ] **Step 1: Write the failing assertion**

In the `tools.test.ts` test "description says GitLab only and names the allowed roots and types", add:

```ts
      expect(tool.description).toContain("~/.mattstack/work/<run id>/evidence/");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test lib/mcp/__tests__/tools.test.ts -t "names the allowed roots"`
Expected: FAIL.

- [ ] **Step 3: Update the description**

In `lib/mcp/tools.ts`, replace

`this user's Claude Code temp root (the session scratchpad lives there), or a directory in the rt.mcp.uploadRoots setting;`

with

`this user's Claude Code temp root (the session scratchpad lives there), a pipeline run's own evidence folder (~/.mattstack/work/<run id>/evidence/, for a run that exists on this machine), or a directory in the rt.mcp.uploadRoots setting;`

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the MCP reference**

Run: `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`
Then `git diff --stat plugins/mattstack/attachments/mcp-tools/reference.md`
Expected: one line changed (the `mr_upload` description).

- [ ] **Step 6: AGENTS.md**

In "Gates and the `rt_verb` MCP tool", replace

```
(`lib/daemon/upload-guard.ts`) refuses anything outside the target repo's
worktrees, the user's Claude Code temp root and
`rt.mcp.uploadRoots`, and anything whose bytes do not match its image or
```

with

```
(`lib/daemon/upload-guard.ts`) refuses anything outside the target repo's
worktrees, the user's Claude Code temp root, a pipeline run's own
evidence folder (`~/.mattstack/work/<run id>/evidence/`, for a run that
exists) and `rt.mcp.uploadRoots`, and anything whose bytes do not match its image or
```

- [ ] **Step 7: Evidence stage wording**

In `plugins/mattstack/attachments/pipeline/stage-evidence/SKILL.md`, replace

```
provides) and store it under `~/.mattstack/work/<work-id>/evidence/`.
```

with

```
provides) and store it under `~/.mattstack/work/<run id>/evidence/`,
where `<run id>` is the `runId` `run_start` returned; `mr_upload` accepts
that folder only for a run that exists.
```

- [ ] **Step 8: Bump the plugin version**

In `plugins/mattstack/.claude-plugin/plugin.json`, bump `"version"` one patch above whatever `origin/main` carries at this point (`git fetch origin main` and `git show origin/main:plugins/mattstack/.claude-plugin/plugin.json | grep version`; 0.27.8 today, so 0.27.9).

- [ ] **Step 9: Run the plugin gates CI runs**

```bash
mkdir -p "$TMPDIR/rt-mattstack-empty"
bun cli.ts skills check --pack-dir "$PWD/plugins/mattstack" --mattstack-dir "$TMPDIR/rt-mattstack-empty" --strict
(cd plugins/mattstack && sh tests/certify.sh attachments/pipeline/stage-evidence/)
bun scripts/ci/plugin-version-bumped.ts --base origin/main --plugin plugins/mattstack
```

Expected: all three pass. If `skills check` reports compile drift for a compiled copy of stage-evidence, regenerate that copy with the command it prints and include it in the commit.

- [ ] **Step 10: Commit**

```bash
git add lib/mcp/tools.ts lib/mcp/__tests__/tools.test.ts plugins/mattstack AGENTS.md
git commit -m "mr_upload: name a run's evidence folder in the description, AGENTS.md and the evidence stage"
```

---

## Final verification (after both tasks)

- `bun run test` from the repo root: green.
- `bunx tsc --noEmit`: clean.
- `bash scripts/repo-purity.sh`: clean.
- Isolated-HOME check, never the real `~/.mattstack`: in the session scratchpad write `evidence-check.ts` that builds `<tmp>/.mattstack/work/<id>/evidence/shot.png`, `<tmp>/.mattstack/runs/repo/<id>/state.db`, a sibling `<tmp>/.mattstack/work/<id>/other/shot.png`, a symlink `evidence/link.png` to a png outside, and a `..` path, then calls `checkUploadPath(p, [])` with default opts (importing the guard by absolute path) and prints each verdict. Run it with `env -i HOME=<tmp> PATH="$PATH" bun <scratchpad>/evidence-check.ts`. Expected: evidence passes; sibling, symlink and `..` are refused.
- The mcp-serve e2e lists `mr_upload` by name only and does not cover the guard; no e2e run needed beyond `bun run test`.
