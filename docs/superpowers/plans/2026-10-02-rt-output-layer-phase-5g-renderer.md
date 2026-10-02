# rt Output Layer, Phase 5g (renderer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The shared rt-ui renderer reads right on a light and a dark terminal and on a narrow pane: one palette for both backgrounds, words that break at spaces (and long refs at a separator), tables, trees and diffs that stay inside the pane, a command that sits on its own callout row, failure details under their block, kv rows that share a key column, a real blank-line block, and the step runner's loose ends tied off.

**Architecture:** All drawing changes live in Go (`ui/internal/theme`, `ui/internal/textwrap`, `ui/internal/render`, `ui/internal/steps`). The TypeScript side changes only where the wire changes: a `blank` block (builder, plain renderer, fixture, two callers that used an empty table as a blank row) and a `status` riding the step's erasing `done`. Plain output keeps its words and bytes, apart from those two wire changes, which print exactly what they replace.

**Tech Stack:** Go 1.x with lipgloss v2 and `charmbracelet/x/ansi` (`ui/`), Bun + TypeScript (`lib/ui/`), `go test`, `bun:test`, Fast Browser for the renders.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369): "Color roles", "Status set", "Block vocabulary", "Rules" (6, 7 and 8 above all) and "Steps". The layer API this plan builds on is fixed by `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5a-layer-additions.md` ("API for slices 5b to 5f", Tasks 5 to 10); this plan cites it and never redefines it. House style follows `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5f2-chat.md`.

**Size:** about 1,350 changed lines (insertions plus deletions, PNGs not counted). One PR. The per-task estimate is in "Size" at the end; Task 10 measures the real diff.

**What was run while writing this plan:** nothing was compiled or rendered. The code below was written against `origin/main` at `765663d13`, and the expected strings in the tests were worked by hand (the words-only wraps through a small simulation of `wordRows`). Task 1 Step 1 rebases first; if a file this plan edits has moved, main wins and the task ledger records the difference.

## Scope (the 5g items list)

The items list for this slice lives outside the repo, so it is restated here. The renderer is `ui/internal/render`, `ui/internal/theme`, `ui/internal/textwrap` and the steps verb, plus the TS builders in `lib/ui/out.ts` and `lib/ui/out-plain.ts` only where a renderer fix needs a builder change. No per-verb copy work.

| Item | Defect | Task |
|---|---|---|
| 1 | Light background: peach (stale, warn, next), purple kv keys, green "standing access", the pending, off and refused glyphs and dim hints are too faint. Dark: idle and offline barely quieter than listening; tree branches faint | 1 |
| 2 | Hard breaks mid-word ("it wou / ld add a second copy", "setu / p.ts", "2026-09 / -30T10-00-00"): rows must break at words, and an unbreakable token must break at a separator or move whole rather than split mid-run | 2 |
| 3 | A table's or tree's last column does not wrap or clip on a narrow pane; long diff lines are not wrapped; tables do not clip at all | 3 |
| 4 | A callout holding a sentence plus a command reads heavy; decide the shape and apply it in the renderer | 4 |
| 5 | Failure details sit at the block's left edge after a blank row, so back-to-back failures blur together | 5 |
| 6 | kv blocks do not share a key column; decide whether adjacent kv blocks align | 6 |
| 7 | Copy blocks carry a rail in styled output, so a drag-select picks it up; spec rule 7 mandates the rail, AGENTS.md says copy pastes clean. **Matt rules** (Decision D1) | 9 |
| 8 | The breadcrumb's blank line is an empty one-cell table | 7 |
| 9 | Remove the `lib/tui/inline-spinner.ts` shim if no caller remains | 8 |
| 10 | A helper older than the steps `clear` flag ends a `failSilently` step as a plain done row; decide whether TS detects the helper version | 8 |
| 11 | AGENTS.md: say a `failSilently` step prints nothing off a terminal | 8 |

Already fixed, not redone: a wrapped paragraph keeps a line's leading indent (PR 659, `blocks_text.go`). Out of scope: per-verb copy nits, exit codes, the shell strings in `lib/git-backup.ts` and `lib/git-ops.ts`, chat daemon refusal codes, the raw-output allowlist, hidden verbs.

## Decision D1 for Matt: copy blocks and the rail (blocks Task 9 only)

**The conflict.** Spec rule 7: "`copy` and `verbatim` use a thin `│` rail". AGENTS.md "Output layer": "A `copy` block prints at column 0 so it pastes clean". Both are true today, of different renderers: the plain renderer prints copy text at column 0, and the styled renderer draws it behind `    │ `. At a terminal a person drags across `rt team invite`'s multi-line message and pastes four spaces and a `│` at the start of every line into Slack.

**Option A: keep the rail.** Spec rule 7 stands. AGENTS.md is corrected to say the column-0 promise is the plain renderer's, and that at a terminal the rail comes along with a drag. No renderer change. Cost: the invite message, the one copy block a new person is told to paste, keeps pasting dirty, and the copy blocks for commands (`rt git push`'s "the command") do too.

**Option B: no rail, text at column 0 (recommended).** The styled `copy` block prints its caption at the body column (faint, as today) and its text at column 0 in the terminal's foreground, with no glyph on any text row. Spec rule 7 becomes "`verbatim` uses a thin `│` rail; `copy` has none and prints at column 0 so a drag-select pastes clean". The block still stands apart: it is the only text at column 0 in a render where everything else starts at column 2 or 4, under its own caption. Cost: a copy block reads less boxed-in than a verbatim one, and AGENTS.md's existing warning (never put untrusted multi-line text in a copy) now matters at a terminal too, since a line at column 0 could pose as output.

**Option C: no glyph on the text rows, a frame above and below.** A faint `╭─ <caption> ─` row above and a `╰─` row below, both at column 0, with the text rows between them at column 0. A drag across the text rows pastes clean; a drag that takes the frame rows takes two easy-to-trim lines. Cost: two extra rows per copy block, and a frame style no other block uses.

**Recommendation: B.** It is the smallest change that makes the paste clean, it matches what the plain renderer already prints, and the column itself is the cue.

Task 9 implements whichever option Matt picks and does not start without his answer.

## Global Constraints

