# rt Output Layer, Phase 6i (renderer leftovers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four renderer follow-ups from 5g: a table never clips a leading column (on a pane too narrow for its columns it stacks each row instead, so no value is lost); a command a callout moved to column 0 is followed by a blank row, as a copy block is; `settleBackground` asks the terminal at most once per process even when no answer comes; and `sdm`'s `withProgress` tells the step a task threw, so an older helper never paints a check over a failure. Plus the one `sdm` copy item: "0 of 1 connection have a label".

**Architecture:** Go: `table` in `ui/internal/render/blocks_layout.go` measures, fits, and when `fitColumns` would cut a leading column, draws the rows stacked: each row's first cell on its own line, every other cell on the lines under it, indented, prefixed by its column header when the table has headers. Trees keep `fitColumns` as they are. `calloutLines` marks a column-0 command so the next row starts after a gap, inside a line run and between blocks alike. TS: a module flag in `lib/ui/spawn.ts`; `withProgress` passes `{ thrown }` to `clear`, as `withTransientStep` already does.

**Tech Stack:** Go (`ui/`, lipgloss v2), `go test`, Bun + TypeScript, Fast Browser.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (RT-369): "Rules" 7 and 8 (rails, spacing), "Color roles" (the background resolver asks at most once), "Steps" (`clear` with a thrown task). **Scoping:** `docs/superpowers/plans/2026-10-02-rt-output-layer-phase-6-scoping.md`, "Renderer leftovers" and the `sdm` copy row. **5g's plan** (`docs/superpowers/plans/2026-10-02-rt-output-layer-phase-5g-renderer.md`) built `fitColumns`, `outdent`, `afterCopy` and the steps `clear`; this plan changes them in place.

**Size:** about 900 changed lines. One PR.

**What was run while writing this plan:** nothing was compiled. Written against `origin/main` at `658e704b9`.

## Global Constraints

- Never use em dashes or en dashes anywhere. Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show.
- `PROTOCOL_VERSION` stays 1. No wire change.
- Plain (non-TTY) output keeps its bytes: `lib/ui/out-plain.ts` is not edited. Only styled output (`rt-ui render`) changes.
- No TS change outside `lib/ui/spawn.ts` and `commands/sdm.ts`; no `--json` or exit code change.
- Shared rt-ui primitives are lifted, never hand-rolled: wrapping goes through `wrapCell` and clipping through `textwrap.ClipOn` (AGENTS.md "Shared rt-ui primitives").
- Run Go from `ui/` (`go -C ui ...`); `bun run ui:build` after any change under `ui/`. Run `bun test` only from the repo root.
- Git commands plain and alone from the worktree root. Never `git add -A`, `.` or `-u`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Files this slice must not edit: every file another phase 6 slice owns; `lib/ui/**` except `lib/ui/spawn.ts` and its test; `ui/internal/views/**` (the app views keep their own layout).
- UI validation is mandatory (Task 6): render dark and light, at 100 and at 48 columns.

## Review Focus

1. **`rt settings list` at 48 columns.** Today the widest leading column (the value) is clipped to eight cells and the value is lost. After: every row stacks, every character of every cell is on screen, no row is wider than the pane. Pinned in Task 1 (`TestANarrowTableStacksAndLosesNothing`).
2. **A table that fits.** Nothing changes: same columns, same rule, same bytes as today. Pinned by the existing `TestTableWithHeadersAndARule` and `TestATableLastColumnWrapsInsideItsColumnOnANarrowPane`, which must pass untouched.
3. **A command longer than the pane, then a status line.** The command sits at column 0 alone and a blank row separates it from the line after, so a drag-select of the command does not catch the next row. Pinned in Task 2 (`TestACommandMovedToColumnZeroIsFollowedByAGap`), for a run and for a block boundary.
4. **`NO_COLOR` or an old helper with `rt.ui.background` on auto, during `rt setup apply`'s dozens of steps.** One settle per process, not one per step. Pinned in Task 3 (`settles at most once when no answer comes`).
5. **A cell holding an escape sequence in a stacked table.** Cleaned like any cell. Pinned in Task 1 (`TestAStackedCellIsStillCleaned`).

---

### Task 1: A narrow table stacks instead of clipping

