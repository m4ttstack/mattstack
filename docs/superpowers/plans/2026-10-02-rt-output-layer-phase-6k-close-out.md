# rt Output Layer, Phase 6k (close-out) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish RT-369. With the raw-output allowlist empty on main, retire it: the guard fails on any raw print outside the output layer and the exemption list, `lib/ansi.ts`, the `lib/tui.ts` shim and `lib/tui/palette.ts` (with its test) are deleted, `exitUserError` loses the unused `verb` argument (phase 5 ruling 10), `healErrorClause` is deleted now that no caller remains, and AGENTS.md and the spec say the work is done.

**Architecture:** Deletions and one signature change, each guarded by the compiler or the guard test. Nothing a person sees changes; Task 7 proves it by rendering the shared fixture before and after and comparing bytes.

**Tech Stack:** Bun + TypeScript, `bun:test`, Go (one comment), Fast Browser.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (RT-369): "Guard" ("The project is done when the allowlist is empty, at which point `lib/ansi.ts`, the `lib/tui.ts` shim and any unused part of `lib/tui/palette.ts` are deleted"), phase 6. **Scoping:** `docs/superpowers/plans/2026-10-02-rt-output-layer-phase-6-scoping.md`, 6k, shared items 1 and 6, "Carried from earlier phases". Phase 5's ruling 10 (`exitUserError`'s `verb` stays until phase 6) is in `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5-scoping.md`.

**Size:** about 700 changed lines (mostly deletions). One PR. Runs last: after 6a to 6j are all on main.

**What was run while writing this plan:** nothing was compiled. Written against `origin/main` at `658e704b9`, where the allowlist still holds 42 files; Task 1 stops unless it is empty.

## Global Constraints