- Never use em dashes or en dashes in any file, comment, test name, commit message or PR body. Use "..." or rephrase.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show. No narration, no task numbers, no decision history.
- `--json` and payload output are untouched: no `out.json`, `out.payload` or `payloadOnStdout` call changes, and no file under `commands/` changes except `commands/sync.ts`'s one `BRANCH_GAP` line (Task 7).
- Plain (non-TTY) output keeps its wording and its bytes. The only `lib/ui/out-plain.ts` change is the `blank` block (Task 7), which prints the same empty row the empty table it replaces printed.
- No ANSI and no glyph styling on the TS side. Every color lives in `ui/internal/theme`.
- One palette for both backgrounds (Matt's ruling, 2026-10-01). No accent, glyph, label, key, hint or rail branches on `Options.Light`; `Light` keeps choosing the diff tints and nothing else.
- Coral only for failures. The `banner` block is the spec's one exception.
- Body text, titles and commands take the terminal's own foreground. Never give body text a fixed color.
- Shared rt-ui primitives are lifted, never hand-rolled (AGENTS.md "Shared rt-ui primitives"): text clipping goes through the one `Clip`/`ClipOn` that Task 3 lifts out of `ui/internal/views/mission/topbar.go`.
- `PROTOCOL_VERSION` stays 1. A new block type is additive.
- Run `bun test` only from the repo root. Run Go from `ui/` (`go -C ui ...`). `bun run ui:build` after any change under `ui/`.
- Never run a built `rt` binary outside an isolated HOME (`env -i HOME=<temp> PATH="$PATH" ...`). The renders in this plan run only `ui/dist/rt-ui render`, which reads stdin and nothing else.
- Git commands are run plain and alone from the worktree root, never joined with `cd`, `&&`, pipes or heredocs. Never `git add -A`, `git add .` or `git add -u`.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Sample data in tests and renders is invented. No real team, person or host names.
- UI validation is mandatory: every task that changes a drawing renders it dark and light, screenshots both with Fast Browser, and writes down plainly what reads wrong. Tests and contrast maths do not stand in for looking.

## Review Focus

1. **A source checkout whose `ui/dist/rt-ui` predates this branch receives a `blank` block.** The breadcrumb sends one on every command at a terminal. The old helper rejects the whole call (exit 2) and the layer prints it plain, so the header is never lost, only unstyled until `bun run ui:build`. Pinned in Task 7 (`a helper that rejects the blank block still prints the breadcrumb plain`).
2. **The narrowest pane rt-ui renders (20 columns) with a three-column table and a group label wider than the pane.** Every row stays inside 20 cells and nothing panics. Pinned in Task 3 (`TestATableOnTheNarrowestPaneStaysInsideIt`).
3. **Wide characters (CJK) in a column that wraps.** Measured by display width, no row past the pane, no character lost. Pinned in Task 3 (`TestAWideCharacterCellWrapsByDisplayWidth`).
4. **Untrusted text (an escape sequence, a newline posing as a status row) inside a hint that drops below its title, or a command that moves to its own callout row.** Cleaned, and it stays on its own row. Pinned in Task 2 (`TestAHintDroppedBelowItsTitleIsStillCleaned`) and Task 4 (`TestACommandMovedToItsOwnRowIsStillCleaned`).
5. **An excerpt line that is one long token with no separator** (a base64 blob, a minified line). Cut between characters, every row inside the pane, nothing dropped. Pinned in Task 2 (`TestAVerbatimTokenWithNoSeparatorIsCutAndKeepsEveryCharacter`).

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `ui/internal/theme/theme.go` (modify) | The `Static*` tones for output on the terminal's own background | 1 |
| `ui/internal/theme/theme_test.go` (modify) | Contrast on white and on `Bg`; peach apart from coral | 1 |
| `ui/internal/textwrap/textwrap.go` (modify) | `Options.Separators`: where an overlong word may break | 2 |
| `ui/internal/textwrap/clip.go` (create) | `Clip` and `ClipOn`, lifted from mission | 3 |
| `ui/internal/textwrap/textwrap_test.go`, `clip_test.go` (modify, create) | Their tests | 2, 3 |
| `ui/internal/views/mission/topbar.go`, `ui/internal/views/board/render.go` (modify) | `clip`/`clipOn` delegate to the lifted copy | 3 |
| `ui/internal/render/style.go` (modify) | Static tones; `wrapCell` breaks at separators; table helpers removed | 1, 2, 3 |
| `ui/internal/render/render.go` (modify) | Runs of `kv`; the `blank` block | 6, 7 |
| `ui/internal/render/blocks_basic.go` (modify) | Hints that drop below, callout rows, failure details, kv runs | 1, 2, 4, 5, 6 |
| `ui/internal/render/blocks_layout.go` (modify) | Tables and trees that fit the pane | 1, 3 |
| `ui/internal/render/blocks_text.go` (modify) | Verbatim word wrap, diff wrap, copy (per D1) | 2, 3, 9 |
| `ui/internal/render/*_test.go` (modify) | Their tests | 1 to 7, 9 |
| `ui/internal/steps/steps.go`, `steps_test.go` (modify) | Static tones; a cleared step after a throw | 1, 8 |
| `ui/internal/protocol/render.go`, `render_test.go`, `protocol_test.go` (modify) | `blank` on the wire; the new steps fixture | 7, 8 |
| `ui/fixtures/render-document.json` (modify) | One `blank` block | 7 |
| `ui/fixtures/steps-stream-clear-thrown.json` (create) | A cleared step after a throw | 8 |
| `lib/ui/protocol.ts`, `out.ts`, `out-plain.ts` (modify) | `blank` | 7 |
| `lib/ui/spawn.ts`, `steps.ts`, `transient-step.ts` (modify) | `clear({ thrown })` | 8 |
| `lib/tui/inline-spinner.ts` (delete) | The shim | 8 |
| `lib/command-tree.ts`, `commands/sync.ts` (modify, one line each) | `out.blank()` in place of the empty table | 7 |
| `lib/ui/__tests__/*.test.ts`, `lib/__tests__/command-tree-header.test.ts` (modify) | Their tests | 7, 8 |
| `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (modify) | Color roles, rules 6, 7 and 8, `blank` | 1, 6, 7, 9 |
| `AGENTS.md` (modify, "Output layer" only) | One sentence or paragraph per behavior change | 1, 2, 4, 6, 7, 8, 9 |
| `docs/design/output-layer/` (modify) | Regenerated and new renders, README rows | 1 to 9 |

---

### Task 1: One palette for both backgrounds

Item 1. Lands first: it changes the color of every render, so every later render is taken in the new palette.

**Files:**
- Modify: `ui/internal/theme/theme.go:174-183` (the static output block)
- Modify: `ui/internal/theme/theme_test.go` (add two tests; change `TestStaticRuleReadsOnDarkAndOnLight`)
- Modify: `ui/internal/render/style.go:26-53`, `ui/internal/render/blocks_basic.go:69-77,131,160,163`, `ui/internal/render/blocks_layout.go:92`
- Modify: `ui/internal/steps/steps.go:37-46`
- Test: `ui/internal/render/blocks_basic_test.go`, `blocks_layout_test.go`, `blocks_text_test.go`, `ui/internal/steps/steps_test.go`
- Modify: the spec ("Color roles", rule 7), `AGENTS.md` ("Output layer"), `docs/design/output-layer/README.md`
- Regenerate: `docs/design/output-layer/fixture-dark.png`, `fixture-light.png`, `statuses-dark.png`, `statuses-light.png`. Create: `5g-palette-dark.png`, `5g-palette-light.png`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, in package `theme`: `StaticMint` `#1A9461`, `StaticCoral` `#E0484E`, `StaticPeach` `#C4700F`, `StaticLav` `#8A63D2`, `StaticCyan` `#2E86DE`, `StaticQuiet` `#7F78A0`, `StaticRule` `#736D96` (was `#655E88`). As SGR fragments, for tests: mint `26;148;97`, coral `224;72;78`, peach `196;112;15`, lav `138;99;210`, cyan `46;134;222`, quiet `127;120;160`, rule `115;109;150`.
- Produces, in package `render`: `dimStyle` and `faintStyle` are the same `StaticQuiet` tone; `railStyle` is `StaticRule`. Every status glyph takes a `Static*` tone. The diff block keeps the app tints (`theme.Mint`, `theme.Coral`, `DiffAddBg`, `DiffDelBg` and the light pair).
- Produces, for every later task: the render harness in `<scratch>/5g/` (Step 3).

- [ ] **Step 1: Bring main in and record a baseline**

Run: `git fetch origin`
Run: `git rebase origin/main`
Run: `bun install --frozen-lockfile`
Run: `bun run ui:build`
Run: `bun run ui:test`
Run: `bun test lib/ui lib/__tests__/command-tree-header.test.ts commands/__tests__/sync-output.test.ts`
Expected: all pass. A failure here is not this plan's: stop and report it with the output.

Check the one assumption Task 8 makes: run `grep -rn "inline-spinner" --include='*.ts' lib commands cli.ts`. Expected: two hits, `lib/tui/inline-spinner.ts` itself and `lib/ui/__tests__/transient-step.test.ts`. If a third file imports it, Task 8 Step 4 keeps the shim and says so in the report.

- [ ] **Step 2: Write the failing tests**

In `ui/internal/theme/theme_test.go`, add after `TestLightDiffTintsArePaleAndKeepTheirHue`:

```go
func TestStaticTonesReadOnALightAndADarkBackground(t *testing.T) {
	for name, c := range map[string]struct {
		tone color.Color
		min  float64
	}{
		"StaticMint":  {StaticMint, 3.5},
		"StaticCoral": {StaticCoral, 3.5},
		"StaticPeach": {StaticPeach, 3.5},
		"StaticCyan":  {StaticCyan, 3.5},
		"StaticLav":   {StaticLav, 4},
		"StaticQuiet": {StaticQuiet, 4},
	} {
		for ground, bg := range map[string]color.Color{"light": paper, "dark": Bg} {
			if got := contrast(relLuminance(c.tone), relLuminance(bg)); got < c.min {
				t.Errorf("%s on a %s background is %.2f:1, under %.1f:1", name, ground, got, c.min)
			}
		}
	}
}

func TestStaticPeachIsNotMistakenForStaticCoral(t *testing.T) {
	d := math.Abs(hue(StaticPeach) - hue(StaticCoral))
	if d = math.Min(d, 360-d); d < 25 {
		t.Fatalf("peach and coral sit %.0f degrees apart: a warning would read as a failure", d)
	}
}

func hue(c color.Color) float64 {
	r, g, b, _ := c.RGBA()
	rf, gf, bf := float64(r>>8)/255, float64(g>>8)/255, float64(b>>8)/255
	hi, lo := math.Max(rf, math.Max(gf, bf)), math.Min(rf, math.Min(gf, bf))
	if hi == lo {
		return 0
	}
	var h float64
	switch hi {
	case rf:
		h = math.Mod((gf-bf)/(hi-lo), 6)
	case gf:
		h = (bf-rf)/(hi-lo) + 2
	default:
		h = (rf-gf)/(hi-lo) + 4
	}
	if h *= 60; h < 0 {
		h += 360
	}
	return h
}
```

In the same file, change the first threshold of `TestStaticRuleReadsOnDarkAndOnLight` from 3 to 3.5, and its message to `"StaticRule on a dark background is %.2f:1, under 3.5:1"`.

In `ui/internal/render/blocks_basic_test.go`, change line 16 to `const coral = "224;72;78"` and add:

```go
func TestEveryStatusGlyphUsesAStaticTone(t *testing.T) {
	want := map[string]string{
		"done": "26;148;97", "running": "26;148;97", "failed": "224;72;78",
		"needs-you": "196;112;15", "stale": "196;112;15", "warn": "196;112;15",
		"pending": "127;120;160", "refused": "127;120;160", "off": "127;120;160", "skipped": "127;120;160",
	}
	for status, rgb := range want {
		if g := render.Glyph(status); !strings.Contains(g, "38;2;"+rgb+"m") {
			t.Errorf("%s glyph %q, want tone %s", status, g, rgb)
		}
	}
}

func TestKeysLabelsAndRailsUseStaticTones(t *testing.T) {
	for _, c := range []struct {
		block protocol.Block
		tone  string
	}{
		{protocol.Block{T: "kv", Key: "rt.worktreeApp", Value: "true"}, "38;2;138;99;210m"},
		{protocol.Block{T: "callout", Label: "next", Body: []protocol.Cell{cmd("rt setup status")}}, "38;2;196;112;15m"},
		{protocol.Block{T: "callout", Label: "why", Body: []protocol.Cell{text("x")}}, "38;2;127;120;160m"},
		{protocol.Block{T: "verbatim", Lines: []string{"x"}}, "38;2;115;109;150m│"},
		{protocol.Block{T: "banner", Label: "PRODUCTION", Subject: "db"}, "38;2;224;72;78m"},
	} {
		if out := styled(c.block); !strings.Contains(out, c.tone) {
			t.Errorf("%s: no %q in %q", c.block.T, c.tone, out)
		}
	}
}

func TestAccentsDoNotChangeWithTheBackground(t *testing.T) {
	bs := []protocol.Block{
		{T: "line", Status: "needs-you", Title: "Slack", Hint: "not connected"},
		{T: "callout", Label: "next", Body: []protocol.Cell{cmd("rt setup slack connect")}},
		{T: "kv", Key: "rt.worktreeApp", Value: "true", Source: "from team example"},
		{T: "failure", Title: "x", Why: "y"},
		{T: "verbatim", Caption: "value", Lines: []string{"{}"}},
	}
	dark := render.Render(bs, render.Options{Width: 80})
	if light := render.Render(bs, render.Options{Width: 80, Light: true}); light != dark {
		t.Fatalf("one palette for both backgrounds, but the light render differs:\n%q\n%q", dark, light)
	}
}
```

In `ui/internal/render/blocks_layout_test.go`, change `const staticRule = "38;2;101;94;136"` to `const staticRule = "38;2;115;109;150"`.

In `ui/internal/render/blocks_text_test.go`, add `const missionCoral = "255;121;121"` under the imports, and in `TestDiffMarksAddedAndRemovedLines` and `TestDiffTintsFollowTheBackground` replace `coral` with `missionCoral` (a deleted diff line keeps the mission view's coral, spec rule 9).

In `ui/internal/steps/steps_test.go`, replace each `"255;121;121"` with `"224;72;78"` (three tests), and add:

```go
func TestStepTonesComeFromTheStaticPalette(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"connecting…"}`, `{"t":"sub","text":"asking the gateway"}`, `{"t":"fail","title":"Could not connect"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	for _, tone := range []string{"38;2;115;109;150m│", "38;2;127;120;160m", "38;2;224;72;78m"} {
		if !strings.Contains(tty, tone) {
			t.Fatalf("missing %q in %q", tone, tty)
		}
	}
}
```

- [ ] **Step 3: Write the render harness (scratchpad, never committed)**

Create `<scratch>/5g/` (the session scratchpad; `<repo>` below is the worktree's absolute path). Every later task renders through these three files.

`<scratch>/5g/sets.ts`:

```ts
// usage: bun sets.ts <set> > <set>.ndjson
import { readFileSync } from "fs";
import * as out from "<repo>/lib/ui/out.ts";
import { encodeLine, type Block, type Segment, type SegmentRole } from "<repo>/lib/ui/protocol.ts";

const role = (text: string, r: SegmentRole): Segment => ({ text, role: r });

const sets: Record<string, () => Block[]> = {
  fixture: () => JSON.parse(readFileSync("<repo>/ui/fixtures/render-document.json", "utf8")) as Block[],
  statuses: () => [
    out.line("pending", "Slack token", "not started"),
    out.line("off", "Auto sync", "turned off"),
    out.line("refused", "Push to main", "policy says no"),
    out.line("stale", "Skills", "3 behind"),
    out.line("skipped", "Slack", "skipped"),
    out.line("warn", "Daemon", "restarted twice"),
    out.line("running", "Fetching"),
  ],
  palette: () => [
    out.section(
      "Statuses",
      undefined,
      out.line("done", "Skills linked", "16 skills"),
      out.line("failed", "Could not push feature/billing", "the remote said no"),
      out.line("needs-you", "Slack", "not connected"),
      out.line("pending", "Linear", "not connected yet"),
      out.line("stale", "Skills", "3 behind"),
      out.line("refused", "rt will not sync feature/stacked on its own"),
      out.line("off", "pre-push", "you turned it off"),
      out.line("skipped", "Slack", "nothing to do"),
      out.line("running", "Rebasing feature/login onto origin/main", "3 commits behind"),
      out.line("warn", "The tunnel is up, but a test query did not confirm it", "Connection closed"),
    ),
    out.section(
      "Callouts",
      undefined,
      out.line("needs-you", "Setup needs you"),
      out.callout("tip", "Saved rt.logLevel on this Mac only."),
      out.callout("next", out.cmd("rt setup slack connect")),
      out.callout("fix", out.cmd("rt plugin validate notes")),
      out.callout("why", "No key on this machine matches."),
      out.callout("note", "It is likely usable. Try your query again."),
    ),
    out.section(
      "Who is here",
      undefined,
      out.table([
        [out.strong("ana"), role("listening", "running"), out.dim("~/code/sample-app")],
        [out.strong("bo"), role("idle 3m", "pending"), out.dim("~/code/other")],
        [out.strong("cy"), role("offline 2h", "off"), out.dim("~/code/other")],
      ]),
    ),
    out.section(
      "Connections",
      undefined,
      out.table([
        [role("connected", "done"), out.strong("Acme QA"), "qa", out.key("acme:qa")],
        [role("standing access", "running"), out.strong("Acme Staging"), "staging", out.key("acme:staging")],
        [out.dim("on request"), out.strong("Acme Dev"), "dev", out.key("acme:dev")],
      ]),
      out.kv("labels file", "~/.mattstack/rt/sdm/enrichment.jsonc"),
      out.tree(out.key("rt.worktreeApp"), [["user", out.faint("not set")], ["team", "true"]]),
      out.table([[out.link("the docs", "https://example.com/docs"), out.faint("open in a browser")]]),
    ),
    out.summary("needs-you", "Setup needs you", ["5 ready", "1 needs you"]),
    out.banner("PRODUCTION", "Acme Production", "type its name to connect"),
    out.failure({ title: "Could not connect to Acme QA", why: "The gateway did not respond within 30s.", next: out.cmd("rt sdm connect acme:qa") }),
    out.verbatim(["connecting to acme-db-qa", "waiting for the gateway"], "what StrongDM printed"),
    out.changes([
      { op: "+", name: "review", hint: "now public" },
      { op: "-", name: "triage" },
    ]),
  ],
  wrap: () => [
    out.line("warn", "feature/login and origin/feature/login have diverged", "matching origin first"),
    out.line("done", "Saved a backup", "rt-backup/reset/feature/login/2026-09-30T10-00-00"),
    out.line("done", "Reset feature/login to origin/feature/login", "origin was rebased"),
    out.line("done", "Saved a backup", "rt-backup/rebase/feature/login/2026-09-30T10-00-00"),
    out.line("done", "Pushed"),
    out.verbatim(["The app's deck helper owns deck, and deck is not healthy, so rt did not run deck setup: it would add a second copy.", "If the helper is not registered: rt services register"]),
    out.verbatim(["    at run (/Users/sample/.mattstack/user/plugins/seam-fixture-with-a-long-name/boom.ts:1:41)"], "the stack"),
    out.verbatim(["QmFzZTY0".repeat(14)], "a token with no separator"),
  ],
  narrow: () => [
    out.table(
      [
        [out.key("rt.worktreeApp"), "true", out.dim("team example")],
        [out.key("rt.repoRoots"), "~/code, ~/work/clients/acme, ~/work/clients/globex", out.dim("machine")],
        { group: "USER" },
        [out.key("chat.humanHandle"), "sam", out.dim("your user settings, set on this Mac last week")],
      ],
      ["KEY", "VALUE", "FROM"],
    ),
    out.table([
      [out.strong("feature/a-very-long-branch-name-for-billing"), out.dim("sample-app"), "!42 open"],
      [out.strong("main"), out.dim("sample-app"), "clean"],
    ]),
    out.tree(out.key("rt.worktreeApp"), [["user", "a value that is long enough to wrap twice inside the tree"], ["team", "true"]]),
    out.diff([
      {
        header: "@@ -1,2 +1,2 @@",
        lines: [
          { kind: "context", text: "const a = 1;" },
          { kind: "del", text: "old(alpha, beta);" },
          { kind: "add", text: "next(alpha, beta, gamma, delta, epsilon, zeta, eta, theta);" },
        ],
      },
    ]),
    out.table([["名前", "日本語の 説明文が ここに 入ります とても 長い"]]),
  ],
  callouts: () => [
    out.line("refused", "You have uncommitted changes"),
    out.callout("why", "Syncing rewrites the branch, and a conflict would lose them."),
    out.callout("next", ["Commit them, or set them aside with ", out.cmd("rt git stash push")]),
    out.line("needs-you", "The rebase of feature/login onto origin/main is paused", "2 files to resolve"),
    out.callout("next", ["Fix the files, then run ", out.cmd("git add <files>"), " and ", out.cmd("git rebase --continue")]),
    out.callout(
      "note",
      ["To give up instead, run ", out.cmd("git rebase --abort")],
      ["Your branch as it was: ", out.cmd("rt-backup/rebase/feature/login/2026-09-30T10-00-00")],
      ["rt did not push. When the rebase is done, run ", out.cmd("git push --force-with-lease origin feature/login")],
    ),
    out.line("warn", "bun install did not finish", "editor types will be missing until it does"),
    out.callout("fix", ["Run ", out.cmd("bun install"), " in ", out.cmd("~/.mattstack/user/plugins/standup")]),
    out.failure({ title: "Which tool?", next: out.cmd("rt tools install <tool>") }),
  ],
  failures: () => [
    out.line("needs-you", "2 files have conflicts rt cannot resolve", "the rebase is paused"),
    out.verbatim(["src/app.ts", "README.md"], "files"),
    out.failure({ title: "The rebase stopped on conflicts in 2 files", why: "rt put the branch back the way it was.", details: "src/app.ts\nREADME.md\nA backup is at rt-backup/rebase/feature/login/2026-09-30T10-00-00" }),
    out.line("refused", "rt will not sync feature/stacked on its own"),
    out.callout("why", "feature/stacked is in stack login, so changing it on its own would break the stack"),
    out.callout("next", out.cmd("gitq sync --stack login")),
    out.failure({ title: "The agent did not finish in 10 minutes", why: "Nothing was pushed.", details: "Pane p7 is still open.\nA backup is at rt-backup/rebase/feature/login/2026-09-30T10-00-00" }),
    out.verbatim(["Resolving src/app.ts ...", "I am not sure which side should win here."], "the end of the pane"),
    out.failure({ title: "Could not connect to Acme QA", why: "The gateway did not respond within 30s." }),
    out.verbatim(["connecting to acme-db-qa", "waiting for the gateway"], "what StrongDM printed"),
    out.failure({ title: "Could not push feature/billing", details: "! [rejected] feature/billing -> feature/billing (stale info)" }),
    out.failure({ title: "Could not get access to Acme QA", why: "You do not have access to acme-db-qa.", next: "Check the connection name, or ask for access with a reason." }),
  ],
  kv: () => [
    out.kv("Tool", "gh"),
    out.kv("Bundled", "/Applications/mattstack.app/Contents/Helpers/gh"),
    out.kv("Your copy", "none on your PATH"),
    out.kv("Linked", "yes"),
    out.kv("Uses", "/Applications/mattstack.app/Contents/Helpers/gh"),
    out.line("refused", "You already have your own gh at /opt/homebrew/bin/gh"),
    out.callout("next", out.cmd("rt deps link gh --force")),
    out.kv("From", "~/code/sample-app/.claude/skills/review"),
    out.kv("To", "~/.claude/skills/review"),
    out.line("done", "Installed", "pnpm"),
    out.line("done", "Already current", "vite"),
    out.kv("Rules", "3"),
    out.kv("rt.worktreeApp", "true", "from team example"),
    out.kv("rt.repoRoots", "~/code, ~/work/clients/acme, ~/work/clients/globex, ~/work/clients/initech"),
  ],
  copy: () => [
    out.line("done", "Invited sam to the sample team"),
    out.copy("example://join?invite=abc123", "invite link"),
    out.copy("Hi sam, you are invited to the sample team.\nRun this in a terminal:\n  rt team join example://join?invite=abc123", "message to send"),
    out.line("skipped", "Would pull main from origin", "dry run"),
    out.copy("git pull --ff-only origin main", "the command"),
  ],
};

const name = process.argv[2] ?? "";
const make = sets[name];
if (!make) throw new Error(`no set ${name}: ${Object.keys(sets).join(", ")}`);
process.stdout.write(encodeLine({ t: "hello", protocol: 1 }) + make().map(encodeLine).join(""));
```

`<scratch>/5g/ansi-page.ts` (the 5f2 converter, plus a dashed line at the pane's right edge so a row that runs past it shows):

```ts
// usage: bun ansi-page.ts <dark|light> <title> <width> < in.ansi > page.html
const [mode, title, cols] = [process.argv[2] ?? "dark", process.argv[3] ?? "render", Number(process.argv[4] ?? 80)];
const page = mode === "light" ? { bg: "#FFFFFF", fg: "#1F1F1F", edge: "#BBBBBB" } : { bg: "#161224", fg: "#E6E0FF", edge: "#555066" };
const input = await new Response(Bun.stdin.stream()).text();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let html = "";
let open = false;
let style: Record<string, string> = {};
const flush = () => {
  if (open) html += "</span>";
  const css = Object.entries(style).map(([k, v]) => `${k}:${v}`).join(";");
  open = css !== "";
  if (open) html += `<span style="${css}">`;
};
const tokens = input.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "").split(/(\x1b\[[0-9;]*m)/);
for (const token of tokens) {
  const sgr = token.match(/^\x1b\[([0-9;]*)m$/);
  if (!sgr) {
    html += esc(token);
    continue;
  }
  const codes = sgr[1] === "" ? [0] : sgr[1]!.split(";").map(Number);
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]!;
    if (c === 0) style = {};
    else if (c === 1) style["font-weight"] = "bold";
    else if (c === 4) style["text-decoration"] = "underline";
    else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
      style[c === 38 ? "color" : "background"] = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
      i += 4;
    }
  }
  flush();
}
if (open) html += "</span>";
process.stdout.write(
  `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="margin:24px;background:${page.bg};color:${page.fg}"><pre style="font:14px/1.45 Menlo,monospace;width:${cols}ch;border-right:1px dashed ${page.edge};overflow:visible">${html}</pre></body>\n`,
);
```

`<scratch>/5g/render.sh`:

```sh
#!/bin/sh
# usage: sh render.sh <set> <width>   writes <set>-<width>-dark.html and <set>-<width>-light.html
set -e
here=$(dirname "$0")
bin="<repo>/ui/dist/rt-ui"
bun "$here/sets.ts" "$1" > "$here/$1.ndjson"
COLORTERM=truecolor TERM=xterm-256color "$bin" render --width "$2" < "$here/$1.ndjson" > "$here/$1-$2-dark.ansi"
COLORTERM=truecolor TERM=xterm-256color COLORFGBG="0;15" "$bin" render --width "$2" < "$here/$1.ndjson" > "$here/$1-$2-light.ansi"
bun "$here/ansi-page.ts" dark "$1 at $2" "$2" < "$here/$1-$2-dark.ansi" > "$here/$1-$2-dark.html"
bun "$here/ansi-page.ts" light "$1 at $2" "$2" < "$here/$1-$2-light.ansi" > "$here/$1-$2-light.html"
```

The light page sets `COLORFGBG=0;15`; with one palette that changes only the diff tints.

Render the "before" pages now, with the helper built in Step 1, so every later look can compare. From `<scratch>/5g/`, one at a time: `sh render.sh fixture 80`, `sh render.sh statuses 80`, `sh render.sh palette 100`, `sh render.sh wrap 90`, `sh render.sh wrap 60`, `sh render.sh narrow 48`, `sh render.sh narrow 30`, `sh render.sh callouts 100`, `sh render.sh callouts 60`, `sh render.sh failures 100`, `sh render.sh kv 100`, `sh render.sh kv 60`, `sh render.sh copy 100`. Then `mkdir <scratch>/5g/before` and copy every `*.html` into it.

Start the page server in the background for the rest of the plan: `python3 -m http.server 4173 --bind 127.0.0.1 --directory <scratch>/5g` (`file:` URLs are blocked in Fast Browser).

- [ ] **Step 4: Run the tests to see them fail**

Run: `go -C ui test ./internal/theme/ ./internal/render/ ./internal/steps/`
Expected: FAIL. `theme` does not compile (`undefined: StaticMint`, and the others). With `theme` failing, `render` and `steps` fail to build too; once Step 5's theme edit lands alone, `render` fails `TestEveryStatusGlyphUsesAStaticTone`, `TestKeysLabelsAndRailsUseStaticTones`, `TestOnlyFailedUsesCoral` (the failed line is not the new coral) and `TestTableRuleAndTreeBranchesUseTheStaticRuleTone`, and `steps` fails `TestStepTonesComeFromTheStaticPalette`.

- [ ] **Step 5: Add the static tones to the theme**

In `ui/internal/theme/theme.go`, replace the block that starts `// Static output lands on the terminal's own background` (lines 174 to 183) with:

```go
// Static output (rt-ui render and the steps verb) lands on the terminal's own
// background, which rt-ui never paints and cannot ask about, so it has one
// palette for both: every Static tone clears 3.5:1 on white and on Bg, and
// the two text tones, StaticLav and StaticQuiet, clear 4:1. The light tints
// are the diff tints for a terminal that says its background is light.
var (
	paper          = lipgloss.Color("#FFFFFF")
	DiffAddBgLight = blendToward(Mint, paper, diffTintBlend)
	DiffDelBgLight = blendToward(Coral, paper, diffTintBlend)

	StaticMint  = lipgloss.Color("#1A9461")
	StaticCoral = lipgloss.Color("#E0484E")
	StaticPeach = lipgloss.Color("#C4700F")
	StaticLav   = lipgloss.Color("#8A63D2")
	StaticCyan  = lipgloss.Color("#2E86DE")
	StaticQuiet = lipgloss.Color("#7F78A0")
	StaticRule  = lipgloss.Color("#736D96")
)
```

- [ ] **Step 6: Point the renderer and the step at them**

In `ui/internal/render/style.go`, replace the `statuses` map and the style block (lines 26 to 53) with:

```go
var statuses = map[string]statusDef{
	"done":      {theme.GlyphDone, theme.StaticMint},
	"failed":    {theme.GlyphCrashed, theme.StaticCoral},
	"needs-you": {"◆", theme.StaticPeach},
	"pending":   {"◌", theme.StaticQuiet},
	"stale":     {"↻", theme.StaticPeach},
	"refused":   {"⊘", theme.StaticQuiet},
	"off":       {theme.GlyphStopped, theme.StaticQuiet},
	"skipped":   {"-", theme.StaticQuiet},
	"running":   {theme.GlyphRunning, theme.StaticMint},
	"warn":      {"!", theme.StaticPeach},
}

func fg(c color.Color) lipgloss.Style { return lipgloss.NewStyle().Foreground(c) }

// Body text, titles and commands set no color: they take the terminal's own
// foreground, so they read on a light background as well as a dark one. Dim
// and faint are one tone: no second gray reads on both backgrounds.
var (
	textStyle    = lipgloss.NewStyle()
	strongStyle  = lipgloss.NewStyle().Bold(true)
	commandStyle = lipgloss.NewStyle().Bold(true)
	dimStyle     = fg(theme.StaticQuiet)
	faintStyle   = dimStyle
	keyStyle     = fg(theme.StaticLav)
	linkStyle    = fg(theme.StaticCyan).Underline(true)
	ruleStyle    = fg(theme.StaticRule)
	railStyle    = fg(theme.StaticRule)
)
```

Keep the comment above `statuses` ("Glyphs avoid Nerd Font code points...") as it is.

In `ui/internal/render/blocks_basic.go`:
- `calloutColor`: `theme.Peach` becomes `theme.StaticPeach`, `theme.Dimmer` becomes `theme.StaticQuiet`, `theme.Lav` becomes `theme.StaticLav`.
- `banner`: `fg(theme.Coral)` becomes `fg(theme.StaticCoral)`.
- `failure`: `r.calloutLines(theme.Dimmer, "why", ...)` becomes `theme.StaticQuiet`; `r.calloutLines(theme.Peach, "next", ...)` becomes `theme.StaticPeach`.

In `ui/internal/render/blocks_layout.go:92` (`changes`): `fg(theme.Mint)` becomes `fg(theme.StaticMint)`. Leave `blocks_text.go`'s `diff` alone: it keeps the mission view's tints.

In `ui/internal/steps/steps.go`, replace lines 38 to 45 of the `var` block with:

```go
	spinStyle = lipgloss.NewStyle().Foreground(theme.StaticMint)
	textStyle = lipgloss.NewStyle()
	hintStyle = lipgloss.NewStyle().Foreground(theme.StaticQuiet)
	subStyle  = lipgloss.NewStyle().Foreground(theme.StaticQuiet)
	railGlyph = lipgloss.NewStyle().Foreground(theme.StaticRule).Render("│")
	okGlyph   = render.Glyph("done")
	badGlyph  = render.Glyph("failed")
	infoGlyph = lipgloss.NewStyle().Foreground(theme.StaticQuiet).Render("•")
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `go -C ui vet ./...`
Run: `go -C ui test ./internal/theme/ ./internal/render/ ./internal/steps/ ./internal/protocol/`
Expected: PASS.
Run: `bun run ui:build`
Run: `bun test lib/ui/__tests__/protocol.test.ts lib/ui/__tests__/out-plain.test.ts`
Expected: PASS. The wire does not change in this task; the shared fixtures still pass from both languages.

- [ ] **Step 8: Render and look**

From `<scratch>/5g/`, one at a time: `sh render.sh fixture 80`, `sh render.sh statuses 80`, `sh render.sh palette 100`.

Screenshot each page with Fast Browser (the `fast-browser:browser-driver` agent, or the Fast Browser MCP tools directly) at `http://127.0.0.1:4173/<page>`, full page, and save:

| Page | Saved as |
|---|---|
| `fixture-80-dark.html`, `fixture-80-light.html` | `docs/design/output-layer/fixture-dark.png`, `fixture-light.png` (replacing them) |
| `statuses-80-dark.html`, `statuses-80-light.html` | `docs/design/output-layer/statuses-dark.png`, `statuses-light.png` (replacing them) |
| `palette-100-dark.html`, `palette-100-light.html` | `docs/design/output-layer/5g-palette-dark.png`, `5g-palette-light.png` |

Read each PNG next to its `before/` page and write down plainly what reads wrong. Check, on both backgrounds:

- **Light:** the pending, off, refused and skipped glyphs, every hint, the peach `next` and `fix` labels and bars, the warn and stale glyphs, the lavender kv keys, the green "connected" and "standing access" words and the link all read without squinting.
- **Dark:** idle and offline (the `pending` and `off` rows under "Who is here") read quieter than listening; tree branches, the table rule and the verbatim rail are visible, and quieter than text.
- **Both:** warn and stale read as orange, failed reads as red, and the two are never confused; body text is the page's own foreground; the banner is the only coral that is not a failure.

If idle and offline do not read quieter than listening on dark, set `StaticQuiet` to `#77729A` (4.5:1 on white, 4.1:1 on `Bg`, still above the test's 4:1), re-run Steps 7 and 8, and say so in the report. A fault found here is fixed in this task, re-rendered and named in the report. Do not declare success from the tests.

- [ ] **Step 9: Write it down**

In the spec, "Color roles": after the "Dim and faint" bullet add:

```markdown
- **One palette for both backgrounds.** Ruled 2026-10-01 (Matt). Static output (`rt-ui render` and the steps verb) draws these roles with the `Static*` tones in `ui/internal/theme`, each of which reads on a white and on a dark terminal, because rt-ui cannot ask which one it is on. Dim and faint share one tone there, since no second gray reads on both. The app views (pickers, mission, the board) paint their own background and keep their own palette.
```

In rule 7, replace "in the theme's `Panel` tone" with "in the `StaticRule` tone".

In `AGENTS.md` "Output layer", in the fifth rule ("**Body text takes the terminal's own foreground.**"), after "so output reads on a light terminal as well as a dark one." add: "Those accents come from the `Static*` tones in `ui/internal/theme`, one palette for both backgrounds; a new accent for static output is a new `Static*` tone that passes `TestStaticTonesReadOnALightAndADarkBackground`, never a branch on the background."

In `docs/design/output-layer/README.md`, append:

```markdown
## Phase 5g: renderer

One palette for both backgrounds: static output takes the `Static*` tones in `ui/internal/theme`, each of which reads on a white and on a dark terminal, so the light pages no longer differ from the dark ones except in the diff tints (still chosen from `COLORFGBG`). `fixture-*.png` and `statuses-*.png` above were regenerated in the new palette; every other page above this section predates it.

| File | What it shows |
|---|---|
| `5g-palette-dark.png`, `5g-palette-light.png` | every status, every callout label, chat's listening, idle and offline rows, sdm's connection words, a kv key, a tree, a link, the summary, the banner, a failure with its excerpt, and a changes block, at 100 columns |
```

- [ ] **Step 10: Commit**

```bash
git add ui/internal/theme/theme.go ui/internal/theme/theme_test.go ui/internal/render/style.go ui/internal/render/blocks_basic.go ui/internal/render/blocks_layout.go ui/internal/render/blocks_basic_test.go ui/internal/render/blocks_layout_test.go ui/internal/render/blocks_text_test.go ui/internal/steps/steps.go ui/internal/steps/steps_test.go docs/superpowers/specs/2026-09-30-rt-output-layer-design.md AGENTS.md docs/design/output-layer/README.md docs/design/output-layer/fixture-dark.png docs/design/output-layer/fixture-light.png docs/design/output-layer/statuses-dark.png docs/design/output-layer/statuses-light.png docs/design/output-layer/5g-palette-dark.png docs/design/output-layer/5g-palette-light.png
```

```bash
git commit -m "rt-ui: one palette for static output on light and dark terminals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Rows break at words, and a long ref breaks at a separator

Item 2. The mid-word breaks in the renders come from two places: `verbatim` cuts a row every N cells (`cutRows`), and a `line` hint whose column a longer title narrowed cuts a ref between characters. The live step's sub-lines are not one of them: they are cut with an ellipsis to one row each, because the step's erase counts rows, and that stays.

**Files:**
- Modify: `ui/internal/textwrap/textwrap.go:93-199` (`Options`, `SpansWith`, `wordRows`)
- Modify: `ui/internal/render/style.go` (`wrapCell`), `ui/internal/render/blocks_basic.go:15-67` (`lineRun`), `ui/internal/render/blocks_text.go:60-89` (`verbatim`, `cutRows`)
- Test: `ui/internal/textwrap/textwrap_test.go`, `ui/internal/render/blocks_basic_test.go`, `ui/internal/render/blocks_text_test.go`
- Modify: `AGENTS.md`, `docs/design/output-layer/README.md`
- Create: `docs/design/output-layer/5g-wrap-dark.png`, `5g-wrap-light.png`

**Interfaces:**
- Consumes: Task 1's tones and harness.
- Produces: `textwrap.Options{WordsOnly bool; Separators string}`. With `WordsOnly`, a word wider than the row breaks just after the last occurrence, in the row so far, of the first separator in `Separators` order that the row holds; a word holding none is cut between grapheme clusters as before. `render.wrapCell(c protocol.Cell, w int) []protocol.Cell` passes `separators = "/\\-_.:"`. `codeRows(s string, w int) []string` wraps one literal line at its words with a hanging indent. Task 3, 4 and 6 call `wrapCell` and get separator breaks for free.

- [ ] **Step 1: Write the failing tests**

In `ui/internal/textwrap/textwrap_test.go`, add:

```go
func wrapWords(s string, width int, seps string) []string {
	rows := SpansWith([]run{{text: s}}, width, Options{WordsOnly: true, Separators: seps}, runText, withText)
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = text(r)
	}
	return out
}

func TestAnOverlongWordBreaksAfterTheLastSeparatorThatFits(t *testing.T) {
	got := wrapWords("see rt-backup/reset/feature/login/2026-09-30T10-00-00", 20, "/-")
	want := []string{"see", "rt-backup/reset/", "feature/login/", "2026-09-30T10-00-00"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestSeparatorsAreTriedInTheirOrder(t *testing.T) {
	if got, want := wrapWords("alpha-beta/gamma-delta", 12, "/-"), []string{"alpha-beta/", "gamma-delta"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("slash first: got %q want %q", got, want)
	}
	if got, want := wrapWords("alpha-beta/gamma-delta", 12, "-/"), []string{"alpha-", "beta/gamma-", "delta"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("dash first: got %q want %q", got, want)
	}
}

func TestAWordThatFitsIsNeverBrokenAtASeparator(t *testing.T) {
	if got, want := wrapWords("a feature/login b", 14, "/"), []string{"a", "feature/login", "b"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestAnOverlongWordWithNoSeparatorIsStillCutBetweenCharacters(t *testing.T) {
	if got, want := wrapWords("abcdefghijklmnop", 6, "/"), []string{"abcdef", "ghijkl", "mnop"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}
```

`text(r)` and `reflect` are already in the file.

In `ui/internal/render/blocks_basic_test.go`, add:

```go
func TestAHintTooLongForItsColumnDropsBelowItsTitleWhole(t *testing.T) {
	got := plainAt(90,
		protocol.Block{T: "line", Status: "done", Title: "Reset feature/login to origin/feature/login", Hint: "origin was rebased"},
		protocol.Block{T: "line", Status: "done", Title: "Saved a backup", Hint: "rt-backup/reset/feature/login/2026-09-30T10-00-00"},
	)
	want := "  ✓ Reset feature/login to origin/feature/login  origin was rebased\n" +
		"  ✓ Saved a backup\n" +
		"    rt-backup/reset/feature/login/2026-09-30T10-00-00\n"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}

func TestAHintDroppedBelowItsTitleIsStillCleaned(t *testing.T) {
	out := render.Render([]protocol.Block{
		{T: "line", Status: "done", Title: "Reset feature/login to origin/feature/login", Hint: "origin was rebased"},
		{T: "line", Status: "done", Title: "Saved a backup", Hint: "rt-backup/reset/feature/login/2026-09-30T10-00-00\x1b[2J\n[ok] forged"},
	}, render.Options{Width: 90})
	if strings.Contains(out, "\x1b[2J") {
		t.Fatalf("an escape survived: %q", out)
	}
	if !strings.Contains(ansi.Strip(out), "    rt-backup/reset/feature/login/2026-09-30T10-00-00 [ok] forged\n") {
		t.Fatalf("the forged row left its line:\n%s", ansi.Strip(out))
	}
}
```

In `ui/internal/render/blocks_text_test.go`, replace `TestALongVerbatimLineIsCutWithTheRailOnEveryRow` with:

```go
func TestAVerbatimLineWrapsAtItsWordsWithTheRailOnEveryRow(t *testing.T) {
	got := plainAt(40, protocol.Block{T: "verbatim", Lines: []string{"The app's deck helper owns deck, so rt did not run deck setup: it would add a second copy."}})
	want := "    │ The app's deck helper owns deck,\n" +
		"    │ so rt did not run deck setup: it\n" +
		"    │ would add a second copy.\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestALongVerbatimLineHangsUnderItsOwnIndentAndBreaksAPathAtASlash(t *testing.T) {
	line := "    at run (/Users/sample/.mattstack/user/plugins/seam-fixture-with-a-long-name/boom.ts:1:41)"
	got := plainAt(60, protocol.Block{T: "verbatim", Lines: []string{line}})
	want := "    │     at run\n" +
		"    │     (/Users/sample/.mattstack/user/plugins/\n" +
		"    │     seam-fixture-with-a-long-name/boom.ts:1:41)\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestAVerbatimTokenWithNoSeparatorIsCutAndKeepsEveryCharacter(t *testing.T) {
	blob := strings.Repeat("QmFzZTY0", 12)
	got := plainAt(40, protocol.Block{T: "verbatim", Lines: []string{blob}})
	checkWidth(t, got, 40)
	var joined strings.Builder
	for _, r := range rows(got) {
		if !strings.HasPrefix(r, "    │ ") {
			t.Fatalf("a row lost its rail: %q", r)
		}
		joined.WriteString(strings.TrimPrefix(r, "    │ "))
	}
	if joined.String() != blob {
		t.Fatalf("characters lost: %q", joined.String())
	}
}
```

`plainAt`, `rows` and `checkWidth` live in `blocks_basic_test.go`, the same package.

- [ ] **Step 2: Run the tests to see them fail**

Run: `go -C ui test ./internal/textwrap/ ./internal/render/`
Expected: FAIL. `textwrap` does not compile (`unknown field Separators in struct literal`). Once it does, `render` fails: the backup ref is cut at column 41 ("rt-backup/reset/feature/login/2026-09-30T" then "10-00-00"), and the verbatim rows are cut every 34 or 54 cells mid-word.

- [ ] **Step 3: Separators in `textwrap`**

In `ui/internal/textwrap/textwrap.go`, replace the `Options` type with:

```go
// Options changes where a line may break. The zero value is Spans.
type Options struct {
	// WordsOnly breaks at whitespace and nowhere else: a hyphen is not a
	// break point, so a flag or a branch name stays whole, and a word wider
	// than the row is cut between grapheme clusters, so a combining mark
	// never starts a row without its base.
	WordsOnly bool
	// Separators, with WordsOnly, are where a word wider than the row may
	// break first: just after the last occurrence, in the row so far, of the
	// first of them, in this order, that the row holds.
	Separators string
}
```

In `SpansWith`, change `bounds := wordRows(plain, width)` to `bounds := wordRows(plain, width, opts.Separators)`.

Replace `wordRows` (from its comment to the end of the file) with:

```go
// wordRows returns the byte range of every row. The whitespace a row breaks
// at belongs to no row; indentation before the first word stays on its row.
func wordRows(s string, width int, seps string) [][2]int {
	var rows [][2]int
	start, end, used := -1, 0, 0
	flush := func() {
		if start >= 0 {
			rows = append(rows, [2]int{start, end})
		}
		start, used = -1, 0
	}
	gap := piece{}
	for _, p := range pieces(s) {
		if p.space {
			gap = p
			continue
		}
		lead := gap
		gap = piece{}
		switch {
		case start >= 0 && used+lead.width+p.width <= width:
			end, used = p.to, used+lead.width+p.width
			continue
		case start < 0 && len(rows) == 0 && lead.width > 0 && lead.width+p.width <= width:
			start, end, used = lead.from, p.to, lead.width+p.width
			continue
		}
		flush()
		if p.width <= width {
			start, end, used = p.from, p.to, p.width
			continue
		}
		for i := p.from; i < p.to; {
			cluster, w := ansi.FirstGraphemeCluster(s[i:p.to], ansi.GraphemeWidth)
			if cluster == "" {
				break
			}
			for start >= 0 && used+w > width {
				k := breakAfter(s[start:end], seps)
				if k == 0 {
					flush()
					break
				}
				rows = append(rows, [2]int{start, start + k})
				start += k
				used = ansi.StringWidth(s[start:end])
				if start == end {
					start, used = -1, 0
				}
			}
			if start < 0 {
				start = i
			}
			i += len(cluster)
			end, used = i, used+w
		}
	}
	flush()
	return rows
}

// breakAfter returns the byte offset just past the last occurrence in row of
// the first of seps that row holds, or 0 when it holds none.
func breakAfter(row, seps string) int {
	for _, sep := range seps {
		if i := strings.LastIndex(row, string(sep)); i >= 0 {
			return i + utf8.RuneLen(sep)
		}
	}
	return 0
}
```

The row a separator search looks at only ever holds the overlong word: the `flush()` before the loop closes any row a previous word left open.

- [ ] **Step 4: `wrapCell` breaks at separators; a hint that will not fit its column drops below**

In `ui/internal/render/style.go`, above `wrapCell`, add:

```go
// separators are where a word too wide for its row breaks, tried in order:
// a path or a ref breaks at a slash before a dash.
const separators = "/\\-_.:"
```

and in `wrapCell` change the `SpansWith` call to:

```go
	rows := textwrap.SpansWith(clean, w, textwrap.Options{WordsOnly: true, Separators: separators}, segText, withSegText)
```

In `ui/internal/render/blocks_basic.go`, replace `lineRun`'s doc comment and its aligned branch. The function becomes:

```go
// lineRun renders consecutive lines, with any callouts between them, and
// pads hinted titles to one width so the hints line up. A hint wraps inside
// its own column. A hint holding a word wider than that column takes the
// row below its title, whole, so a ref or a path is never cut; a title too
// wide to leave the hint a column worth wrapping into does the same and
// stays out of the alignment.
func (r *renderer) lineRun(run []protocol.Block) {
	textW := r.width - len(calloutIndent)
	titleCap := textW - 2 - minWrap
	w := 0
	for _, b := range run {
		if b.T != "line" || b.Hint == "" {
			continue
		}
		if tw := lipgloss.Width(Clean(b.Title)); tw <= titleCap {
			w = max(w, tw)
		}
	}
	for _, b := range run {
		if b.T == "callout" {
			r.callout(b)
			continue
		}
		head := indent + glyph(b.Status) + " "
		titleW := lipgloss.Width(Clean(b.Title))
		hint := protocol.Cell{{Text: b.Hint, Role: "faint"}}
		if b.Hint != "" && titleW <= titleCap {
			if longestWord(Clean(b.Hint)) > textW-w-2 {
				r.emit(head + textStyle.Render(Clean(b.Title)))
				for _, row := range wrapCell(hint, textW) {
					r.emit(calloutIndent + cell(row))
				}
				continue
			}
			for i, row := range wrapCell(hint, textW-w-2) {
				if i == 0 {
					r.emit(head + textStyle.Render(pad(Clean(b.Title), w)) + "  " + cell(row))
					continue
				}
				r.emit(calloutIndent + strings.Repeat(" ", w+2) + cell(row))
			}
			continue
		}
		title := wrapCell(protocol.Cell{{Text: b.Title}}, textW)
		inline := b.Hint != "" && len(title) == 1 && titleW+2+lipgloss.Width(Clean(b.Hint)) <= textW
		for i, row := range title {
			s := calloutIndent + cell(row)
			if i == 0 {
				s = head + cell(row)
			}
			if inline {
				s += "  " + cell(hint)
			}
			r.emit(s)
		}
		if b.Hint != "" && !inline {
			for _, row := range wrapCell(hint, textW) {
				r.emit(calloutIndent + cell(row))
			}
		}
	}
}

func longestWord(s string) int {
	n := 0
	for _, word := range strings.Fields(s) {
		n = max(n, lipgloss.Width(word))
	}
	return n
}
```

- [ ] **Step 5: `verbatim` wraps at words**

In `ui/internal/render/blocks_text.go`, add `"rt-ui/internal/textwrap"` to the imports, and replace `verbatim` and `cutRows` with:

```go
func (r *renderer) verbatim(b protocol.Block) {
	r.caption(b.Caption)
	rail := calloutIndent + railStyle.Render("│") + " "
	w := r.width - lipgloss.Width(rail)
	for _, line := range b.Lines {
		for _, l := range splitLines(line) {
			for _, row := range codeRows(cleanCode(l), w) {
				r.emit(rail + dimStyle.Render(row))
			}
		}
	}
}

// codeRows wraps a literal line at its spaces, and a word too wide for the
// row at a separator, and hangs every row under the line's own indent. Only
// the spaces at a break are dropped, so the end of a stack line still
// carries its file and line number.
func codeRows(s string, w int) []string {
	if w < minWrap || ansi.StringWidth(s) <= w {
		return []string{s}
	}
	lead, rest := hangingIndent(s, w)
	same := func(t string) string { return t }
	with := func(_, t string) string { return t }
	rows := textwrap.SpansWith([]string{rest}, w-len(lead), textwrap.Options{WordsOnly: true, Separators: separators}, same, with)
	out := make([]string, len(rows))
	for i, row := range rows {
		out[i] = lead + strings.Join(row, "")
	}
	return out
}
```

`ansi` stays imported (`codeRows` uses it); `cutRows` is gone, and nothing else called it.

- [ ] **Step 6: Run the tests to see them pass**

Run: `go -C ui vet ./...`
Run: `go -C ui test ./...`
Expected: PASS, including every earlier wrap test (`TestLineHintWrapsInsideItsOwnColumn`, `TestATitleTooWideForAHintColumnTakesItsHintBelow`, `TestAVeryNarrowPaneLosesNoText`, `TestWrappedTextNeverBreaksAFlagAtItsHyphens`, `TestVerbatimKeepsIndentationAndExpandsTabs`) and the mission diff wrap tests, which call `Spans` and never see `Separators`.
Run: `bun run ui:build`
Run: `bun test lib/ui/__tests__/protocol.test.ts lib/ui/__tests__/out-plain.test.ts`
Expected: PASS. No wire change.

- [ ] **Step 7: Render and look**

From `<scratch>/5g/`: `sh render.sh wrap 90`, then `sh render.sh wrap 60`. Screenshot all four pages and save `wrap-60-dark.html` and `wrap-60-light.html` as `docs/design/output-layer/5g-wrap-dark.png` and `5g-wrap-light.png`.

Check, on both backgrounds and both widths, against `before/`:

- No row breaks inside a word. Each backup ref reads whole: in its hint column when it fits, on the row under "Saved a backup" when it does not, and broken only after a `/` when even that row is too narrow.
- The deck helper excerpt breaks between words ("it would add a second copy" stays readable).
- The stack line's continuation rows hang under "at", and its path breaks after a slash, never inside `seam-fixture`.
- The base64 token is cut, but every row sits inside the dashed pane edge and keeps its rail.
- A dropped hint reads as belonging to the line above it, not as a new row.

A fault found here is fixed in this task, re-rendered and named in the report.

- [ ] **Step 8: Write it down**

In `AGENTS.md` "Output layer", replace the sentence "Wrapped text breaks at spaces only, so a flag or a branch name is never split at a hyphen;" with: "Wrapped text breaks at spaces, so a flag or a branch name that fits its row is never split at a hyphen; a word wider than its row breaks after its last `/` that fits (then `\`, `-`, `_`, `.`, `:`), and only a word with none is cut between characters. A `line` hint with a word too wide for its column takes the row under its title, whole. `verbatim` wraps the same way;"

In `docs/design/output-layer/README.md`, append to the 5g table:

```markdown
| `5g-wrap-dark.png`, `5g-wrap-light.png` | 60 columns: backup refs in a hint column a longer title narrowed (whole on the row below), an excerpt that wraps at its words, a stack line that hangs under its indent and breaks its path at a slash, and a token with no separator, cut inside the pane |
```

- [ ] **Step 9: Commit**

```bash
git add ui/internal/textwrap/textwrap.go ui/internal/textwrap/textwrap_test.go ui/internal/render/style.go ui/internal/render/blocks_basic.go ui/internal/render/blocks_text.go ui/internal/render/blocks_basic_test.go ui/internal/render/blocks_text_test.go AGENTS.md docs/design/output-layer/README.md docs/design/output-layer/5g-wrap-dark.png docs/design/output-layer/5g-wrap-light.png
```

```bash
git commit -m "rt-ui render: break rows at words and long refs at a separator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tables, trees and diffs stay inside a narrow pane

Item 3. Clipping goes through one shared clipper: mission's `clip`/`clipOn` are lifted to `ui/internal/textwrap` (AGENTS.md "Shared rt-ui primitives"), and mission and the board delegate to it.

**Files:**
- Create: `ui/internal/textwrap/clip.go`, `ui/internal/textwrap/clip_test.go`
- Modify: `ui/internal/views/mission/topbar.go:398-432`, `ui/internal/views/board/render.go:300-310`
- Modify: `ui/internal/render/blocks_layout.go:12-72` (whole table and tree code), `ui/internal/render/style.go:180-194` (`joinCells` removed), `ui/internal/render/blocks_text.go` (`diff`)
- Test: `ui/internal/render/blocks_layout_test.go`, `ui/internal/render/blocks_text_test.go`
- Modify: `docs/design/output-layer/README.md`
- Create: `docs/design/output-layer/5g-narrow-dark.png`, `5g-narrow-light.png`

**Interfaces:**
- Consumes: `wrapCell` with separators (Task 2); `faintStyle`, `ruleStyle` (Task 1).
- Produces: `textwrap.Clip(s string, w int) string` and `textwrap.ClipOn(s string, w int, on lipgloss.Style) string`, with mission's semantics (a non-positive `w` gives `""`, a one-cell window gives the ellipsis alone, a cut ends in `…`). In `render`: `fitColumns(widths []int, avail int) []int`, `rowLines(row []protocol.Cell, widths []int, avail int) []string`, `fitLine(s string, avail int) string`, `const clipFloor = 8`. Task 6 does not use them.

- [ ] **Step 1: Write the failing tests**

Create `ui/internal/textwrap/clip_test.go`:

```go
package textwrap

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

func TestClipFitsAStringAndMarksTheCut(t *testing.T) {
	for _, c := range []struct {
		in   string
		w    int
		want string
	}{
		{"hello world", 6, "hello…"},
		{"hello", 1, "…"},
		{"hello", 0, ""},
		{"hi", 5, "hi"},
		{"日本語", 4, "日…"},
	} {
		if got := ansi.Strip(Clip(c.in, c.w)); got != c.want {
			t.Errorf("Clip(%q, %d) = %q, want %q", c.in, c.w, got, c.want)
		}
	}
}

func TestClipOnPaintsTheEllipsisAfterAStyledCut(t *testing.T) {
	on := lipgloss.NewStyle().Foreground(lipgloss.Color("#7F78A0"))
	got := ClipOn(lipgloss.NewStyle().Bold(true).Render("hello world"), 6, on)
	if ansi.Strip(got) != "hello…" || !strings.Contains(got, "38;2;127;120;160m…") {
		t.Fatalf("got %q", got)
	}
}
```

In `ui/internal/render/blocks_layout_test.go`, add (`plainAt`, `rows`, `checkWidth` and `noSpace` live in `blocks_basic_test.go`):

```go
func TestATableLastColumnWrapsInsideItsColumnOnANarrowPane(t *testing.T) {
	got := plainAt(40, protocol.Block{T: "table", Headers: []string{"KEY", "VALUE"}, Rows: []protocol.TableRow{
		cells("rt.worktreeApp", "a value that is long enough to wrap twice"),
	}})
	want := fmt.Sprintf("  %-14s  %s\n", "KEY", "VALUE") +
		"  " + strings.Repeat("─", 38) + "\n" +
		fmt.Sprintf("  %-14s  %s\n", "rt.worktreeApp", "a value that is long") +
		strings.Repeat(" ", 18) + "enough to wrap twice\n"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	checkWidth(t, got, 40)
}

func TestATableClipsALeadingColumnWhenTheLastHasNoRoom(t *testing.T) {
	got := plainAt(30, protocol.Block{T: "table", Rows: []protocol.TableRow{cells("feature/a-very-long-branch-name", "ok")}})
	if got != "  feature/a-very-long-bra…  ok\n" {
		t.Fatalf("got %q", got)
	}
	checkWidth(t, got, 30)
}

func TestATableOnTheNarrowestPaneStaysInsideIt(t *testing.T) {
	got := plainAt(20, protocol.Block{T: "table", Headers: []string{"BRANCH", "REPO", "STATE"}, Rows: []protocol.TableRow{
		{Group: "a group label that is much wider than the pane"},
		cells("feature/billing-export", "sample-app", "open, waiting on review"),
	}})
	checkWidth(t, got, 20)
	if !strings.Contains(got, "…") {
		t.Fatalf("nothing was clipped:\n%s", got)
	}
}

func TestAWideCharacterCellWrapsByDisplayWidth(t *testing.T) {
	got := plainAt(30, protocol.Block{T: "table", Rows: []protocol.TableRow{cells("名前", "日本語の 説明文が ここに 入ります とても 長い")}})
	checkWidth(t, got, 30)
	if len(rows(got)) < 2 || strings.Join(strings.Fields(got), "") != "名前日本語の説明文がここに入りますとても長い" {
		t.Fatalf("the wide cell did not wrap whole:\n%s", got)
	}
}

func TestATreeLastColumnWrapsUnderItsBranch(t *testing.T) {
	got := plainAt(40, protocol.Block{T: "tree", Root: text("rt.worktreeApp"), Children: [][]protocol.Cell{
		{text("user"), text("a value that is long enough to wrap twice")},
		{text("team"), text("short")},
	}})
	want := "  rt.worktreeApp\n" +
		"  ├── user  a value that is long enough\n" +
		"  │" + strings.Repeat(" ", 9) + "to wrap twice\n" +
		"  ╰── team  short\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}
```

In `ui/internal/render/blocks_text_test.go`, add:

```go
func TestALongDiffLineWrapsInsideThePane(t *testing.T) {
	long := "next(alpha, beta, gamma, delta, epsilon, zeta);"
	got := plainAt(30, protocol.Block{T: "diff", Hunks: []protocol.DiffHunk{{Header: "@@ -1 +1 @@", Lines: []protocol.DiffLine{
		{Kind: "del", Text: "old();"},
		{Kind: "add", Text: long},
	}}}})
	checkWidth(t, got, 30)
	rs := rows(got)
	if len(rs) < 4 || !strings.HasPrefix(rs[2], "   + next(") || !strings.HasPrefix(rs[3], "     ") {
		t.Fatalf("the added line did not wrap under its sign:\n%s", got)
	}
	if noSpace(strings.Join(rs[2:], "")) != "+"+noSpace(long) {
		t.Fatalf("the added line lost text:\n%s", got)
	}
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `go -C ui test ./internal/textwrap/ ./internal/render/`
Expected: FAIL. `textwrap` does not compile (`undefined: Clip`). Once it does, the table tests fail with rows wider than the pane (the table never measures the pane), the tree's last cell runs on one row, and the diff's added line is one 52-cell row.

- [ ] **Step 3: Lift the clipper**

Create `ui/internal/textwrap/clip.go`:

```go
package textwrap

import "charm.land/lipgloss/v2"

// Clip fits s, plain or styled, into w cells, ending a cut with a bare
// ellipsis.
func Clip(s string, w int) string { return clip(s, w, "…") }

// ClipOn is Clip with the ellipsis painted in on: a cut styled string ends on
// a reset, and a bare ellipsis after it would take the terminal's default
// instead of the row's own style.
func ClipOn(s string, w int, on lipgloss.Style) string { return clip(s, w, on.Render("…")) }

// clip short-circuits a window of one cell or none: MaxWidth(0) does not
// truncate.
func clip(s string, w int, ellipsis string) string {
	if w <= 0 {
		return ""
	}
	if lipgloss.Width(s) > w {
		if w == 1 {
			return ellipsis
		}
		return lipgloss.NewStyle().Inline(true).MaxWidth(w-1).Render(s) + ellipsis
	}
	return lipgloss.NewStyle().Inline(true).MaxWidth(w).Render(s)
}
```

These are mission's `clip` and `clipOn` byte for byte, so mission's own tests pass unchanged.

In `ui/internal/views/mission/topbar.go`, replace `clip` and `clipOn`, doc comments included (their reasoning now lives on the lifted copy), with:

```go
// clip is textwrap.Clip, the one text clipper rt-ui has.
func clip(s string, w int) string { return textwrap.Clip(s, w) }

// clipOn is textwrap.ClipOn.
func clipOn(s string, w int, on lipgloss.Style) string { return textwrap.ClipOn(s, w, on) }
```

Add `"rt-ui/internal/textwrap"` to the file's imports if it is not there.

In `ui/internal/views/board/render.go`, replace `clip` (lines 300 to 310) with:

```go
// clip is textwrap.Clip, the one text clipper rt-ui has.
func clip(s string, w int) string { return textwrap.Clip(s, w) }
```

and add the import. The board's copy returned `s` whole for a window under one cell, where the lifted one returns `""`. Run `go -C ui test ./internal/views/board/ ./internal/views/mission/`. If a board test fails only because a zero-width column now prints nothing, keep the board's old edge in front of the delegation (`if w < 1 { return lipgloss.NewStyle().Inline(true).Render(s) }`) and name it in the report; do not change the lifted copy.

- [ ] **Step 4: Tables and trees fit the pane**

Replace `ui/internal/render/blocks_layout.go` lines 1 to 72 (the imports, `renderRows`, `table` and `tree`; `section` and `changes` stay) with:

```go
package render

import (
	"strings"

	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/textwrap"
	"rt-ui/internal/theme"
)

// clipFloor is the narrowest a leading column is clipped to, so the last
// column keeps room to wrap.
const clipFloor = 8

func measure(rows [][]protocol.Cell, widths []int) {
	for _, row := range rows {
		for ci, c := range row {
			widths[ci] = max(widths[ci], lipgloss.Width(cell(c)))
		}
	}
}

// fitColumns shrinks widths to avail cells. The last column takes what the
// others leave it; while that is less than it needs (its own width, capped
// at minWrap), the widest other column is clipped, never below clipFloor.
func fitColumns(widths []int, avail int) []int {
	out := append([]int(nil), widths...)
	n := len(out)
	if n == 0 {
		return out
	}
	others := func() int {
		t := 2 * (n - 1)
		for _, w := range out[:n-1] {
			t += w
		}
		return t
	}
	need := min(out[n-1], minWrap)
	for n > 1 && avail-others() < need {
		i := 0
		for j, w := range out[:n-1] {
			if w > out[i] {
				i = j
			}
		}
		if out[i] <= clipFloor {
			break
		}
		out[i] = max(clipFloor, out[i]-(need-(avail-others())))
	}
	out[n-1] = max(1, min(out[n-1], avail-others()))
	return out
}

// fitLine clips a laid-out row that the floors still left wider than avail.
func fitLine(s string, avail int) string {
	if lipgloss.Width(s) <= avail {
		return s
	}
	return textwrap.ClipOn(s, avail, faintStyle)
}

// rowLines lays one row into its columns. A leading cell wider than its
// column is clipped; the row's last cell wraps at its words in the room the
// others leave, or is clipped when that room is too narrow to wrap into.
// Rows after the first start under the last cell.
func rowLines(row []protocol.Cell, widths []int, avail int) []string {
	if len(row) == 0 {
		return []string{""}
	}
	k := len(row) - 1
	var head strings.Builder
	for i, c := range row[:k] {
		s := cell(c)
		if lipgloss.Width(s) > widths[i] {
			s = textwrap.ClipOn(s, widths[i], faintStyle)
		}
		head.WriteString(pad(s, widths[i]) + "  ")
	}
	lead := head.String()
	room := avail - lipgloss.Width(lead)
	last := cell(row[k])
	var parts []string
	switch {
	case lipgloss.Width(last) <= room:
		parts = []string{last}
	case room >= minWrap:
		for _, r := range wrapCell(row[k], room) {
			parts = append(parts, cell(r))
		}
	default:
		parts = []string{textwrap.ClipOn(last, max(1, room), faintStyle)}
	}
	out := make([]string, len(parts))
	for i, p := range parts {
		if i == 0 {
			out[i] = fitLine(lead+p, avail)
			continue
		}
		out[i] = strings.Repeat(" ", lipgloss.Width(lead)) + p
	}
	return out
}

func (r *renderer) table(b protocol.Block) {
	cols := len(b.Headers)
	rows := make([][]protocol.Cell, len(b.Rows))
	for i, row := range b.Rows {
		rows[i] = row.Cells
		cols = max(cols, len(row.Cells))
	}
	header := make([]protocol.Cell, len(b.Headers))
	for i, h := range b.Headers {
		header[i] = protocol.Cell{{Text: h, Role: "faint"}}
	}
	widths := make([]int, cols)
	measure(append([][]protocol.Cell{header}, rows...), widths)
	avail := r.width - len(indent)
	widths = fitColumns(widths, avail)

	if len(header) > 0 {
		for _, l := range rowLines(header, widths, avail) {
			r.emit(indent + l)
		}
		total := 2 * (cols - 1)
		for _, w := range widths {
			total += w
		}
		r.emit(indent + ruleStyle.Render(strings.Repeat("─", min(total, avail))))
	}
	for _, row := range b.Rows {
		if row.Group != "" {
			r.emit(indent + fitLine(faintStyle.Render(Clean(row.Group)), avail))
			continue
		}
		for _, l := range rowLines(row.Cells, widths, avail) {
			r.emit(indent + l)
		}
	}
}

func (r *renderer) tree(b protocol.Block) {
	avail := r.width - len(indent)
	for _, row := range wrapCell(b.Root, avail) {
		r.emit(indent + cell(row))
	}
	cols := 0
	for _, child := range b.Children {
		cols = max(cols, len(child))
	}
	widths := make([]int, cols)
	measure(b.Children, widths)
	widths = fitColumns(widths, avail-4)
	for i, child := range b.Children {
		branch, cont := "├── ", "│   "
		if i == len(b.Children)-1 {
			branch, cont = "╰── ", "    "
		}
		for j, l := range rowLines(child, widths, avail-4) {
			p := branch
			if j > 0 {
				p = cont
			}
			r.emit(indent + ruleStyle.Render(p) + l)
		}
	}
}
```

In `ui/internal/render/style.go`, delete `joinCells` (lines 180 to 194): nothing calls it now. If `theme` becomes unused in `blocks_layout.go` after Task 1 (it is still used by `changes`), leave the import.

- [ ] **Step 5: A long diff line wraps**

In `ui/internal/render/blocks_text.go`, replace the `for _, h := range b.Hunks` loop in `diff` with:

```go
	avail := r.width - len(indent)
	for _, h := range b.Hunks {
		r.emit(indent + keyStyle.Render(Clean(h.Header)))
		w := 0
		for _, l := range h.Lines {
			w = max(w, lipgloss.Width(cleanCode(l.Text)))
		}
		w = min(w+3, avail)
		for _, l := range h.Lines {
			sign, band := "   ", textStyle
			switch l.Kind {
			case "add":
				sign, band = " + ", add
			case "del":
				sign, band = " - ", del
			}
			for i, row := range diffRows(cleanCode(l.Text), w-3) {
				s := sign
				if i > 0 {
					s = "   "
				}
				if l.Kind == "add" || l.Kind == "del" {
					r.emit(indent + band.Render(pad(s+row, w)))
				} else {
					r.emit(indent + band.Render(s+row))
				}
			}
		}
	}
```

and add below `diff`:

```go
// diffRows wraps a line of code as the mission diff does, at spaces and
// hyphens, so a band never runs past the pane.
func diffRows(s string, w int) []string {
	if w < minWrap {
		return []string{s}
	}
	same := func(t string) string { return t }
	with := func(_, t string) string { return t }
	rows := textwrap.Spans([]string{s}, w, same, with)
	out := make([]string, len(rows))
	for i, row := range rows {
		out[i] = strings.Join(row, "")
	}
	return out
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `go -C ui vet ./...`
Run: `go -C ui test ./...`
Expected: PASS, including every earlier table, tree and diff test (a table that fits prints the same rows it did) and the mission and board suites.
Run: `bun run ui:build`
Run: `bun test lib/ui/__tests__/protocol.test.ts lib/ui/__tests__/out-plain.test.ts`
Expected: PASS. No wire change.

- [ ] **Step 7: Render and look**

From `<scratch>/5g/`: `sh render.sh narrow 48`, then `sh render.sh narrow 30`. Screenshot all four pages and save `narrow-48-dark.html` and `narrow-48-light.html` as `docs/design/output-layer/5g-narrow-dark.png` and `5g-narrow-light.png`.

Check, on both backgrounds and both widths, against `before/`:

- No row crosses the dashed pane edge: the settings table, the branch table, the tree, the diff and the CJK table.
- A wrapped value sits under its own column, and the rows under it read as the same row, not a new one with an empty key.
- A clipped branch name ends in a faint `…` and still reads as a branch; the clip happens in the leading column only when the last one would otherwise have no room.
- The tree's continuation rows keep the `│` under a middle child and nothing under the last one.
- The diff's wrapped rows keep their band to the same right edge as the rest of the hunk; the continuation rows carry no `+` or `-`.
- The table rule is never longer than the pane.

A fault found here is fixed in this task, re-rendered and named in the report.

- [ ] **Step 8: Write it down**

In `docs/design/output-layer/README.md`, append to the 5g table:

```markdown
| `5g-narrow-dark.png`, `5g-narrow-light.png` | 48 columns: a settings table whose values wrap in their column, a branch table whose long name is clipped so the state keeps its room, a tree whose last column wraps under its branch, a diff whose long added line wraps inside its band, and a CJK cell wrapped by display width |
```

In `docs/design/output-layer/README.md`, the paragraph that starts "Still wrong at the time of these renders: the last column of a table or a tree" stays as history; add at its end: "Phase 5g fixed the last column and the callout command; see `5g-narrow-*.png` and `5g-callouts-*.png`."

- [ ] **Step 9: Commit**

```bash
git add ui/internal/textwrap/clip.go ui/internal/textwrap/clip_test.go ui/internal/views/mission/topbar.go ui/internal/views/board/render.go ui/internal/render/blocks_layout.go ui/internal/render/style.go ui/internal/render/blocks_text.go ui/internal/render/blocks_layout_test.go ui/internal/render/blocks_text_test.go docs/design/output-layer/README.md docs/design/output-layer/5g-narrow-dark.png docs/design/output-layer/5g-narrow-light.png
```

```bash
git commit -m "rt-ui render: fit tables, trees and diffs to a narrow pane

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: A command that ends a callout's sentence takes its own row

Item 4. The shape (the plan's decision 4): a body row that is only a command stays whole, as today; a row whose one command is its last segment prints its prose on the label row and the command, bold, on the row below at the body column; any other mixed row wraps at its spaces and never splits a command. Today a row holding a command is never wrapped at all, so a sentence with a command runs past a narrow pane. The plain renderer does not change: off a terminal the callout stays one `next: ...` line an agent reads whole.

**Files:**
- Modify: `ui/internal/render/blocks_basic.go:79-104` (`callout`, `calloutLines`), plus new helpers
- Test: `ui/internal/render/blocks_basic_test.go`
- Modify: `AGENTS.md`, `docs/design/output-layer/README.md`
- Create: `docs/design/output-layer/5g-callouts-dark.png`, `5g-callouts-light.png`

**Interfaces:**
- Consumes: `wrapCell` (Task 2), `hasCommand` (`style.go`).
- Produces: `calloutRows(line protocol.Cell, w int) []protocol.Cell`. The failure block's `next` goes through `calloutLines` and so through the same rule.

- [ ] **Step 1: Write the failing tests**

In `ui/internal/render/blocks_basic_test.go`, add:

```go
func TestACommandThatEndsAProseRowTakesARowOfItsOwn(t *testing.T) {
	b := protocol.Block{T: "callout", Label: "next", Body: []protocol.Cell{{{Text: "Commit them, or set them aside with "}, {Text: "rt git stash push", Role: "command"}}}}
	want := "    ▌ next Commit them, or set them aside with\n" +
		"    ▌      rt git stash push\n"
	if got := plain(b); got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
	if rs := rows(styled(b)); len(rs) != 2 || !strings.Contains(rs[1], "\x1b[1m") {
		t.Fatalf("the command row is not bold: %q", rs)
	}
}

func TestARowWithTwoCommandsWrapsWithoutSplittingEither(t *testing.T) {
	got := plainAt(40, protocol.Block{T: "callout", Label: "next", Body: []protocol.Cell{{
		{Text: "Fix the files, then run "}, {Text: "git add <files>", Role: "command"},
		{Text: " and "}, {Text: "git rebase --continue", Role: "command"},
	}}})
	want := "    ▌ next Fix the files, then run\n" +
		"    ▌      git add <files> and\n" +
		"    ▌      git rebase --continue\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestACommandMovedToItsOwnRowIsStillCleaned(t *testing.T) {
	b := protocol.Block{T: "callout", Label: "next", Body: []protocol.Cell{{{Text: "Run "}, {Text: "rt x\x1b[2J\n[ok] forged", Role: "command"}}}}
	if out := styled(b); strings.Contains(out, "\x1b[2J") {
		t.Fatalf("an escape survived: %q", out)
	}
	if got, want := plain(b), "    ▌ next Run\n    ▌      rt x [ok] forged\n"; got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestAFailureNextWithProseAndACommandSplitsTheSameWay(t *testing.T) {
	got := plain(protocol.Block{T: "failure", Title: "x", Next: protocol.Cell{{Text: "Run "}, {Text: "rt setup status", Role: "command"}}})
	if want := "  ✗ x\n    ▌ next Run\n    ▌      rt setup status\n"; got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `go -C ui test ./internal/render/ -run 'Command|FailureNext'`
Expected: FAIL. Each mixed row prints on one line (`    ▌ next Commit them, or set them aside with rt git stash push`), and the two-command row runs past 40 columns.

- [ ] **Step 3: Implement**

In `ui/internal/render/blocks_basic.go`, replace `calloutLines` (and its one-line comment) with:

```go
func (r *renderer) calloutLines(c color.Color, label string, body []protocol.Cell) {
	label = Clean(label)
	bar := calloutIndent + fg(c).Render(theme.GlyphBar) + " "
	cont := bar + strings.Repeat(" ", lipgloss.Width(label)+1)
	w := min(r.width-lipgloss.Width(cont), paragraphMax)
	first := true
	for _, line := range body {
		for _, row := range calloutRows(line, w) {
			if first {
				r.emit(bar + fg(c).Render(label) + " " + cell(row))
				first = false
				continue
			}
			r.emit(cont + cell(row))
		}
	}
}

// calloutRows breaks one body row. A command is pasted whole, so it is never
// split: a row that is only a command stays whole, a command that ends a row
// of prose takes a row of its own, and any other row wraps at its spaces
// with each command kept on one row.
func calloutRows(line protocol.Cell, w int) []protocol.Cell {
	if !hasCommand(line) {
		return wrapCell(line, w)
	}
	if prose, command, ok := trailingCommand(line); ok {
		return append(calloutRows(prose, w), command)
	}
	if onlyCommands(line) || widestCommand(line) > w {
		return []protocol.Cell{line}
	}
	glued := withCommandSpaces([]protocol.Cell{line}, " ", nbsp)[0]
	return withCommandSpaces(wrapCell(glued, w), nbsp, " ")
}

// nbsp holds a command together through wrapCell, which breaks only at
// plain spaces.
const nbsp = string(rune(0xA0))

// trailingCommand splits a row whose one command is its last segment into
// the prose before it and the command.
func trailingCommand(line protocol.Cell) (protocol.Cell, protocol.Cell, bool) {
	n := len(line)
	if n < 2 || line[n-1].Role != "command" {
		return nil, nil, false
	}
	prose := append(protocol.Cell(nil), line[:n-1]...)
	var words strings.Builder
	for _, s := range prose {
		if s.Role == "command" {
			return nil, nil, false
		}
		words.WriteString(s.Text)
	}
	if strings.TrimSpace(Clean(words.String())) == "" {
		return nil, nil, false
	}
	prose[n-2].Text = strings.TrimRight(prose[n-2].Text, " ")
	return prose, protocol.Cell{line[n-1]}, true
}

func onlyCommands(line protocol.Cell) bool {
	for _, s := range line {
		if s.Role != "command" && strings.TrimSpace(s.Text) != "" {
			return false
		}
	}
	return true
}

func widestCommand(line protocol.Cell) int {
	n := 0
	for _, s := range line {
		if s.Role == "command" {
			n = max(n, lipgloss.Width(Clean(s.Text)))
		}
	}
	return n
}

// withCommandSpaces swaps from for to inside command segments only.
func withCommandSpaces(rows []protocol.Cell, from, to string) []protocol.Cell {
	out := make([]protocol.Cell, len(rows))
	for i, row := range rows {
		out[i] = make(protocol.Cell, len(row))
		for j, s := range row {
			if s.Role == "command" {
				s.Text = strings.ReplaceAll(s.Text, from, to)
			}
			out[i][j] = s
		}
	}
	return out
}
```

`wrapCell` cleans text before it wraps, and `Clean` keeps a no-break space, so a glued command reaches `wordRows` as one word (`pieces` treats U+00A0 as part of a word).

- [ ] **Step 4: Run the tests to see them pass**

Run: `go -C ui vet ./...`
Run: `go -C ui test ./internal/render/`
Expected: PASS, including `TestACommandIsNeverWrapped`, `TestCalloutAttachesUnderALineAndKeepsTheRunAligned`, `TestCalloutBodyWrapsAndKeepsTheBarOnEveryRow` and `TestCalloutKeepsASegmentStyleAcrossTheBreak`.
Run: `bun run ui:build`
Run: `bun test lib/ui/__tests__/protocol.test.ts lib/ui/__tests__/out-plain.test.ts`
Expected: PASS. No wire change, and the plain callout is untouched.
Run: `bun run test:pty`
Expected: PASS. `e2e/pty/settings.test.ts` reads `▌ next rt home remote set`, a command-only row, which does not move.

- [ ] **Step 5: Render and look**

From `<scratch>/5g/`: `sh render.sh callouts 100`, then `sh render.sh callouts 60`. Screenshot all four pages and save `callouts-60-dark.html` and `callouts-60-light.html` as `docs/design/output-layer/5g-callouts-dark.png` and `5g-callouts-light.png`.

Check, on both backgrounds and both widths, against `before/`:

- "Commit them, or set them aside with" reads as a lead-in and `rt git stash push` sits under it at the body column, bold, easy to select whole.
- The `note` with three rows reads as one note: each trailing command (the abort, the backup ref, the force push) sits under its own sentence, and the bar runs down every row.
- The two-command `next` and the two-command `fix` wrap at spaces and never split `git add <files>`, `git rebase --continue` or the plugin path.
- Nothing runs past the pane edge at 60, apart from a single command wider than the body column, which stays whole by design.
- The callout reads lighter than before: fewer bold words mid-sentence.

A fault found here is fixed in this task, re-rendered and named in the report.

- [ ] **Step 6: Write it down**

In `AGENTS.md` "Output layer", after the paragraph that starts "Plain output collapses newlines and tabs", add a paragraph:

```markdown
A callout row that is only a command prints whole. A row whose one command
is its last segment (`["Commit them, or set them aside with ", out.cmd("rt git
stash push")]`) prints its sentence on the label row and the command on the
row under it, so end the sentence where the command starts; any other row
wraps at its spaces and never splits a command. Off a terminal the row stays
one line.
```

Wrap at about 78 columns like the paragraphs around it.

In `docs/design/output-layer/README.md`, append to the 5g table:

```markdown
| `5g-callouts-dark.png`, `5g-callouts-light.png` | 60 columns: a `next` whose command ends its sentence (the command on its own row), a three-row `note` doing the same, two-command rows that wrap without splitting a command, and a failure's command-only `next` |
```

- [ ] **Step 7: Commit**

```bash
git add ui/internal/render/blocks_basic.go ui/internal/render/blocks_basic_test.go AGENTS.md docs/design/output-layer/README.md docs/design/output-layer/5g-callouts-dark.png docs/design/output-layer/5g-callouts-light.png
```

```bash
git commit -m "rt-ui render: give a callout's closing command its own row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Failure details sit under their block

Item 5. Today `details` follow a blank row at the block's left edge (column 2, the glyph column), so a failure's file list and backup line read as separate output and the next block runs into them. They move to the body column (4), under the title's text and in line with the `why` and `next` bars, with no blank row. A captioned excerpt printed with the failure (`out.fail(f, out.verbatim(...))`) already sits at the body column; a test pins that. Plain output does not change: there the details are already indented under a title at column 0.

**Files:**
- Modify: `ui/internal/render/blocks_basic.go:165-173` (`failure`'s details)
- Test: `ui/internal/render/blocks_basic_test.go` (two tests change, two are added)
- Modify: `docs/design/output-layer/README.md`
- Create: `docs/design/output-layer/5g-failures-dark.png`, `5g-failures-light.png`

**Interfaces:**
- Consumes: `wrapCell` (Task 2), `faintStyle` (Task 1).
- Produces: nothing later tasks call.

- [ ] **Step 1: Write the failing tests**

In `ui/internal/render/blocks_basic_test.go`, change the end of `TestFailureShowsWhyNextAndDetails`'s `want` to:

```go
	want := "  ✗ This Mac cannot read the team's secrets yet\n" +
		"    ▌ why No key on this machine matches.\n" +
		"    ▌ next rt setup status\n" +
		"    details are in the log\n"
```

Change `TestFailureDetailsKeepTheirLines`'s `want` to `"  ✗ x\n    one\n    two\n    three\n"`.

Replace the body of `TestFailureDetailsWrap` after `rs := rows(out)` with:

```go
	if len(rs) < 3 || rs[1] == "" {
		t.Fatalf("details did not wrap straight under the title:\n%s", out)
	}
	var got []string
	for _, r := range rs[1:] {
		if !strings.HasPrefix(r, "    ") || r[4] == ' ' {
			t.Fatalf("a details row is not at the body column: %q", r)
		}
		got = append(got, r[4:])
	}
	if strings.Join(got, " ") != details {
		t.Fatalf("details lost text: %q", strings.Join(got, " "))
	}
```

Add:

```go
func TestBackToBackFailuresStayApart(t *testing.T) {
	got := plain(
		protocol.Block{T: "failure", Title: "The rebase stopped on conflicts in 2 files", Details: "src/app.ts\nA backup is at rt-backup/rebase/feature/login/2026-09-30T10-00-00"},
		protocol.Block{T: "failure", Title: "The agent did not finish in 10 minutes"},
	)
	want := "  ✗ The rebase stopped on conflicts in 2 files\n" +
		"    src/app.ts\n" +
		"    A backup is at rt-backup/rebase/feature/login/2026-09-30T10-00-00\n" +
		"  ✗ The agent did not finish in 10 minutes\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestAnExcerptPrintedWithAFailureSitsUnderIt(t *testing.T) {
	got := plain(
		protocol.Block{T: "failure", Title: "Could not connect to Acme QA", Why: "The gateway did not respond."},
		protocol.Block{T: "verbatim", Caption: "what StrongDM printed", Lines: []string{"connecting to acme-db-qa"}},
	)
	want := "  ✗ Could not connect to Acme QA\n" +
		"    ▌ why The gateway did not respond.\n" +
		"    what StrongDM printed\n" +
		"    │ connecting to acme-db-qa\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `go -C ui test ./internal/render/ -run 'Failure|Excerpt'`
Expected: FAIL on the details tests (a blank row, then rows at column 2). `TestAnExcerptPrintedWithAFailureSitsUnderIt` passes already: it pins the layout the details now match.

- [ ] **Step 3: Implement**

In `ui/internal/render/blocks_basic.go`, replace the `if b.Details != ""` block at the end of `failure` with:

```go
	if b.Details != "" {
		dw := min(r.width-len(calloutIndent), paragraphMax)
		for _, l := range splitLines(b.Details) {
			for _, row := range wrapCell(protocol.Cell{{Text: l, Role: "faint"}}, dw) {
				r.emit(calloutIndent + cell(row))
			}
		}
	}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `go -C ui test ./internal/render/`
Expected: PASS.
Run: `bun run ui:build`
Run: `bun test lib/ui/__tests__/protocol.test.ts lib/ui/__tests__/out-plain.test.ts`
Expected: PASS. No wire change.
Run: `bun run test:pty`
Expected: PASS. `e2e/pty/errors.test.ts` asserts `"    at "` never reaches the screen; details now start at column 4, so a details line that began with "at " would match. The unexpected-error failure prints no stack at a terminal, so the assertion holds; if it fails, the stack reached the screen and that is a bug to report, not a test to loosen.

- [ ] **Step 5: Render and look**

From `<scratch>/5g/`: `sh render.sh failures 100`. Screenshot both pages and save them as `docs/design/output-layer/5g-failures-dark.png` and `5g-failures-light.png`.

Check, on both backgrounds, against `before/`:

- Each failure reads as one block: title, `why`, `next`, details and any excerpt all start at or right of the title's text.
- The refusal after the rebase failure starts a new block at the glyph column and does not read as one more detail line.
- "A backup is at ..." reads whole and selectable.
- git's `! [rejected]` line under "Could not push feature/billing" reads as that failure's detail; its leading `!` is faint text, not the warn glyph.
- The two excerpts ("the end of the pane", "what StrongDM printed") sit under their failures, caption and rail at the same column as the details.

A fault found here is fixed in this task, re-rendered and named in the report.

- [ ] **Step 6: Write it down**

In `docs/design/output-layer/README.md`, append to the 5g table:

```markdown
| `5g-failures-dark.png`, `5g-failures-light.png` | 100 columns: failures whose details (a file list, a backup ref, git's rejected line) sit under the title with no blank row, back to back with a refusal and with the excerpts printed under them |
```

- [ ] **Step 7: Commit**

```bash
git add ui/internal/render/blocks_basic.go ui/internal/render/blocks_basic_test.go docs/design/output-layer/README.md docs/design/output-layer/5g-failures-dark.png docs/design/output-layer/5g-failures-light.png
```

```bash
git commit -m "rt-ui render: draw failure details under their block

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Consecutive kv blocks share a key column

Item 6. The decision (the plan's decision 6): a run of consecutive `kv` blocks in one render call pads its keys to one width, as a run of `line` blocks pads its titles (spec rule 6). A kv run does not align with `line` rows next to it: a line's title follows a glyph and a kv key does not, so sharing a column would push one of them off its own grid. A key too wide to leave its value a column worth wrapping into stays out of the alignment and takes its value on the row below. A long value wraps in its column.

**Files:**
- Modify: `ui/internal/render/render.go:49-93` (`blocks`, `block`)
- Modify: `ui/internal/render/blocks_basic.go:106-115` (`kv` becomes `kvRun`)
- Test: `ui/internal/render/blocks_basic_test.go`
- Modify: the spec (rule 6), `AGENTS.md`, `docs/design/output-layer/README.md`
- Create: `docs/design/output-layer/5g-kv-dark.png`, `5g-kv-light.png`

**Interfaces:**
- Consumes: `wrapCell` (Task 2), `keyStyle` (Task 1).
- Produces: `(*renderer).kvRun(run []protocol.Block)` and `runEnd(bs []protocol.Block, i int, types ...string) int`. Task 7 adds `blank` to `block`.

- [ ] **Step 1: Write the failing tests**

In `ui/internal/render/blocks_basic_test.go`, add:

```go
func TestConsecutiveKvRowsShareAKeyColumn(t *testing.T) {
	got := plain(
		protocol.Block{T: "kv", Key: "usage", Value: "rt chat <verb>"},
		protocol.Block{T: "kv", Key: "repo", Value: "sample-app"},
		protocol.Block{T: "kv", Key: "from", Value: "~/code/sample-app"},
	)
	want := "  usage  rt chat <verb>\n  repo   sample-app\n  from   ~/code/sample-app\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestAKvSourceStaysUnderItsKeyInsideARun(t *testing.T) {
	got := plain(
		protocol.Block{T: "kv", Key: "rt.worktreeApp", Value: "true", Source: "from team example"},
		protocol.Block{T: "kv", Key: "rt.x", Value: "false"},
	)
	want := "  rt.worktreeApp  true\n    from team example\n  rt.x            false\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestAKvValueWrapsInsideItsColumn(t *testing.T) {
	got := plainAt(40, protocol.Block{T: "kv", Key: "Rules", Value: "the saved rules are behind your settings file and need a refresh"})
	want := "  Rules  the saved rules are behind your\n" +
		strings.Repeat(" ", 9) + "settings file and need a\n" +
		strings.Repeat(" ", 9) + "refresh\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
	checkWidth(t, got, 40)
}

func TestAKvRunDoesNotAlignWithTheLinesBesideIt(t *testing.T) {
	got := plain(
		protocol.Block{T: "line", Status: "done", Title: "Installed", Hint: "pnpm"},
		protocol.Block{T: "kv", Key: "Rules", Value: "3"},
	)
	if want := "  ✓ Installed  pnpm\n  Rules  3\n"; got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `go -C ui test ./internal/render/ -run Kv`
Expected: FAIL on the first three: each kv draws its own key, so the values start at three different columns, and a long value runs on one row.

- [ ] **Step 3: Implement**

In `ui/internal/render/render.go`, replace `blocks` with:

```go
func (r *renderer) blocks(bs []protocol.Block) {
	for i := 0; i < len(bs); i++ {
		switch bs[i].T {
		case "line":
			j := runEnd(bs, i, "line", "callout")
			r.lineRun(bs[i:j])
			i = j - 1
		case "kv":
			j := runEnd(bs, i, "kv")
			r.kvRun(bs[i:j])
			i = j - 1
		default:
			r.block(bs[i])
		}
	}
}

// runEnd returns the index just past the run of blocks from i whose types
// are all in types.
func runEnd(bs []protocol.Block, i int, types ...string) int {
	j := i
	for j < len(bs) && slices.Contains(types, bs[j].T) {
		j++
	}
	return j
}
```

add `"slices"` to its imports, and delete the `case "kv": r.kv(b)` arm from `block`.

In `ui/internal/render/blocks_basic.go`, replace `kv` with:

```go
// kvRun pads a run of kv keys to one width so the values line up. A key too
// wide to leave its value a column worth wrapping into stays out of the
// alignment and takes its value on the row below.
func (r *renderer) kvRun(run []protocol.Block) {
	textW := r.width - len(indent)
	keyCap := textW - 2 - minWrap
	w := 0
	for _, b := range run {
		if kw := lipgloss.Width(Clean(b.Key)); b.Value != "" && kw <= keyCap {
			w = max(w, kw)
		}
	}
	for _, b := range run {
		key := keyStyle.Render(Clean(b.Key))
		value := protocol.Cell{{Text: b.Value, Role: "strong"}}
		switch {
		case b.Value == "":
			r.emit(indent + key)
		case lipgloss.Width(key) <= keyCap:
			for i, row := range wrapCell(value, textW-w-2) {
				if i == 0 {
					r.emit(indent + pad(key, w) + "  " + cell(row))
					continue
				}
				r.emit(indent + strings.Repeat(" ", w+2) + cell(row))
			}
		default:
			r.emit(indent + key)
			for _, row := range wrapCell(value, textW-2) {
				r.emit(indent + "  " + cell(row))
			}
		}
		if b.Source != "" {
			r.emit(indent + "  " + faintStyle.Render(Clean(b.Source)))
		}
	}
}
```

A `strong` segment renders as `strongStyle.Render(Clean(value))` did, so a lone kv prints the bytes it did (`TestKvPrintsSourceOnItsOwnLineIndentedUnderTheKey`, `TestKvWithoutAValuePrintsOnlyTheKey`).

- [ ] **Step 4: Run the tests to see them pass**

Run: `go -C ui vet ./...`
Run: `go -C ui test ./internal/render/`
Expected: PASS.
Run: `bun run ui:build`
Run: `bun test lib/ui/__tests__/protocol.test.ts lib/ui/__tests__/out-plain.test.ts`
Expected: PASS. No wire change; plain kv rows keep `key: value`.

- [ ] **Step 5: Render and look**

From `<scratch>/5g/`: `sh render.sh kv 100`, then `sh render.sh kv 60`. Screenshot all four pages and save `kv-100-dark.html` and `kv-100-light.html` as `docs/design/output-layer/5g-kv-dark.png` and `5g-kv-light.png`.

Check, on both backgrounds and both widths, against `before/`:

- The five `deps resolve` rows (Tool, Bundled, Your copy, Linked, Uses) start their values at one column.
- From and To line up with each other.
- `Rules  3` after the two `line` rows reads as its own row, not as a misaligned hint.
- The settings source line sits under its key.
- At 60, the long `rt.repoRoots` value wraps inside its column and never under the key column.

A fault found here is fixed in this task, re-rendered and named in the report.

- [ ] **Step 6: Write it down**

In the spec, rule 6 becomes:

```markdown
6. **Hints align.** Consecutive `line` blocks in one call pad their titles to a common width, and consecutive `kv` blocks pad their keys the same way. A `kv` run does not align with the `line` rows beside it.
```

In `AGENTS.md` "Output layer", append to the paragraph Task 4 added: "Consecutive `kv` blocks in one `out.print` share a key column, so print a group of them in one call."

In `docs/design/output-layer/README.md`, append to the 5g table:

```markdown
| `5g-kv-dark.png`, `5g-kv-light.png` | 100 columns: the `rt deps resolve` rows, a link's From and To, intercept's `Rules` after its lines, a setting with its source, and a long value wrapping in its column |
```

- [ ] **Step 7: Commit**

```bash
git add ui/internal/render/render.go ui/internal/render/blocks_basic.go ui/internal/render/blocks_basic_test.go docs/superpowers/specs/2026-09-30-rt-output-layer-design.md AGENTS.md docs/design/output-layer/README.md docs/design/output-layer/5g-kv-dark.png docs/design/output-layer/5g-kv-light.png
```

```bash
git commit -m "rt-ui render: align consecutive kv rows on one key column

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: A blank-line block

Item 8. `out.blank()` is one empty row on purpose. It replaces the empty one-cell table that the breadcrumb (`lib/command-tree.ts`) and `rt sync all`'s `BRANCH_GAP` (`commands/sync.ts`) print today. Plain output prints the same empty row the table did; styled output drops the two trailing spaces the table's indent left on that row.

**Files:**
- Modify: `ui/internal/protocol/render.go:69-73`, `ui/internal/render/render.go` (`block`)
- Modify: `ui/fixtures/render-document.json`
- Modify: `lib/ui/protocol.ts:107-123`, `lib/ui/out.ts`, `lib/ui/out-plain.ts`
- Modify: `lib/command-tree.ts:503-504`, `commands/sync.ts:353`
- Test: `ui/internal/protocol/render_test.go`, `ui/internal/render/blocks_basic_test.go`, `lib/ui/__tests__/out-plain.test.ts`, `lib/ui/__tests__/out.test.ts`, `lib/__tests__/command-tree-header.test.ts`
- Modify: the spec ("Block vocabulary", rule 8), `AGENTS.md`, `docs/design/output-layer/README.md`
- Create: `docs/design/output-layer/5g-breadcrumb-dark.png`, `5g-breadcrumb-light.png`

**Interfaces:**
- Consumes: `runEnd` and the `blocks` switch (Task 6).
- Produces: wire block `{ "t": "blank" }`; TS `out.blank(): Block`; Go `block` case `"blank"`. `PROTOCOL_VERSION` stays 1. A helper that predates this task rejects the block with exit 2 and the layer prints that call plain.

- [ ] **Step 1: Write the failing tests**

In `ui/fixtures/render-document.json`, insert after the `paragraph` entry:

```json
  { "t": "blank" },
```

In `ui/internal/protocol/render_test.go`, add `"blank"` to the list in `TestRenderFixtureDecodesAndReencodes`:

```go
	for _, name := range []string{"line", "callout", "kv", "table", "tree", "section", "summary", "paragraph", "blank", "copy", "verbatim", "changes", "diff", "banner", "failure"} {
```

In `ui/internal/render/blocks_basic_test.go`, add:

```go
func TestABlankBlockPrintsOneEmptyRow(t *testing.T) {
	blank := protocol.Block{T: "blank"}
	if got := plain(protocol.Block{T: "section", Title: "rt › show"}, blank); got != "  rt › show\n\n" {
		t.Fatalf("under a section: %q", got)
	}
	if got := plain(blank); got != "\n" {
		t.Fatalf("alone: %q", got)
	}
	if got := plain(protocol.Block{T: "line", Status: "done", Title: "a"}, blank, protocol.Block{T: "line", Status: "done", Title: "b"}); got != "  ✓ a\n\n  ✓ b\n" {
		t.Fatalf("between lines: %q", got)
	}
}
```

In `lib/ui/__tests__/out-plain.test.ts`, add:

```ts
test("a blank block prints one empty row", () => {
  expect(renderPlain([{ t: "section", title: "rt › show", blocks: [] }, { t: "blank" }])).toBe("rt › show\n\n");
  expect(renderPlain([{ t: "blank" }])).toBe("\n");
});
```

In `lib/ui/__tests__/out.test.ts`, add:

```ts
test("a helper that rejects the blank block still prints the breadcrumb plain", () => {
  process.env.RT_UI_FAKE = JSON.stringify({ record, exit: 2 });
  out.note(out.section("rt › show", undefined), out.blank());
  expect(stderr.join("")).toBe("rt › show\n\n");
});
```

In `lib/__tests__/command-tree-header.test.ts`, change lines 66 and 68 to:

```ts
  expect(wire()).toEqual(["call", "hello", "section", "blank"]);
  expect(sent()[2]).toMatchObject({ t: "section", title: "rt › show" });
  expect(sent()[3]).toEqual({ t: "blank" });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `go -C ui test ./internal/protocol/ ./internal/render/`
Expected: FAIL. `DecodeBlock` rejects `{"t":"blank"}` (`ErrBadSpec`), and the renderer prints nothing for it.
Run: `bun test lib/ui/__tests__/out-plain.test.ts lib/ui/__tests__/out.test.ts lib/ui/__tests__/protocol.test.ts lib/__tests__/command-tree-header.test.ts`
Expected: FAIL. `out.blank is not a function`; the protocol test's fixture types no longer equal `BLOCK_TYPES`; the header test still sees a `table`.

- [ ] **Step 3: Implement the Go side**

In `ui/internal/protocol/render.go`, add `"blank": true` to `blockTypes`:

```go
var blockTypes = map[string]bool{
	"line": true, "callout": true, "kv": true, "table": true, "tree": true,
	"section": true, "summary": true, "paragraph": true, "blank": true, "copy": true,
	"verbatim": true, "changes": true, "diff": true, "banner": true, "failure": true,
}
```

In `ui/internal/render/render.go`'s `block`, add:

```go
	case "blank":
		r.emit("")
```

- [ ] **Step 4: Implement the TS side**

In `lib/ui/protocol.ts`, add `| { t: "blank" }` to the `Block` union after the `paragraph` member, and `"blank"` to `BLOCK_TYPES` after `"paragraph"`.

In `lib/ui/out.ts`, after `paragraph`:

```ts
/** One empty row, on purpose: under the breadcrumb, between `sync all`'s branches. */
export function blank(): Block {
  return { t: "blank" };
}
```

In `lib/ui/out-plain.ts`'s `render` switch, after the `paragraph` case:

```ts
      case "blank":
        out.push("");
        break;
```

In `lib/command-tree.ts`, replace lines 503 and 504 (the comment about the empty table and the `out.note` call) with:

```ts
  out.note(out.section(breadcrumb.join(" › "), IS_DEV_MODE ? "dev mode" : undefined), out.blank());
```

In `commands/sync.ts:353`, change `out.table([[""]])` to `out.blank()`. Keep its comment.

- [ ] **Step 5: Run the tests to see them pass**

Run: `go -C ui vet ./...`
Run: `go -C ui test ./...`
Run: `bun run ui:build`
Run: `bun test lib/ui lib/__tests__/command-tree-header.test.ts commands/__tests__/sync-output.test.ts`
Expected: PASS. `sync-output.test.ts`'s `renderPlain([BRANCH_GAP])` is still `"\n"`, and the shared fixture decodes and re-encodes from both languages.
Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Render and look**

Add one set to `<scratch>/5g/sets.ts` (inside `sets`):

```ts
  breadcrumb: () => [
    out.section("rt › daemon › status", "dev mode"),
    out.blank(),
    out.section("Daemon", undefined, out.line("running", "The rt daemon is running", "pid 4242")),
    out.blank(),
    out.section("feature/login", "sample-app", out.line("done", "feature/login is up to date with origin/main")),
  ],
```

From `<scratch>/5g/`: `sh render.sh breadcrumb 100`. Screenshot both pages and save them as `docs/design/output-layer/5g-breadcrumb-dark.png` and `5g-breadcrumb-light.png`.

Check, on both backgrounds: exactly one empty row under the breadcrumb and one between the two sections (the section's own gap does not stack a second one on the blank); the breadcrumb, the "dev mode" subtitle and the first section heading read as three things, not one heading.

Also run one real command through the dispatcher at a terminal, from a source checkout with the new helper built, under an isolated HOME: `env -i HOME="$(mktemp -d)" PATH="$PATH" TERM=xterm-256color COLORTERM=truecolor bun <repo>/cli.ts daemon status` in a real terminal pane, and confirm the breadcrumb is followed by one empty row and no stray spaces. If the command needs a daemon and fails, the breadcrumb still prints first; that is enough.

- [ ] **Step 7: Write it down**

In the spec, "Block vocabulary": add a row after `paragraph`:

```markdown
| `blank` | nothing: one empty row | the breadcrumb header, `sync all` between branches |
```

Rule 8 becomes:

```markdown
8. **Spacing.** One blank line before a `section` unless it is the first block; one before a `summary`. Blocks never print trailing blank lines, except `blank`, whose one job is an empty row.
```

In `AGENTS.md` "Output layer", in the breadcrumb paragraph, change "and one blank line follows it." to "and one blank line follows it (`out.blank()`, the one block that prints an empty row on purpose; never an empty table)."

In `docs/design/output-layer/README.md`, append to the 5g table:

```markdown
| `5g-breadcrumb-dark.png`, `5g-breadcrumb-light.png` | the breadcrumb header with its `blank` row, then two sections, the second after `sync all`'s branch gap |
```

- [ ] **Step 8: Commit**

```bash
git add ui/internal/protocol/render.go ui/internal/protocol/render_test.go ui/internal/render/render.go ui/internal/render/blocks_basic_test.go ui/fixtures/render-document.json lib/ui/protocol.ts lib/ui/out.ts lib/ui/out-plain.ts lib/command-tree.ts commands/sync.ts lib/ui/__tests__/out-plain.test.ts lib/ui/__tests__/out.test.ts lib/__tests__/command-tree-header.test.ts docs/superpowers/specs/2026-09-30-rt-output-layer-design.md AGENTS.md docs/design/output-layer/README.md docs/design/output-layer/5g-breadcrumb-dark.png docs/design/output-layer/5g-breadcrumb-light.png
```

```bash
git commit -m "output layer: add a blank block for the breadcrumb and sync gaps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The step runner's loose ends

Items 9, 10 and 11. The shim goes (no caller is left on main). For the old-helper skew, the plan's decision 10: no version detection. A step that is cleared because its task threw sends `status: "failed"` on its `done` along with `clear: true`. A helper that knows `clear` erases the row as today and ignores the status. A helper older than `clear` (but new enough for `status`, which phase 1 added with the render verb) paints the row with the neutral dot, since "failed" on `done` is never coral, where today it paints a check under a failure. AGENTS.md says what a `failSilently` step prints off a terminal: nothing.

**Files:**
- Delete: `lib/tui/inline-spinner.ts`
- Modify: `lib/ui/spawn.ts:80-81,119-121`, `lib/ui/steps.ts:79-82`, `lib/ui/transient-step.ts`
- Create: `ui/fixtures/steps-stream-clear-thrown.json`
- Test: `lib/ui/__tests__/transient-step.test.ts`, `lib/ui/__tests__/steps.test.ts`, `lib/ui/__tests__/spawn.test.ts`, `lib/ui/__tests__/protocol.test.ts`, `ui/internal/protocol/protocol_test.go`, `ui/internal/steps/steps_test.go`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: 5a's `StepHandle.clear()` and `withTransientStep`.
- Produces: `StepHandle.clear(opts?: { thrown?: boolean }): Promise<boolean>`. With `thrown: true` the event is `{ t: "done", title: <label>, status: "failed", clear: true }`; without it, the event is unchanged. Every existing `clear()` call compiles as it is.

- [ ] **Step 1: Write the failing tests**

In `lib/ui/__tests__/transient-step.test.ts`, delete the import of `withInlineSpinner` (line 7) and the test `withInlineSpinner is the transient step under its old name`. In `a task that throws still clears, and the error reaches the caller`, change the last expectation to:

```ts
  expect(sent().at(-1)).toEqual({ t: "done", title: "scanning ports…", status: "failed", clear: true });
```

In `lib/ui/__tests__/steps.test.ts`, in `a step that fails silently erases itself, draws no failed line, and rethrows`, change the last event to `{ t: "done", title: "Pushing…", status: "failed", clear: true }`.

In `lib/ui/__tests__/spawn.test.ts`, add after `clear ends the step with a done event that carries the label and clear`:

```ts
test("a clear after a throw carries the failed status for a helper that predates the flag", async () => {
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  const step = openStep("pushing…");
  expect(await step.clear({ thrown: true })).toBe(true);
  const sent = readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(sent.at(-1)).toEqual({ t: "done", title: "pushing…", status: "failed", clear: true });
});
```

In `lib/ui/__tests__/protocol.test.ts`, add after `the clear fixture ends a step with a done event that carries clear`:

```ts
test("the thrown clear fixture ends a step with clear and the failed status", () => {
  const events = fixture("steps-stream-clear-thrown.json") as StepEvent[];
  expect(events.map((e) => e.t)).toEqual(["hello", "start", "done"]);
  expect(events.at(-1)).toEqual({ t: "done", title: "Pushing…", status: "failed", clear: true });
});
```

In `ui/internal/protocol/protocol_test.go`, add after `TestStepsClearFixtureDecodes`:

```go
func TestStepsThrownClearFixtureDecodes(t *testing.T) {
	var lines []json.RawMessage
	if err := json.Unmarshal(fixture(t, "steps-stream-clear-thrown.json"), &lines); err != nil {
		t.Fatal(err)
	}
	if len(lines) != 3 {
		t.Fatalf("got %d lines", len(lines))
	}
	ev, err := DecodeStep(lines[2])
	if err != nil {
		t.Fatal(err)
	}
	if ev.T != "done" || !ev.Clear || ev.Status != "failed" {
		t.Fatalf("got %+v", ev)
	}
}
```

In `ui/internal/steps/steps_test.go`, add after `TestADoneWithoutTheFlagStillPaintsItsRow`:

```go
func TestAClearAfterAThrowLeavesNothingOnScreen(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"Pushing…"}`, `{"t":"sub","text":"writing objects"}`, `{"t":"done","title":"Pushing…","status":"failed","clear":true}`}
	stdout, tty, exit := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	if exit != 0 || stdout != "" {
		t.Fatalf("exit %d stdout %q", exit, stdout)
	}
	if screen := testutil.Screen(tty); strings.TrimSpace(screen) != "" {
		t.Fatalf("a cleared step left text on screen: %q", screen)
	}
}

// What a helper without the flag does with the same event: the neutral dot,
// never the check a failed push must not show.
func TestAThrownClearOnAHelperWithoutTheFlagEndsOnTheDot(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"Pushing…"}`, `{"t":"done","title":"Pushing…","status":"failed"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	if screen := testutil.Screen(tty); !strings.Contains(screen, "• Pushing…") || strings.Contains(screen, "✓") {
		t.Fatalf("screen %q", screen)
	}
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test lib/ui/__tests__/transient-step.test.ts lib/ui/__tests__/steps.test.ts lib/ui/__tests__/spawn.test.ts lib/ui/__tests__/protocol.test.ts`
Expected: FAIL. The cleared `done` carries no `status`, and the new fixture does not exist (`ENOENT`).
Run: `go -C ui test ./internal/protocol/ ./internal/steps/`
Expected: FAIL on `TestStepsThrownClearFixtureDecodes` only (no fixture). The two steps tests pass already: they pin what the helper does with the event the TS side is about to send.

- [ ] **Step 3: Write the fixture**

Create `ui/fixtures/steps-stream-clear-thrown.json`:

```json
[
  { "t": "hello", "protocol": 1 },
  { "t": "start", "title": "Pushing…" },
  { "t": "done", "title": "Pushing…", "status": "failed", "clear": true }
]
```

- [ ] **Step 4: Implement, and delete the shim**

In `lib/ui/spawn.ts`, replace the `clear` member of `StepHandle` with:

```ts
  /**
   * Ends the step and erases its row and sub-lines, leaving nothing. Resolves true when rt-ui ended the step.
   * `thrown` says the task failed: a helper that predates the flag then ends the row on the neutral dot, never a check.
   */
  clear(opts?: { thrown?: boolean }): Promise<boolean>;
```

and the implementation (with its comment) with:

```ts
    // The label rides along as the title and a thrown task as the failed
    // status: a helper that predates the flag paints a done row, on the
    // neutral dot when the task threw.
    clear: (opts) => finish("done", undefined, undefined, opts?.thrown ? "failed" : undefined, true),
```

In `lib/ui/steps.ts`, in the `failSilently` branch, change `await step?.clear();` to `await step?.clear({ thrown: true });`.

In `lib/ui/transient-step.ts`, change the `step` declaration and the last `try` to:

```ts
  let step: { clear(opts?: { thrown?: boolean }): Promise<boolean> } | null = null;
```

```ts
  let thrown = false;
  try {
    return await task();
  } catch (err) {
    thrown = true;
    throw err;
  } finally {
    await step?.clear({ thrown });
  }
```

Delete `lib/tui/inline-spinner.ts`: `git rm lib/tui/inline-spinner.ts`. Then run `grep -rn "inline-spinner\|withInlineSpinner" --include='*.ts' lib commands cli.ts scripts`. Expected: no output. (The spec and older plans name the file as history; they are not edited.)

If Task 1 Step 1 found a third importer, skip the deletion, keep the transient-step test's import, and say so in the report.

- [ ] **Step 5: Run the tests to see them pass**

Run: `bun test lib/ui lib/__tests__/no-eager-tui.test.ts lib/__tests__/no-raw-output.test.ts`
Run: `go -C ui test ./internal/protocol/ ./internal/steps/`
Run: `bun run typecheck`
Expected: PASS. A test file that builds its own object typed `StepHandle` still compiles: the new parameter is optional.

- [ ] **Step 6: Look at a real failing step**

This task changes no drawing in a helper that knows `clear`, so there is no render page. Confirm the one visible case by hand in a terminal pane, from the worktree, with the new helper built: write `<scratch>/5g/silent.ts`:

```ts
import { createStepRunner } from "<repo>/lib/ui/steps.ts";
await createStepRunner()
  .run("Pushing…", async (step) => {
    step.sub("writing objects");
    await Bun.sleep(400);
    throw new Error("rejected");
  }, { done: "Pushed", failSilently: true })
  .catch(() => {});
```

Run `env -i HOME="$(mktemp -d)" PATH="$PATH" TERM="$TERM" COLORTERM=truecolor bun <scratch>/5g/silent.ts` in a real terminal pane: the spinner shows, then the row erases and nothing is left. Then run it with `RT_UI_BIN` pointing at a helper built from `origin/main` before 5a's `clear` landed, if one is at hand (`git worktree` is not needed: the installed `/Applications/mattstack.app/Contents/Helpers/rt-ui` from an older build will do); expect `• Pushing…`, never `✓`. If no older helper is at hand, say so: the Go test `TestAThrownClearOnAHelperWithoutTheFlagEndsOnTheDot` stands in for it.

- [ ] **Step 7: Write it down**

In `AGENTS.md` "Output layer", in the paragraph that starts "`lib/ui/steps.ts` prints nothing by hand", after its first sentence add: "A step run with `failSilently` prints nothing off a terminal either; at a terminal it ends with `clear({ thrown: true })`, so its row is erased and the caller draws the failure."

In the `withTransientStep` paragraph, change "The flag rides `done` so a helper that predates it ends the step with a plain row;" to "The flag rides `done` so a helper that predates it ends the step with a plain row, on the neutral dot when the task threw (`status: \"failed\"` rides along);".

- [ ] **Step 8: Commit**

```bash
git add lib/ui/spawn.ts lib/ui/steps.ts lib/ui/transient-step.ts lib/ui/__tests__/transient-step.test.ts lib/ui/__tests__/steps.test.ts lib/ui/__tests__/spawn.test.ts lib/ui/__tests__/protocol.test.ts ui/fixtures/steps-stream-clear-thrown.json ui/internal/protocol/protocol_test.go ui/internal/steps/steps_test.go AGENTS.md
```

(`git rm` already staged the deleted shim.)

```bash
git commit -m "steps: end a thrown cleared step on the neutral dot, drop the spinner shim

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Copy blocks, as Matt rules (Decision D1)

Item 7. **Depends on Matt's answer to Decision D1.** Before Step 1, read the ruling (the shepherd's ledger, or the herd room). If there is none, do not start: report "Task 9 waits on Decision D1" and stop. Do not pick an option.

**Files:**
- Modify (options B and C): `ui/internal/render/blocks_text.go:52-58` (`copy`)
- Test (options B and C): `ui/internal/render/blocks_text_test.go`
- Modify (every option): the spec (rule 7), `AGENTS.md`, `docs/design/output-layer/README.md`
- Create (every option): `docs/design/output-layer/5g-copy-dark.png`, `5g-copy-light.png`

**Interfaces:**
- Consumes: `ruleStyle`, `faintStyle` (Task 1), `caption` (`blocks_text.go`).
- Produces: nothing later tasks call. Plain output does not change under any option: `lib/ui/out-plain.ts` already prints copy text at column 0.

- [ ] **Step 1: Write the failing tests (options B and C; option A skips to Step 5)**

**Option B.** In `ui/internal/render/blocks_text_test.go`, change `TestCopyBlockIsNeverWrapped`'s `want` to `"    send this link\n" + long + "\n"`, `TestCopyBlockKeepsEachOfItsLines`'s `want` to `"line one\nline two\n"`, and add:

```go
func TestACopyBlockPrintsAtColumnZeroWithNoRail(t *testing.T) {
	got := plain(protocol.Block{T: "copy", Caption: "message to send", Text: "Join the team:\n  rt team join sample\x1b[2J"})
	want := "    message to send\nJoin the team:\n  rt team join sample\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}
```

**Option C.** Change `TestCopyBlockIsNeverWrapped`'s `want` to `"╭─ send this link ─\n" + long + "\n╰─\n"`, `TestCopyBlockKeepsEachOfItsLines`'s `want` to `"╭─\nline one\nline two\n╰─\n"`, and add:

```go
func TestACopyBlockSitsBetweenFrameRowsWithNoGlyphOnItsText(t *testing.T) {
	got := plain(protocol.Block{T: "copy", Caption: "message to send", Text: "Join the team:\n  rt team join sample\x1b[2J"})
	want := "╭─ message to send ─\nJoin the team:\n  rt team join sample\n╰─\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `go -C ui test ./internal/render/ -run Copy`
Expected: FAIL: every text row still starts with `    │ `.

- [ ] **Step 3: Implement**

**Option B.** Replace `copy` in `ui/internal/render/blocks_text.go` with:

```go
// copy prints its text at column 0 with no rail, never wrapped and never
// restyled inside, so a drag-select pastes it clean. That is also why it
// must never carry untrusted multi-line text: a line here could pose as
// output.
func (r *renderer) copy(b protocol.Block) {
	r.caption(b.Caption)
	for _, l := range splitLines(b.Text) {
		r.emit(textStyle.Render(Clean(l)))
	}
}
```

**Option C.** Replace `copy` with:

```go
// copy prints its text at column 0 between two faint frame rows, never
// wrapped and never restyled inside, so a drag across the text rows pastes
// clean. That is also why it must never carry untrusted multi-line text.
func (r *renderer) copy(b protocol.Block) {
	top := "╭─"
	if c := Clean(b.Caption); c != "" {
		top += " " + c + " ─"
	}
	r.emit(ruleStyle.Render(top))
	for _, l := range splitLines(b.Text) {
		r.emit(textStyle.Render(Clean(l)))
	}
	r.emit(ruleStyle.Render("╰─"))
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `go -C ui test ./internal/render/`
Run: `bun run ui:build`
Run: `bun test lib/ui/__tests__/protocol.test.ts lib/ui/__tests__/out-plain.test.ts`
Expected: PASS.

- [ ] **Step 5: Render and look (every option)**

From `<scratch>/5g/`: `sh render.sh copy 100`. Screenshot both pages and save them as `docs/design/output-layer/5g-copy-dark.png` and `5g-copy-light.png`.

Then the real test of this item, in a real terminal pane (not the browser): `env -i HOME="$(mktemp -d)" PATH="$PATH" TERM=xterm-256color COLORTERM=truecolor <repo>/ui/dist/rt-ui render --width 100 < <scratch>/5g/copy.ndjson`, drag-select the three lines of "message to send", paste into a plain text file and look at the bytes (`cat -v`).

Check, on both backgrounds:
- **A:** the paste carries `    │ ` on every line; say so in the report, as Matt chose it.
- **B and C:** the paste is exactly the message, with its own two-space indent on the third line and nothing else; the copy blocks still read as set apart from the lines around them; the caption names what to copy.

- [ ] **Step 6: Write it down**

**Option A.** In `AGENTS.md`, replace "A `copy` block prints at column 0 so it pastes clean, which means it must never carry untrusted multi-line text." with "A `copy` block prints at column 0 off a terminal, so it pastes clean there; at a terminal it sits behind the thin rail (spec rule 7), so a drag-select takes the rail with it. It must never carry untrusted multi-line text." The spec does not change.

**Option B.** In `AGENTS.md`, replace the same sentence with "A `copy` block prints at column 0 with no rail, at a terminal and off one, so a drag-select pastes it clean; that is also why it must never carry untrusted multi-line text." In the spec, rule 7 becomes: "7. **Rails.** Callouts use the thick `▌` bar in the label's color. `verbatim` uses a thin `│` rail in the `StaticRule` tone. `copy` has no rail: its text prints at column 0 so a drag-select pastes clean (ruled <date of Matt's answer>)."

**Option C.** In `AGENTS.md`, replace the same sentence with "A `copy` block prints its text at column 0 between two faint frame rows at a terminal (at column 0 with no frame off one), so a drag across the text pastes clean; that is also why it must never carry untrusted multi-line text." In the spec, rule 7 becomes: "7. **Rails.** Callouts use the thick `▌` bar in the label's color. `verbatim` uses a thin `│` rail in the `StaticRule` tone. `copy` has no rail: its text prints at column 0 between a `╭─ caption ─` row and a `╰─` row, so a drag across the text pastes clean (ruled <date of Matt's answer>)."

In `docs/design/output-layer/README.md`, append to the 5g table:

```markdown
| `5g-copy-dark.png`, `5g-copy-light.png` | `rt team invite`'s link and message and `rt git pull`'s dry-run command as `copy` blocks, drawn as Matt ruled on the rail (Decision D1 in the 5g plan) |
```

- [ ] **Step 7: Commit**

Option A: `git add docs/superpowers/specs/2026-09-30-rt-output-layer-design.md AGENTS.md docs/design/output-layer/README.md docs/design/output-layer/5g-copy-dark.png docs/design/output-layer/5g-copy-light.png` (the spec only if it changed). Options B and C add `ui/internal/render/blocks_text.go ui/internal/render/blocks_text_test.go` to the same `git add`.

```bash
git commit -m "rt-ui render: draw copy blocks as ruled so they paste clean

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Option A's message: `docs: say where a copy block pastes clean`.)

---

### Task 10: Every gate, and ship

**Files:** none beyond what a rebase touches.

**Interfaces:**
- Consumes: the finished branch, with Task 9 done.
- Produces: one PR against `m4ttstack/mattstack`.

- [ ] **Step 1: Confirm Task 9 is done**

If Task 9 is waiting on Decision D1, stop here and report it. The PR does not ship without the copy ruling.

- [ ] **Step 2: Rebase**

Run: `git fetch origin`
Run: `git rebase origin/main`

Another slice may have edited `AGENTS.md` "Output layer", the spec, or `docs/design/output-layer/README.md`. Merge by hand: keep their paragraphs and rows, then this plan's.

- [ ] **Step 3: Run every gate**

Run each from the repo root, one at a time:

- `bun run ui:build`
- `bun run ui:test`
- `bun run typecheck`
- `bun run test`
- `bun run test:e2e`
- `bun run test:pty`
- `bun run picker:check`
- `bun run format:check`
- `bun run check`

Expected: all pass. `bun run docs:gen` is not needed: no command description changed. Known noise, per the herd notes: about ten rotating load flakes in the unit suite (flavor-takeover, sync-stack-guard, git reset, setup-connect oauth, daemon-logdy-config) and the `rt plugin new` e2e on this machine. A failure in a file this plan did not touch that passes when its file runs alone is a flake; say so in the report with both results.

Then confirm no `--json` or payload path moved: `git diff origin/main...HEAD --stat -- commands/` must list only `commands/sync.ts`, with one changed line.

Then check for dashes. BSD grep has no `-P` and fails open, so write the diff to a file, `git diff origin/main...HEAD > <scratch>/5g/branch.diff`, and run `bun -e 'const dashes = String.fromCharCode(0x2013, 0x2014); const t = await Bun.file("<scratch>/5g/branch.diff").text(); const bad = t.split("\n").filter((l) => [...dashes].some((d) => l.includes(d))); console.log(bad.length ? bad.join("\n") : "none")'`. Expected: `none`.

- [ ] **Step 4: Measure the diff**

Run: `git diff --shortstat origin/main...HEAD`
Expected: about 1,350 changed lines (insertions plus deletions; the PNGs count as files, not lines). Put the number in the report. Over 2,500, stop and split along the cut in "Size" before pushing.

- [ ] **Step 5: Push**

Push the branch with the `git_push` MCP tool (one explicit refspec to the branch's same-named upstream).

- [ ] **Step 6: Open the PR**

Write the body to `<scratch>/pr-body-5g.md`, then run:

`gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 5g, renderer" --body-file <scratch>/pr-body-5g.md`

The body, in the style of PR 639: one framing paragraph (the shared renderer now reads right on a light and a dark terminal and on a narrow pane); bold-labelled bullet groups (**Palette**: the `Static*` tones, one palette for both backgrounds, dim and faint as one tone; **Wrapping**: words-only rows that break a long ref at a separator, hints that drop below whole, verbatim word wrap; **Narrow panes**: tables and trees that wrap their last column and clip a leading one, diff lines that wrap, `Clip`/`ClipOn` lifted to `textwrap`; **Blocks**: a closing command on its own callout row, failure details under their block, kv runs on one key column, the `blank` block, copy blocks as Matt ruled; **Also**: the inline spinner shim removed, a thrown cleared step ends on the neutral dot on an older helper); the renders (the regenerated `fixture` and `statuses` pages and the eight `5g-*` pairs); a verification line with the gate results and the measured diff; an **After pulling** line: run `bun run ui:build`, or the dev helper there rejects the `blank` block and the breadcrumb prints unstyled; and the last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 7: Report**

Report the PR url, the gate results, the flakes seen with both results, the measured diff size, the `StaticQuiet` value that shipped, and what each render showed, faults included. Do not merge: the shepherd watches CI and CodeRabbit and merges.

---

## Decisions this plan made that the items list and the spec do not settle

Each is the plan's best reading; Matt or the reviewer may overrule one before execution. Decision D1 (the copy rail) is Matt's and is above, not here.

1. **The palette values.** Seven `Static*` tones, each chosen at a mid luminance so it clears 3.5:1 on white and on `Bg` (the text tones 4:1). They keep the spec's hue names: mint, coral, peach, lavender. They are darker than the app palette on dark and lighter than a light-terminal palette would be on light, which is the price of one palette. The app views keep `Mint`, `Coral` and the rest on their own painted background.
2. **Dim and faint become one tone in static output.** No second gray clears 4:1 on both backgrounds and stays distinguishable from the first. The roles stay on the wire; they draw the same.
3. **The steps verb takes the static palette too,** since it also draws on the terminal's own background. Prompts (huh) also draw there and still use the app palette; they are not in this slice's scope and are named as a follow-up in the PR.
4. **A callout's closing command gets its own row** (item 4). Only when the command is the row's one command and its last segment. Rows with two commands keep them inline and wrap at spaces, because splitting a sentence around two commands leaves dangling words ("then run ... and"). Plain output keeps the row on one line.
5. **A hint with a word wider than its column drops below its title, whole,** rather than breaking at a separator in a narrow column or running inline out of alignment. Separator breaks are the last resort, for a word wider than the whole text column.
6. **kv runs align only with kv** (item 6). A `line` row's title follows a glyph and a kv key does not, so a shared column would push one off its own grid.
7. **Failure details move to the body column with no blank row and no rail** (item 5). The `why` and `next` bars and any excerpt already start there, so the block reads as one unit. Plain output keeps its layout: the details are already indented under a title at column 0, and plain verbatim captions stay at column 0, where agents and pinned tests read them.
8. **Tables clip leading columns down to 8 cells before the last column gives up wrapping,** and a row the floors still leave too wide is clipped whole. Clipping is lossy, but the alternative is the terminal wrapping a row flush left, which reads worse.
9. **Verbatim wraps at words now, and drops the spaces at a break.** `cutRows` kept every byte but split words; an excerpt is read, not re-run, so readable rows win. A token with no space and no separator is still cut between characters with nothing dropped.
10. **No helper version detection** (item 10). A cleared step after a throw sends `status: "failed"`, which costs nothing on a current helper and turns the misleading check into the neutral dot on an older one. A version handshake would mean a protocol change for a skew that only a source checkout with a stale `ui/dist` can hit.
11. **`commands/sync.ts`'s `BRANCH_GAP` moves to `out.blank()`** with the breadcrumb, though it is a verb file: it is the same workaround item 8 names, and its plain bytes do not change.
12. **The live step's sub-lines keep their ellipsis cut.** The erase on success counts one row per sub-line, so they cannot wrap; the mid-word breaks the renders showed came from `verbatim`, which Task 2 fixes.

## Size

| Task | Estimate (changed lines) |
|---|---|
| 1 Palette | 200 |
| 2 Wrapping | 220 |
| 3 Narrow panes | 380 |
| 4 Callout command row | 140 |
| 5 Failure details | 55 |
| 6 kv column | 140 |
| 7 Blank block | 80 |
| 8 Step runner | 100 |
| 9 Copy (option B; A is about 10, C about 40) | 30 |
| Total | about 1,350 |

Under 2,500: one PR. Were it to come in over, the cut is after Task 3: PR one is the palette, wrapping and narrow panes (Tasks 1 to 3, all Go, no wire change); PR two is the block shapes, the `blank` block, the step runner and the copy ruling (Tasks 4 to 9).

## Self-Review

**Spec coverage.** Items 1 to 11 each map to a task (the Scope table). Spec "Color roles" and Matt's one-palette ruling: Task 1, with the spec amended. Rule 6 (hints align): Task 6 extends it to kv. Rule 7 (rails): Task 1 (tone), Task 9 (copy, per D1). Rule 8 (spacing): Task 7. Rule 9 (diff keeps the mission coral): Task 1 keeps the diff on the app tints and its test on `missionCoral`. "Steps" (the `clear` flag and its old-helper behavior): Task 8. "Testing": a Go layout test per changed block, the coral rule test kept, the shared fixture extended from both languages (Task 7, Task 8), the pty gate re-run (Tasks 4, 5, 10), and renders for every drawing change ("Eyes").

**Placeholders.** None. `<repo>`, `<scratch>` and `<date of Matt's answer>` are the implementer's own paths and Matt's date, named as such. Task 9's code is given for every option; which one runs is Matt's ruling, not a gap.

**Type consistency.** `textwrap.Options{WordsOnly, Separators}`, `wordRows(s, width, seps)`, `breakAfter(row, seps)`, `textwrap.Clip(s, w)`, `textwrap.ClipOn(s, w, on)`, `separators`, `wrapCell(c, w)`, `codeRows(s, w)`, `longestWord(s)`, `fitColumns(widths, avail)`, `rowLines(row, widths, avail)`, `fitLine(s, avail)`, `clipFloor`, `diffRows(s, w)`, `calloutRows(line, w)`, `trailingCommand`, `onlyCommands`, `widestCommand`, `withCommandSpaces(rows, from, to)`, `nbsp`, `kvRun(run)`, `runEnd(bs, i, types...)`, `out.blank()`, `StepHandle.clear(opts?: { thrown?: boolean })` and the theme names `StaticMint`, `StaticCoral`, `StaticPeach`, `StaticLav`, `StaticCyan`, `StaticQuiet`, `StaticRule` are spelled the same in every Interfaces block, the code and the tests. The SGR fragments in the tests match the hex values in Task 1's Interfaces block.

**Review Focus.** Five lines, each pinned to a named test in Tasks 2, 3, 4 and 7.