**Files:**
- Modify: `ui/internal/render/blocks_layout.go` (`table`)
- Modify: `ui/internal/render/blocks_layout_test.go`

**Interfaces:**
- Produces: `(r *renderer) stackedTable(b protocol.Block, header []protocol.Cell, avail int)`; `fitColumns` is unchanged and still used by `tree`.

- [ ] **Step 1: Failing tests** (append to `blocks_layout_test.go`; replace `TestATableClipsALeadingColumnWhenTheLastHasNoRoom`):

```go
func TestANarrowTableStacksAndLosesNothing(t *testing.T) {
	b := protocol.Block{T: "table", Headers: []string{"KEY", "VALUE", "SOURCE"}, Rows: []protocol.TableRow{
		cells("rt.worktreeApp", "/Applications/A Long Application Name.app", "user"),
		cells("rt.ui.background", "auto", "default"),
	}}
	got := plainAt(48, b)
	checkWidth(t, got, 48)
	if strings.Contains(got, "…") {
		t.Fatalf("a cell was clipped:\n%s", got)
	}
	for _, want := range []string{"rt.worktreeApp", "/Applications/A Long Application Name.app", "user", "rt.ui.background", "auto", "default"} {
		if !strings.Contains(noSpace(got), noSpace(want)) {
			t.Fatalf("%q is missing:\n%s", want, got)
		}
	}
	if !strings.HasPrefix(rows(got)[0], "  rt.worktreeApp") {
		t.Fatalf("a stacked row starts with its first cell:\n%s", got)
	}
}

func TestATableThatFitsDoesNotStack(t *testing.T) {
	got := plainAt(100, protocol.Block{T: "table", Rows: []protocol.TableRow{cells("feature/a-very-long-branch-name", "ok")}})
	if got != "  feature/a-very-long-branch-name  ok\n" {
		t.Fatalf("got %q", got)
	}
}

func TestAStackedTableWithoutHeadersStillShowsEveryCell(t *testing.T) {
	got := plainAt(30, protocol.Block{T: "table", Rows: []protocol.TableRow{cells("feature/a-very-long-branch-name", "ok")}})
	checkWidth(t, got, 30)
	if strings.Contains(got, "…") || !strings.Contains(got, "ok") || !strings.Contains(noSpace(got), "feature/a-very-long-branch-name") {
		t.Fatalf("got\n%s", got)
	}
}

func TestAStackedCellIsStillCleaned(t *testing.T) {
	got := plainAt(30, protocol.Block{T: "table", Rows: []protocol.TableRow{cells("feature/a-very-long-branch-name", "x\x1b[2Jy\n[ok] forged")}})
	if strings.Contains(got, "\x1b") {
		t.Fatalf("an escape survived:\n%q", got)
	}
	for _, r := range rows(got) {
		if strings.HasPrefix(r, "[ok]") {
			t.Fatalf("a forged row at column 0:\n%s", got)
		}
	}
}
```

`TestATableOnTheNarrowestPaneStaysInsideIt` stays: its group label is still clipped by `fitLine`, so its "…" check holds.

- [ ] **Step 2:** Run `go -C ui test ./internal/render/ -run 'Table|Stack'`. Expected: FAIL (`TestANarrowTableStacksAndLosesNothing` finds "…").

- [ ] **Step 3: Implement.** In `table`, after `r.measure(...)`:

```go
	measured := append([]int(nil), widths...)
	avail := r.width - len(indent)
	widths = fitColumns(widths, avail)
	for i := 0; i < cols-1; i++ {
		if widths[i] < measured[i] {
			r.stackedTable(b, header, avail)
			return
		}
	}
```

and add:

```go
// stackedTable draws a table too narrow for its columns one row at a time:
// the first cell on its own line, each other cell on the lines under it,
// indented and led by its column's header, so no cell is cut.
func (r *renderer) stackedTable(b protocol.Block, header []protocol.Cell, avail int) {
	under := indent + "    "
	for _, row := range b.Rows {
		if row.Group != "" {
			r.emit(indent + r.fitLine(r.p.dim.Render(Clean(row.Group)), avail))
			continue
		}
		if len(row.Cells) == 0 {
			continue
		}
		for _, l := range wrapCell(row.Cells[0], avail) {
			r.emit(indent + r.cell(l))
		}
		for i, c := range row.Cells[1:] {
			cell := c
			if i+1 < len(header) {
				cell = append(append(protocol.Cell{}, header[i+1]...), append(protocol.Cell{{Text: "  "}}, c...)...)
			}
			for _, l := range wrapCell(cell, avail-4) {
				r.emit(under + r.cell(l))
			}
		}
	}
}
```