- Never use em dashes or en dashes anywhere. Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show.
- No output changes: no `--json`, exit code, plain text or styled render changes. Task 7 is the proof.
- The exemption list keeps only seams (scoping shared item 1): `lib/cli-logger.ts`, `lib/daemon-logger.ts`, `lib/daemon/inject.ts`. `rt cd` and `rt nav` were converted (Matt's Ruling 1), so none of their files is exempt.
- Run `bun test` only from the repo root; Go from `ui/`. Never run a built `rt` outside an isolated HOME.
- Git commands plain and alone from the worktree root. Never `git add -A`, `.` or `-u`. Deleting a file: `git rm <path>`, one path per command.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Files this slice must not edit beyond those named in each task.
- UI validation is mandatory: Task 7 renders the fixture dark and light and confirms it is unchanged.

## Review Focus

1. **A new raw print after this PR.** A `console.log` added to any file under `cli.ts`, `commands/` or `lib/` (outside `lib/ui/` and the exemptions) fails the guard with the file named. Pinned in Task 2 (`no file outside the output layer and the exemptions prints raw`, proven by planting a line).
2. **A plugin or extension that imported `lib/ansi.ts` or `lib/tui.ts`.** None exists in the repo (Task 3 greps `extensions/`, `plugins/`, `apps/`, `packages/` and `rt-tray/` too); a user plugin under `~/.rt/plugins/` imports only `lib/plugin-api-types.ts`. Pinned in Task 3's grep step.
3. **A caller of `exitUserError` passing a verb string.** The compiler finds every one after the signature change; none survives. Pinned in Task 4 (`bun run typecheck`).
4. **The Go token sheet without its TS parity test.** `ui/internal/theme` is the one source; `theme_test.go` still pins contrast. Pinned in Task 3 (`go -C ui test ./internal/theme/`).
5. **The styled output.** Byte-identical for the shared fixture, dark and light. Pinned in Task 7.

---

### Task 1: Confirm the base

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`.
- [ ] **Step 2:** Run `cat lib/__tests__/raw-output-allowlist.json`. Expected: `[]` (and a newline). Anything else: **stop**, report which files remain and which slice owns them (scoping section 1).
- [ ] **Step 3:** Run `cat lib/__tests__/raw-output-exemptions.json`. Expected: exactly the three seams. Any other entry: stop and report.
- [ ] **Step 4:** Run `grep -rn "healErrorClause" --include=*.ts commands lib`. Expected: only `lib/repo-index.ts` (the definition) and `lib/__tests__/repo-index.test.ts`. A caller elsewhere: stop and report (6g or 6h has not landed).
- [ ] **Step 5:** Run `bun test lib/__tests__/no-raw-output.test.ts lib/__tests__/errors.test.ts lib/tui`. PASS, or stop.

---

### Task 2: Retire the allowlist

**Files:** `lib/__tests__/no-raw-output.test.ts`; delete `lib/__tests__/raw-output-allowlist.json`.

- [ ] **Step 1: Rewrite the guard.** Replace the file's body below the imports with:

```ts
// Human output goes through lib/ui/out.ts. The exemptions are the seams that
// must touch a stream directly, each with its reason and the exact number of
// raw lines it holds.
const ROOT = resolve(import.meta.dir, "..", "..");
const EXEMPTIONS = resolve(import.meta.dir, "raw-output-exemptions.json");
const SCAN_ROOTS = ["cli.ts", "commands", "lib"];

// The output layer itself.
const LAYER = /^lib\/ui\//;

const RAW = [/\bconsole\.(log|error|warn|info)\s*\(/, /\bprocess\.std(out|err)\b(?!\.(isTTY|columns|rows|fd|on|once|off|removeListener)\b)/, /from\s+["'][^"']*\/(ansi|tui|tui\/palette)\.ts["']/, /\\x1b\[|\\u001b\[/];

interface Exemption {
  file: string;
  reason: string;
  lines: number;
}

function collect(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(path, entry.name);
    if (entry.name === "node_modules" || entry.name === "__tests__") return [];
    if (entry.isDirectory()) return collect(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

function rawLines(file: string): number {
  return readFileSync(resolve(ROOT, file), "utf8")
    .split("\n")
    .filter((line) => RAW.some((re) => re.test(line))).length;
}

const exemptions = JSON.parse(readFileSync(EXEMPTIONS, "utf8")) as Exemption[];
const exempt = new Set(exemptions.map((e) => e.file));

function offenders(): string[] {
  return SCAN_ROOTS.flatMap((root) => collect(resolve(ROOT, root)))
    .map((file) => relative(ROOT, file))
    .filter((file) => !LAYER.test(file) && !exempt.has(file) && rawLines(file) > 0)
    .sort();
}

test("no file outside the output layer and the exemptions prints raw: use lib/ui/out.ts", () => {
  expect(offenders()).toEqual([]);
});

test("an exempt file holds exactly the raw lines its entry allows", () => {
  const drift = exemptions.filter((e) => rawLines(e.file) !== e.lines).map((e) => `${e.file}: entry says ${e.lines}, file has ${rawLines(e.file)}`);
  expect(drift).toEqual([]);
});

test("an exempt file that no longer prints raw is removed from the exemptions", () => {
  expect(exemptions.filter((e) => rawLines(e.file) === 0).map((e) => e.file)).toEqual([]);
});

test("every exemption gives a reason, and the list is sorted with no duplicates", () => {
  expect(exemptions.filter((e) => e.reason.trim().length < 20).map((e) => e.file)).toEqual([]);
  const files = exemptions.map((e) => e.file);
  expect(files).toEqual([...new Set(files)].sort());
});
```

(drop `writeFileSync` from the `fs` import; the `RT_UPDATE_RAW_OUTPUT_ALLOWLIST` regeneration goes with the allowlist). `lib/tui/` and the two color modules leave the exempt set: Task 3 deletes the color modules, and what remains under `lib/tui/` (`utils/label.ts`) prints nothing.

- [ ] **Step 2:** `git rm lib/__tests__/raw-output-allowlist.json`.
- [ ] **Step 3: Prove it bites.** Add `console.log("x");` as the last line of `lib/repo-label.ts`; run `bun test lib/__tests__/no-raw-output.test.ts`: FAIL naming `lib/repo-label.ts`. Remove the line; `git diff --stat lib/repo-label.ts` prints nothing.
- [ ] **Step 4:** Run the guard: PASS. Run `grep -rn "raw-output-allowlist" --include=*.ts --include=*.yml --include=*.json . --exclude-dir=node_modules --exclude-dir=docs`: no output (a hit in `.github/workflows/*.yml` or a script is updated in this task and named in the report).
- [ ] **Step 5:** Commit (`lib/__tests__/no-raw-output.test.ts` and the deletion), message `guard: the raw-output allowlist is empty, so it is gone; only the output layer and the reasoned exemptions may touch a stream`.

---

### Task 3: Delete the color modules

**Files:** delete `lib/ansi.ts`, `lib/tui.ts`, `lib/tui/palette.ts`, `lib/tui/__tests__/palette.test.ts`; modify `ui/internal/theme/theme.go` (header comment), `lib/explain-error.ts` (header comment), `e2e/tests/settings.test.ts:121` (comment).

- [ ] **Step 1: Confirm nothing imports them.** Run `rg -n "lib/ansi|/ansi\.ts|lib/tui\.ts|/tui\.ts\"|tui/palette" --glob '*.ts' --glob '*.tsx' --glob '*.go' --glob '*.swift' --glob '!node_modules' --glob '!docs/**' .`. Expected: only the four files being deleted, `theme.go:1`, `lib/explain-error.ts:3` and `e2e/tests/settings.test.ts:121` (comments). Any import elsewhere: stop and report the file (a slice left one).
- [ ] **Step 2:** `git rm lib/ansi.ts`; `git rm lib/tui.ts`; `git rm lib/tui/palette.ts`; `git rm lib/tui/__tests__/palette.test.ts` (four commands).
- [ ] **Step 3: Comments.** `ui/internal/theme/theme.go:1-2` becomes:

```go
// Package theme is the rt-ui token sheet. Every color and glyph rt-ui paints
// comes from here; nothing crosses the wire.
```

`lib/explain-error.ts:3`: `always shown for it. Its own module (no lib/repo-arg.ts or other` (dropping `lib/tui.ts,`) with the next line rewrapped. `e2e/tests/settings.test.ts:121`: `/** Off a terminal rt prints plain text; a styled run is stripped before asserting. */` (read `stripAnsi`'s callers first; if the comment's claim no longer holds because no assertion needs stripping, keep the function and this comment as written here).

- [ ] **Step 4:** Run `bun run typecheck` (no errors), `bun test lib`, `go -C ui test ./internal/theme/ ./internal/render/`, `bun run check`. PASS.
- [ ] **Step 5:** Commit, message `delete lib/ansi.ts, the lib/tui.ts shim and lib/tui/palette.ts: nothing prints with them any more`.

---

### Task 4: `exitUserError` without the unused `verb`

**Files:** `lib/errors.ts`, `lib/__tests__/errors.test.ts`, and every caller (at `658e704b9`: `commands/services.ts` 3, `commands/deps.ts` 1, `commands/release.ts` 2, `commands/skills.ts` 1, `commands/repos-reidentify.ts` 3, `commands/team.ts` 7, `commands/repos.ts` 6, `commands/cron.ts` 2, `commands/tools.ts` 4, `lib/errors.ts` 2; later slices may have added or removed some).

**Interfaces:**
- Changes: `exitUserError(err: UserActionableError, json: boolean, print?: (s: string) => void): never`.

- [ ] **Step 1: Failing test.** In `lib/__tests__/errors.test.ts`, change every call to drop the verb string (for example `exitUserError(teamError(), true, (s) => lines.push(s))`, `exitUserError(teamError(), false)`). Run `bun run typecheck`: errors at every changed test call (the third parameter is still a string).
- [ ] **Step 2: Implement.** In `lib/errors.ts`:

```ts
/**
 * Prints the contract's exit-2 payload (--json, on stdout, through `print`
 * when the caller has one) or the failure block on stderr, then exits 2.
 */
export function exitUserError(err: UserActionableError, json: boolean, print?: (s: string) => void): never {
```

and `exitFromDispatch`'s call becomes `exitUserError(err, process.argv.includes("--json"))`.
- [ ] **Step 3:** Run `bun run typecheck`. Every remaining error is a caller still passing a verb: at each, delete the verb argument (a call `exitUserError(e, json, "verb", deps.print)` becomes `exitUserError(e, json, deps.print)`; `exitUserError(e, json, "verb")` becomes `exitUserError(e, json)`). Repeat until clean. Wrappers that only forwarded a verb (`exitTeamError(err, json, verb, deps)` in `commands/team.ts`, `fail(deps, json, verb, err)` shapes) drop their `verb` parameter too, and their callers with it, when the parameter has no other use (read each before changing it).
- [ ] **Step 4:** Run `bun run typecheck` (clean), `bun test lib/__tests__/errors.test.ts commands/__tests__/team*.test.ts commands/__tests__/repos*.test.ts commands/__tests__/services.test.ts commands/__tests__/tools*.test.ts commands/__tests__/release*.test.ts commands/__tests__/skills*.test.ts commands/__tests__/deps*.test.ts commands/__tests__/cron.test.ts`. PASS. `rg -n "exitUserError\([^)]*\"" commands lib --glob '*.ts'`: no output.
- [ ] **Step 5:** Commit, message `errors: exitUserError drops the verb argument it never used`.

---

### Task 5: Delete `healErrorClause`

**Files:** `lib/repo-index.ts:271-274`, `lib/__tests__/repo-index.test.ts:978-982` (the test that pins it; delete the whole `test(...)` block and the import name).

- [ ] **Step 1:** Delete the function and its doc comment from `lib/repo-index.ts`, and its test and import from `lib/__tests__/repo-index.test.ts`.
- [ ] **Step 2:** Run `grep -rn "healErrorClause" --include=*.ts .  --exclude-dir=node_modules --exclude-dir=docs`: no output. `bun run typecheck`: clean. `bun test lib/__tests__/repo-index.test.ts`: PASS.
- [ ] **Step 3:** Commit, message `repo-index: delete healErrorClause, which no caller uses`.

---

### Task 6: AGENTS.md and the spec say it is done

**Files:** `AGENTS.md` ("Output layer"), `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md`.

- [ ] **Step 1: AGENTS.md.** Replace the paragraph that begins `` `lib/__tests__/no-raw-output.test.ts` fails a PR that adds `console.log` `` (at `658e704b9`, lines 280 to 286; it ends `shrinks: converting a file means deleting its line.`) with (wrapped at about 78 columns):

```markdown
`lib/__tests__/no-raw-output.test.ts` fails a PR that adds `console.log`,
`console.error`, `console.warn` or `console.info`, any use of
`process.stdout` or `process.stderr` beyond reading `isTTY`, `columns`,
`rows` or `fd` and attaching listeners, a raw escape or a color import, in
`cli.ts` or under `commands/` or `lib/` outside `lib/ui/`. There is no
allowlist: every print goes through the layer. A file that must touch a
stream directly (a logger, an escape parser) is listed in
`lib/__tests__/raw-output-exemptions.json` with its reason and its exact
count of raw lines; the guard fails if the count moves either way.
```

and, in the same section, delete or reword any other sentence that names `raw-output-allowlist.json`, `lib/ansi.ts`, `lib/tui.ts` or `lib/tui/palette.ts` (`grep -n "allowlist\|lib/ansi\|lib/tui\|palette" AGENTS.md` lists them; the paragraphs earlier phases appended about converted verbs stay).

- [ ] **Step 2: The spec.** Under the title line `Ticket: RT-369. Date: 2026-09-30.`, add a line: `Status: done. Every phase shipped; the raw-output allowlist is gone and the color modules are deleted (phase 6k).` In "Guard", after "The project is done when the allowlist is empty, ...", add: `Done in phase 6k; three logging and parsing seams remain on the exemption list.`
- [ ] **Step 3:** Run `bun run format:check` and `bun run check` (the docs lints). PASS.
- [ ] **Step 4:** Commit, message `docs: the output layer is done; AGENTS.md and the spec say so`.

---

### Task 7: Prove nothing a person sees changed, and every gate

- [ ] **Step 1: Why the output cannot have changed.** This PR changes no file under `lib/ui/` and no Go code (one comment in `ui/internal/theme/theme.go`). Confirm it: `git diff --stat origin/main...HEAD -- lib/ui ui` lists only `ui/internal/theme/theme.go`, and `git diff origin/main...HEAD -- ui/internal/theme/theme.go` shows only comment lines. The render package's tests (`go -C ui test ./internal/render/ ./internal/protocol/`) pin the styled output of every block and decode the shared fixture; they pass unchanged.

The shared fixture `ui/fixtures/render-document.json` is a JSON array of blocks. To render it, write `<scratchpad>/fixture.ndjson` with `bun -e 'const b = await Bun.file("ui/fixtures/render-document.json").json(); process.stdout.write(JSON.stringify({ t: "hello", protocol: 1 }) + "\n" + b.map((x) => JSON.stringify(x)).join("\n") + "\n");' > <scratchpad>/fixture.ndjson`, then, one at a time:

```bash
bun run ui:build
COLORTERM=truecolor TERM=xterm-256color RT_UI_BACKGROUND=dark ./ui/dist/rt-ui render --width 80 < <scratchpad>/fixture.ndjson > <scratchpad>/6k-dark.ansi
COLORTERM=truecolor TERM=xterm-256color RT_UI_BACKGROUND=light ./ui/dist/rt-ui render --width 80 < <scratchpad>/fixture.ndjson > <scratchpad>/6k-light.ansi
```

- [ ] **Step 2:** Turn both renders into pages with 5f2's `ansi-page.ts`, screenshot both with Fast Browser, and compare by eye to `docs/design/output-layer/fixture-dark.png` and `fixture-light.png`. Write down plainly any difference; there should be none. Do not commit these screenshots (nothing changed); attach them to the PR body as the evidence.
- [ ] **Step 3:** Gates, one at a time: `bun run ui:build`, `bun run ui:test`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run test:pty`, `bun run picker:check`, `bun run format:check`, `bun run check`. All pass (known flakes as in 6a).

---

### Task 8: Ship

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`. If a slice merged after Task 1 and re-added a raw line (impossible with the allowlist gone, unless it landed first), the guard says so: fix in the file named.
- [ ] **Step 2:** The nine gates again.
- [ ] **Step 3:** `git diff --shortstat origin/main...HEAD`; about 700 lines, mostly deletions.
- [ ] **Step 4:** Push with `git_push`; body in `<scratchpad>/pr-body-6k.md` (framing: RT-369 is done; **Guard** (no allowlist, the exemptions that remain and why), **Deleted** (`lib/ansi.ts`, `lib/tui.ts`, `lib/tui/palette.ts`, `healErrorClause`), **errors** (`exitUserError`'s signature), **Docs**; the two fixture screenshots as evidence that nothing changed; gates; last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`); `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 6k, close-out" --body-file <scratchpad>/pr-body-6k.md`.
- [ ] **Step 5:** Report URL, gates, size and the fixture comparison. Do not merge.

---

## Decisions this plan made

1. **The allowlist file is deleted, not left as `[]`.** An empty list invites a new entry; with no list, the only way past the guard is the exemption file, whose entries carry a reason and a pinned count.
2. **`lib/tui/` leaves the guard's exempt set.** After the deletions it holds only `utils/label.ts`, which prints nothing.
3. **The TS palette's parity test goes with the palette.** `ui/internal/theme` is the one token sheet; its own tests pin contrast.

## Self-Review

**Spec coverage.** "Guard": allowlist empty, then the color modules deleted (Tasks 2, 3). Phase 5 ruling 10 (Task 4). Scoping shared item 6 (Task 5). The spec and AGENTS.md (Task 6).

**Placeholders.** None. `<scratchpad>` is the implementer's own path.

**Type consistency.** `exitUserError(err, json, print?)` everywhere after Task 4.

**Review Focus.** Five lines, each pinned by a named step.