(`header` cells already carry the `faint` role from `table`'s own header build; `wrapCell` and `r.cell` clean text as every other cell path does.)

- [ ] **Step 4:** Run `go -C ui test ./internal/render/`. Expected: PASS, the existing table tests included. Run `go -C ui vet ./...`.
- [ ] **Step 5:** Commit (`ui/internal/render/blocks_layout.go`, `blocks_layout_test.go`), message `rt-ui: a table too narrow for its columns stacks its rows instead of clipping a value`.

---

### Task 2: A command at column 0 is followed by a gap

**Files:** `ui/internal/render/blocks_basic.go` (`calloutLines`, `lineRun`), `ui/internal/render/render.go` (comment on `afterCopy`), `ui/internal/render/blocks_basic_test.go`.

- [ ] **Step 1: Failing test** (append to `blocks_basic_test.go`):

```go
func TestACommandMovedToColumnZeroIsFollowedByAGap(t *testing.T) {
	long := "rt secrets rotate --team acme-platform-engineering <domain> <key>"
	run := []protocol.Block{
		{T: "line", Status: "done", Title: "Removed alice"},
		{T: "callout", Label: "next", Body: []protocol.Cell{cmd(long)}},
		{T: "line", Status: "skipped", Title: "Nothing else to do"},
	}
	got := rows(plainAt(40, run...))
	at := -1
	for i, r := range got {
		if r == long {
			at = i
		}
	}
	if at < 0 || at+2 >= len(got) || got[at+1] != "" || !strings.Contains(got[at+2], "Nothing else to do") {
		t.Fatalf("no gap after the column-0 command:\n%s", strings.Join(got, "\n"))
	}

	split := rows(plainAt(40, append(run[:2:2], protocol.Block{T: "kv", Key: "Team", Value: "acme"})...))
	for i, r := range split {
		if r == long && (i+1 >= len(split) || split[i+1] != "") {
			t.Fatalf("no gap before the next block:\n%s", strings.Join(split, "\n"))
		}
	}
}
```

- [ ] **Step 2:** Run `go -C ui test ./internal/render/ -run ColumnZero`: FAIL.
- [ ] **Step 3: Implement.** In `calloutLines`, where a command row is outdented:

```go
			if hasCommand(row) && lipgloss.Width(lead+text) > r.width {
				if first {
					r.emit(strings.TrimRight(lead, " "))
				}
				placed := outdent(bar, text, r.width)
				r.emit(placed)
				if placed == text {
					r.afterCopy = true
				}
			} else {
```

and at the top of `lineRun`'s `for _, b := range run` loop:

```go
		if r.afterCopy {
			r.gap()
			r.afterCopy = false
		}
```

In `render.go`, the comment above `blocks` becomes: `// blocks leads the block after a copy, or after a command placed at column 0, with a gap: neither carries a rail to set it apart.`

- [ ] **Step 4:** Run `go -C ui test ./internal/render/`: PASS (5g's `TestACommandMovedToItsOwnRowIsStillCleaned` and the copy-spacing tests included).
- [ ] **Step 5:** Commit, message `rt-ui: a command placed at column 0 is followed by a blank row, as a copy block is`.

---

### Task 3: `settleBackground` settles once

**Files:** `lib/ui/spawn.ts`, `lib/ui/__tests__/spawn.test.ts`.

- [ ] **Step 1: Failing test** (append to `spawn.test.ts`; it already sets `RT_UI_BIN` to the fake helper in its setup, or do so here):

```ts
test("settles at most once when no answer comes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-settle-"));
  const record = join(dir, "record.ndjson");
  const saved = { bin: process.env.RT_UI_BIN, fake: process.env.RT_UI_FAKE, noQuery: process.env.RT_UI_NO_TERMINAL_QUERY };
  process.env.RT_UI_BIN = join(import.meta.dir, "fake-rt-ui.ts");
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  delete process.env.RT_UI_NO_TERMINAL_QUERY;
  bg.__test__.reset();
  bg.__test__.setRead(() => "auto");
  bg.__test__.setTTY(() => true);
  spawnTest.resetSettle();
  try {
    await settleBackground();
    await settleBackground();
    await settleBackground();
    const hellos = readFileSync(record, "utf8").trim().split("\n").filter((l) => JSON.parse(l).t === "hello");
    expect(hellos).toHaveLength(1);
  } finally {
    bg.__test__.reset();
    for (const [k, v] of [["RT_UI_BIN", saved.bin], ["RT_UI_FAKE", saved.fake], ["RT_UI_NO_TERMINAL_QUERY", saved.noQuery]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
```

(imports: `* as bg` from `../background.ts`, `settleBackground` and `__test__ as spawnTest` from `../spawn.ts`; add the `fs`, `os`, `path` names the file lacks.)

- [ ] **Step 2:** Run: FAIL (three hellos; `resetSettle` does not exist).
- [ ] **Step 3: Implement** in `lib/ui/spawn.ts`:

```ts
// A terminal that did not answer once will not answer the next step either.
let settled = false;

export async function settleBackground(): Promise<void> {
  const env = rtUiEnv();
  if (env.RT_UI_BACKGROUND !== "auto" || settled) return;
  settled = true;
  // ...the existing spawn and noteBackgroundReport, unchanged
}
```

and add `resetSettle(): void { settled = false; }` to the existing `__test__` object at the end of `spawn.ts` (beside `setExit`).

- [ ] **Step 4:** Run `bun test lib/ui/__tests__/spawn.test.ts lib/ui/__tests__/steps.test.ts lib/ui/__tests__/transient-step.test.ts lib/__tests__/no-daemon-sync-exec.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `ui: settle the terminal background once per process, answer or not`.

---

### Task 4: `withProgress` tells the step a task threw

**Files:** `commands/sdm.ts` (`withProgress`), `commands/__tests__/sdm.test.ts`.

- [ ] **Step 1: Failing test.** In `commands/__tests__/sdm.test.ts`, the test `a task that throws still clears its step` (line 102 at `658e704b9`) expects:

```ts
    expect(sent().at(-1)).toEqual({ t: "done", title: "Connecting to Acme QA", status: "failed", clear: true });
```

and its name becomes `a task that throws clears its step as failed`.
- [ ] **Step 2:** Run `bun test commands/__tests__/sdm.test.ts -t "throws"`: FAIL (no `status`).
- [ ] **Step 3: Implement.**

```ts
  let thrown = false;
  try {
    return { value: await task(onLine), tail };
  } catch (err) {
    thrown = true;
    throw err;
  } finally {
    await step?.clear({ thrown });
  }
```

- [ ] **Step 4:** Run the file: PASS.
- [ ] **Step 5:** Commit, message `sdm: a task that throws ends its step as failed, not done`.

---

### Task 5: "0 of 1 connection have a label"

**Files:** `commands/sdm.ts` (`enrichmentBlocks`), `commands/__tests__/sdm.test.ts`.

- [ ] **Step 1: Failing test:**

```ts
test("the label count reads right for every count", () => {
  const line = (e: number, t: number) => renderPlain(__test__.enrichmentBlocks("/x/labels.json", e, t)).split("\n")[1];
  expect(line(0, 1)).toBe("[not yet] Labels on 0 of 1 connection  the rest show their StrongDM names");
  expect(line(1, 3)).toBe("[not yet] Labels on 1 of 3 connections  the rest show their StrongDM names");
  expect(line(3, 3)).toBe("[ok] Labels on all 3 connections");
  expect(line(1, 1)).toBe("[ok] Labels on the 1 connection");
});
```

(`enrichmentBlocks` is already in `sdm.ts`'s `__test__`).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.**

```ts
function enrichmentBlocks(path: string, enriched: number, total: number): Block[] {
  if (total === 0) return [out.kv("labels file", path), out.line("skipped", "StrongDM shows no connections to label")];
  const noun = total === 1 ? "connection" : "connections";
  if (enriched === total) return [out.kv("labels file", path), out.line("done", total === 1 ? "Labels on the 1 connection" : `Labels on all ${total} ${noun}`)];
  return [out.kv("labels file", path), out.line("pending", `Labels on ${enriched} of ${total} ${noun}`, "the rest show their StrongDM names")];
}
```

- [ ] **Step 4:** Run the file: PASS.
- [ ] **Step 5:** Commit, message `sdm: the label count reads right for one connection`.

---

### Task 6: Renders, AGENTS.md and every gate

- [ ] **Step 1:** `bun run ui:build`. In the scratchpad, `blocks-6i.ts` emits: a three-column settings-style table with headers and a long value, a two-column table without headers and a long first cell, a `next` callout holding a command wider than 48 columns followed by a status line and then a `kv` row, and the enrichment line at 0 of 1 and 3 of 3. Copy 5f2's `ansi-page.ts`.
- [ ] **Step 2:** Render four pages: width 100 and width 48, each dark (`RT_UI_BACKGROUND=dark`) and light (`RT_UI_BACKGROUND=light`).
- [ ] **Step 3:** Screenshot the four with Fast Browser into `docs/design/output-layer/6i-renderer-{dark,light}.png` (100 columns) and `6i-renderer-narrow-{dark,light}.png` (48). Write down plainly what reads wrong: at 48 columns a stacked row's cells read as belonging to their row (the indent and header prefix make the grouping clear) and the next row's first cell is easy to find; at 100 nothing stacks; the column-0 command has its blank row; nothing is clipped. Fix in Tasks 1 or 2 and re-render.
- [ ] **Step 4:** README rows for the two pairs: `| \`6i-renderer-dark.png\`, \`6i-renderer-light.png\` | at 100 columns: tables that fit, a command at column 0 with its gap, the label counts |` and `| \`6i-renderer-narrow-dark.png\`, \`6i-renderer-narrow-light.png\` | the same at 48 columns: tables stacked row by row, nothing clipped |`.
- [ ] **Step 5:** AGENTS.md: append to the "Output layer" section: `A table rt-ui cannot fit without cutting a leading column stacks instead: each row's first cell on its own line, the other cells under it, each led by its column header. No value is ever clipped in a table; trees still clip a leading column to keep their branches aligned.`
- [ ] **Step 6:** Gates, one at a time: `bun run ui:build`, `bun run ui:test`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run test:pty`, `bun run picker:check`, `bun run format:check`, `bun run check`. All pass (known flakes as in 6a; `TestTextValidatesPatternThenAccepts` is RT-413's).
- [ ] **Step 7:** Commit, message `docs: renderer leftover renders, narrow and wide`.

---

### Task 7: Ship

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`; merge `AGENTS.md` and the README by hand.
- [ ] **Step 2:** The nine gates again. After pulling, `bun run ui:build`.
- [ ] **Step 3:** `git diff --shortstat origin/main...HEAD`; about 900 lines.
- [ ] **Step 4:** Push with `git_push`; body in `<scratchpad>/pr-body-6i.md` (framing; **Tables**, **Callouts**, **Background**, **sdm** groups; the four renders; gates; last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`); `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 6i, renderer" --body-file <scratchpad>/pr-body-6i.md`.
- [ ] **Step 5:** Report URL, gates, size, what the renders showed. Do not merge.

---

## Decisions this plan made

1. **Stack, do not clip.** A narrow table's rows stack whenever `fitColumns` would cut a leading column, so a value is never lost; the alternatives (share the shrink across columns, or clip the widest as today) still cut a value. Trees keep clipping: their branch rails need aligned columns, and their leading cells are short labels.
2. **The stacked layout drops the header row and rule** and leads each later cell with its header instead, so the header stays next to the value it names.
3. **`settleBackground` settles once per process** whatever happened, because a terminal that did not answer once will not answer a moment later; `rt.ui.background` set to `dark` or `light` skips it altogether, as today.

## Self-Review

**Spec coverage.** The four renderer leftovers and the sdm copy row of the scoping document: Tasks 1 to 5. Rules 7 and 8: Task 2. The resolver asking at most once: Task 3. Steps `clear` with a thrown task: Task 4.

**Placeholders.** None. `<repo>` and `<scratchpad>` are the implementer's paths.

**Type consistency.** `stackedTable(b, header, avail)`, `afterCopy`, `settled` / `resetSettle`, `withProgress`'s `thrown`, `enrichmentBlocks` match across tasks.

**Review Focus.** Five lines, each pinned by a named test.
