# rt Output Layer, Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the output layer itself (a Go `rt-ui render` verb, a TS `lib/ui/out.ts` module, a plain fallback, a `sub` step event and a ratchet guard) without converting any command.

**Architecture:** TypeScript builds semantic blocks (data only, no colors) and pipes them as NDJSON to a one-shot `rt-ui render`, which prints them in the rt-ui theme. `out.ts` owns the human gate, the stream choice and a plain-text fallback used off a TTY or when the helper is missing or fails. A guard test with a shrinking allowlist stops new raw printing.

**Tech Stack:** Bun + TypeScript (`lib/ui/`), Go 1.26 with lipgloss v2, `charmbracelet/x/ansi`, `charmbracelet/colorprofile` (`ui/`), `bun:test`, `go test`.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (ticket RT-369). This plan covers the spec's phase 1 only. Phases 2 to 6 get their own plans once this API exists.

## Global Constraints

- Never use em dashes or en dashes in any file, comment, test name or commit message. Use "..." or rephrase.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show. No narration, no task numbers, no decision history.
- The TS side holds no colors and no glyph styling. `lib/ui/out.ts` and `lib/ui/out-plain.ts` never import `lib/ansi.ts`, `lib/tui.ts` or `lib/tui/palette.ts`.
- All Go styling comes from `ui/internal/theme`. Do not add hex colors anywhere else.
- Tables and trees are laid out by `ui/internal/render` itself (lipgloss supplies styling and width math). Do not import `lipgloss/table` or `lipgloss/tree`.
- Status set, exactly these ten: `done`, `failed`, `needs-you`, `pending`, `stale`, `refused`, `off`, `skipped`, `running`, `warn`.
- Coral (`theme.Coral`) is used only for `failed`, the `failure` block, the `banner` block and deleted diff lines.
- `--json` output of every existing command must not change. This phase converts no command.
- Run `bun test` only from the repo root. Run Go commands from `ui/`.
- After any change under `ui/`, run `bun run ui:build` before running TS tests that spawn the real helper.
- Format before each commit: `gofmt -w` on changed Go files. rt's own TS, JSON and Markdown are outside prettier (`.prettierignore` lists `/lib`, `/commands`, `/ui`, `docs` and `/*.md`), so match the surrounding style by hand: double quotes, two-space indent, long lines left unwrapped.
- Body text, titles and commands use the terminal's default foreground so output reads on light and dark terminals: `textStyle`, `strongStyle` and `commandStyle` set no color. Only accents take theme colors.
- End every commit message with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Sample data in tests is invented. Do not use real team, person or host names.

## Review Focus

1. **Untrusted text carrying escape sequences.** A branch name or a line of child output containing `\x1b[2J` must print as plain characters and must not repaint the terminal. Pinned in Task 2 (`TestTextIsCleanedOfEscapesAndControls`) for the styled path and Task 7 (`plain output is cleaned of escapes and controls`) for the fallback.
2. **Version skew between rt and rt-ui.** An older helper with no `render` verb, or a newer block type the helper does not know, must leave the person with the same words in plain text, never an error or partial styled output. Pinned in Task 5 (`TestUnknownBlockExitsTwoWithNoOutput`) and Task 8 (`falls back to plain when the helper exits non-zero`).
3. **Wide characters in aligned columns.** CJK text or emoji in a table cell must still line up. Pinned in Task 3 (`TestTableAlignsByDisplayWidth`).
4. **A sub-line wider than the terminal.** A long streamed line must not wrap, or the erase on success leaves fragments behind. Pinned in Task 6 (`TestLongSubLineIsTruncatedAndErased`).
5. **Empty input.** A render call with no blocks, a table with no rows and a section with no children must print nothing extra and exit 0. Pinned in Task 3 (`TestEmptyTableAndSectionPrintNothingExtra`), Task 5 (`TestHelloOnlyPrintsNothing`) and Task 8 (`print with no blocks writes nothing`).

## File Structure

| File | Responsibility |
|---|---|
| `ui/fixtures/render-document.json` (create) | One example of every block type; the wire contract both languages test against |
| `ui/internal/protocol/render.go` (create) | Go wire types for blocks, `DecodeBlock` |
| `ui/internal/protocol/render_test.go` (create) | Fixture round-trip, rejection of unknown types |
| `lib/ui/protocol.ts` (modify) | TS wire types for blocks, the `sub` step event |
| `lib/ui/__tests__/protocol.test.ts` (modify) | TS fixture round-trip |
| `ui/internal/render/render.go` (create) | `Render`, block dispatch, spacing |
| `ui/internal/render/style.go` (create) | Status table, roles, `Clean`, cell rendering |
| `ui/internal/render/blocks_basic.go` (create) | line, callout, kv, summary, banner, failure |
| `ui/internal/render/blocks_layout.go` (create) | table, tree, section, changes |
| `ui/internal/render/blocks_text.go` (create) | paragraph, copy, verbatim, diff |
| `ui/internal/render/*_test.go` (create) | One test file per source file, plus `verb_test.go` |
| `ui/cmd/rt-ui/main.go`, `verbs.go` (modify) | The `render` verb |
| `ui/internal/steps/steps.go` (modify) | The `sub` event |
| `lib/ui/spawn.ts`, `lib/ui/steps.ts` (modify) | `StepHandle.sub`, the task's `sub` callback |
| `lib/ui/out-plain.ts` (create) | Plain-text renderer for the same blocks |
| `lib/ui/out.ts` (create) | Block builders, gate, spawn, fallback, `print`, `fail`, `json`, `payload` |
| `lib/ui/__tests__/fake-rt-ui.ts` (modify) | A `render` verb for the fake helper |
| `lib/__tests__/no-raw-output.test.ts`, `raw-output-allowlist.json` (create) | The ratchet guard |
| `AGENTS.md` (modify) | The "Output layer" section |

---

### Task 1: Wire protocol for blocks

**Files:**
- Create: `ui/fixtures/render-document.json`
- Create: `ui/internal/protocol/render.go`
- Create: `ui/internal/protocol/render_test.go`
- Modify: `lib/ui/protocol.ts` (append after the `StepEvent` type)
- Modify: `lib/ui/__tests__/protocol.test.ts` (append)

**Interfaces:**
- Consumes: `protocol.ErrBadSpec`, `protocol.Version` (existing, `ui/internal/protocol/protocol.go`); `encodeLine`, `PROTOCOL_VERSION` (existing, `lib/ui/protocol.ts`).
- Produces (Go): `protocol.Segment{Text, Role, URL}`, `protocol.Cell` (`[]Segment`), `protocol.TableRow{Cells, Group}`, `protocol.ChangeRow{Op, Name, Hint}`, `protocol.DiffLine{Kind, Text}`, `protocol.DiffHunk{Header, Lines}`, `protocol.Block`, `protocol.DecodeBlock(line []byte) (Block, error)`.
- Produces (TS): `RenderStatus`, `SegmentRole`, `Segment`, `Cell`, `CalloutLabel`, `TableRow`, `ChangeRow`, `DiffLine`, `DiffHunk`, `Block`, `BLOCK_TYPES`.

- [ ] **Step 1: Write the fixture**

Create `ui/fixtures/render-document.json`:

```json
[
  { "t": "line", "status": "done", "title": "Skills linked", "hint": "16 skills" },
  { "t": "callout", "label": "next", "body": [[{ "text": "rt setup slack connect", "role": "command" }]] },
  { "t": "kv", "key": "rt.worktreeApp", "value": "true", "source": "from team example" },
  {
    "t": "table",
    "headers": ["KEY", "VALUE"],
    "rows": [
      { "group": "USER" },
      { "cells": [[{ "text": "chat.humanHandle", "role": "key" }], [{ "text": "sam" }]] }
    ]
  },
  {
    "t": "tree",
    "root": [{ "text": "rt.worktreeApp", "role": "key" }],
    "children": [[[{ "text": "user" }], [{ "text": "not set", "role": "faint" }]]]
  },
  {
    "t": "section",
    "title": "Accounts",
    "subtitle": "1 of 2 connected",
    "blocks": [{ "t": "line", "status": "needs-you", "title": "Slack", "hint": "not connected" }]
  },
  { "t": "summary", "status": "needs-you", "title": "Setup needs you", "counts": ["5 ready", "1 needs you"] },
  { "t": "paragraph", "text": "Two skills disagree about when to push." },
  { "t": "copy", "text": "example://join?invite=abc123", "caption": "send this link" },
  { "t": "verbatim", "lines": ["{", "  \"sound\": \"glass\"", "}"], "caption": "value" },
  { "t": "changes", "changes": [{ "op": "+", "name": "review", "hint": "now public" }, { "op": "-", "name": "triage" }] },
  {
    "t": "diff",
    "hunks": [
      {
        "header": "@@ -1,2 +1,2 @@",
        "lines": [
          { "kind": "context", "text": "const a = 1;" },
          { "kind": "del", "text": "old();" },
          { "kind": "add", "text": "next();" }
        ]
      }
    ]
  },
  { "t": "banner", "label": "PRODUCTION", "subject": "db-replica", "hint": "type the name to confirm" },
  {
    "t": "failure",
    "title": "This Mac cannot read the team's secrets yet",
    "hint": "example team",
    "why": "No key on this machine matches.",
    "next": [{ "text": "rt setup status", "role": "command" }],
    "details": "details are in the log"
  }
]
```

The fixture holds exactly one block of each of the 14 types.

- [ ] **Step 2: Write the failing Go test**

Create `ui/internal/protocol/render_test.go`:

```go
package protocol

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestRenderFixtureDecodesAndReencodes(t *testing.T) {
	var raws []json.RawMessage
	if err := json.Unmarshal(fixture(t, "render-document.json"), &raws); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, raw := range raws {
		b, err := DecodeBlock(raw)
		if err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
		seen[b.T] = true
		back, err := json.Marshal(b)
		if err != nil {
			t.Fatal(err)
		}
		if canonical(t, back) != canonical(t, raw) {
			t.Fatalf("re-encode drift\n got %s\nwant %s", back, raw)
		}
	}
	for _, name := range []string{"line", "callout", "kv", "table", "tree", "section", "summary", "paragraph", "copy", "verbatim", "changes", "diff", "banner", "failure"} {
		if !seen[name] {
			t.Fatalf("fixture has no %q block", name)
		}
	}
}

func TestDecodeBlockRejectsUnknownTypesAtAnyDepth(t *testing.T) {
	for _, line := range []string{
		`{"t":"sparkline"}`,
		`{"t":"section","title":"x","blocks":[{"t":"sparkline"}]}`,
		`not json`,
	} {
		if _, err := DecodeBlock([]byte(line)); !errors.Is(err, ErrBadSpec) {
			t.Fatalf("%s: err %v, want ErrBadSpec", line, err)
		}
	}
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd ui && go test ./internal/protocol/ -run 'Render|DecodeBlock'`
Expected: FAIL to compile with `undefined: DecodeBlock`.

- [ ] **Step 4: Write the Go types**

Create `ui/internal/protocol/render.go`:

```go
package protocol

import (
	"encoding/json"
	"fmt"
)

type Segment struct {
	Text string `json:"text"`
	Role string `json:"role,omitempty"`
	URL  string `json:"url,omitempty"`
}

type Cell []Segment

// TableRow is a row of cells or a group label; exactly one is set.
type TableRow struct {
	Cells []Cell `json:"cells,omitempty"`
	Group string `json:"group,omitempty"`
}

type ChangeRow struct {
	Op   string `json:"op"`
	Name string `json:"name"`
	Hint string `json:"hint,omitempty"`
}

type DiffLine struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

type DiffHunk struct {
	Header string     `json:"header"`
	Lines  []DiffLine `json:"lines"`
}

// Block is the union of every render block; unused fields stay zero and are
// omitted on re-encode so the fixture round-trips.
type Block struct {
	T string `json:"t"`

	Status   string      `json:"status,omitempty"`
	Title    string      `json:"title,omitempty"`
	Subtitle string      `json:"subtitle,omitempty"`
	Hint     string      `json:"hint,omitempty"`
	Label    string      `json:"label,omitempty"`
	Body     []Cell      `json:"body,omitempty"`
	Key      string      `json:"key,omitempty"`
	Value    string      `json:"value,omitempty"`
	Source   string      `json:"source,omitempty"`
	Headers  []string    `json:"headers,omitempty"`
	Rows     []TableRow  `json:"rows,omitempty"`
	Root     Cell        `json:"root,omitempty"`
	Children [][]Cell    `json:"children,omitempty"`
	Blocks   []Block     `json:"blocks,omitempty"`
	Counts   []string    `json:"counts,omitempty"`
	Text     string      `json:"text,omitempty"`
	Caption  string      `json:"caption,omitempty"`
	Lines    []string    `json:"lines,omitempty"`
	Changes  []ChangeRow `json:"changes,omitempty"`
	Hunks    []DiffHunk  `json:"hunks,omitempty"`
	Subject  string      `json:"subject,omitempty"`
	Why      string      `json:"why,omitempty"`
	Next     Cell        `json:"next,omitempty"`
	Details  string      `json:"details,omitempty"`
}

var blockTypes = map[string]bool{
	"line": true, "callout": true, "kv": true, "table": true, "tree": true,
	"section": true, "summary": true, "paragraph": true, "copy": true,
	"verbatim": true, "changes": true, "diff": true, "banner": true, "failure": true,
}

func DecodeBlock(line []byte) (Block, error) {
	var b Block
	if err := json.Unmarshal(line, &b); err != nil {
		return b, fmt.Errorf("%w: %v", ErrBadSpec, err)
	}
	if err := checkBlock(b); err != nil {
		return b, err
	}
	return b, nil
}

func checkBlock(b Block) error {
	if !blockTypes[b.T] {
		return fmt.Errorf("%w: block t=%q", ErrBadSpec, b.T)
	}
	for _, child := range b.Blocks {
		if err := checkBlock(child); err != nil {
			return err
		}
	}
	return nil
}
```

- [ ] **Step 5: Run the Go test to verify it passes**

Run: `cd ui && go test ./internal/protocol/`
Expected: `ok  rt-ui/internal/protocol`

- [ ] **Step 6: Write the failing TS test**

Append to `lib/ui/__tests__/protocol.test.ts`, and add `type Block` and `BLOCK_TYPES` to the existing import from `../protocol.ts`:

```ts
test("the render fixture carries one of every block type and round-trips through encodeLine", () => {
  const blocks = fixture("render-document.json") as Block[];
  expect(new Set(blocks.map((b) => b.t))).toEqual(new Set(BLOCK_TYPES));
  for (const b of blocks) {
    const line = encodeLine(b);
    expect(line.slice(0, -1).includes("\n")).toBe(false);
    expect(JSON.parse(line)).toEqual(b);
  }
});
```

- [ ] **Step 7: Run it to verify it fails**

Run (repo root): `bun test lib/ui/__tests__/protocol.test.ts`
Expected: FAIL, `BLOCK_TYPES` is not exported.

- [ ] **Step 8: Write the TS types**

In `lib/ui/protocol.ts`, insert after the `StepEvent` type:

```ts
// ─── render ──────────────────────────────────────────────────────────────────

export type RenderStatus = "done" | "failed" | "needs-you" | "pending" | "stale" | "refused" | "off" | "skipped" | "running" | "warn";

export type SegmentRole = "text" | "strong" | "dim" | "faint" | "key" | "command" | "link" | RenderStatus;

export interface Segment {
  text: string;
  role?: SegmentRole;
  /** Only read for role "link". */
  url?: string;
}

export type Cell = Segment[];

export type CalloutLabel = "tip" | "next" | "fix" | "why" | "note";

export type TableRow = { cells: Cell[] } | { group: string };

export interface ChangeRow {
  op: "+" | "-";
  name: string;
  hint?: string;
}

export interface DiffLine {
  kind: "context" | "add" | "del";
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export type Block =
  | { t: "line"; status: RenderStatus; title: string; hint?: string }
  | { t: "callout"; label: CalloutLabel; body: Cell[] }
  | { t: "kv"; key: string; value?: string; source?: string }
  | { t: "table"; headers?: string[]; rows: TableRow[] }
  | { t: "tree"; root: Cell; children: Cell[][] }
  | { t: "section"; title: string; subtitle?: string; blocks: Block[] }
  | { t: "summary"; status: RenderStatus; title: string; counts?: string[] }
  | { t: "paragraph"; text: string }
  | { t: "copy"; text: string; caption?: string }
  | { t: "verbatim"; lines: string[]; caption?: string }
  | { t: "changes"; changes: ChangeRow[] }
  | { t: "diff"; hunks: DiffHunk[] }
  | { t: "banner"; label: string; subject: string; hint?: string }
  | { t: "failure"; title: string; hint?: string; why?: string; next?: Cell; details?: string };

export const BLOCK_TYPES = ["line", "callout", "kv", "table", "tree", "section", "summary", "paragraph", "copy", "verbatim", "changes", "diff", "banner", "failure"] as const satisfies ReadonlyArray<Block["t"]>;
```

- [ ] **Step 9: Run both suites**

Run: `bun test lib/ui/__tests__/protocol.test.ts` then `cd ui && go test ./internal/protocol/`
Expected: both PASS.

- [ ] **Step 10: Commit**

```bash
gofmt -w ui/internal/protocol/render.go ui/internal/protocol/render_test.go
git add ui/fixtures/render-document.json ui/internal/protocol/render.go ui/internal/protocol/render_test.go lib/ui/protocol.ts lib/ui/__tests__/protocol.test.ts
git commit -m "rt-ui: wire types for render blocks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Go renderer core (statuses, cells, line, callout, kv, summary, banner, failure)

**Files:**
- Create: `ui/internal/render/style.go`
- Create: `ui/internal/render/render.go`
- Create: `ui/internal/render/blocks_basic.go`
- Create: `ui/internal/render/blocks_basic_test.go`

**Interfaces:**
- Consumes: `protocol.Block`, `protocol.Cell`, `protocol.Segment` (Task 1); `theme.*` colors and glyphs (existing).
- Produces: `render.Options{Width int}`, `render.Render(blocks []protocol.Block, opts Options) string` (styled text, each line newline-terminated, no leading or trailing blank line), `render.Clean(s string) string`, `render.Glyph(status string) string` (the styled glyph for a status; a dim dot for an unknown one). Internal helpers later tasks use: `(*renderer).emit(string)`, `(*renderer).gap()`, `(*renderer).blocks([]protocol.Block)`, `cell(protocol.Cell) string`, `pad(s string, w int) string`, `joinCells(cells []string, widths []int) string`, and the styles `textStyle`, `strongStyle`, `dimStyle`, `faintStyle`, `keyStyle`, `ruleStyle`, `railStyle`, `fg`.

- [ ] **Step 1: Write the failing tests**

Create `ui/internal/render/blocks_basic_test.go`:

```go
package render_test

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/protocol"
	"rt-ui/internal/render"
)

const coral = "255;121;121"

func styled(bs ...protocol.Block) string {
	return render.Render(bs, render.Options{Width: 80})
}

func plain(bs ...protocol.Block) string {
	return ansi.Strip(styled(bs...))
}

func cmd(s string) protocol.Cell  { return protocol.Cell{{Text: s, Role: "command"}} }
func text(s string) protocol.Cell { return protocol.Cell{{Text: s}} }

func TestConsecutiveLinesAlignTheirHints(t *testing.T) {
	got := plain(
		protocol.Block{T: "line", Status: "done", Title: "pre-commit", Hint: "on"},
		protocol.Block{T: "line", Status: "off", Title: "pre-push", Hint: "off, you turned it off"},
	)
	want := "  ✓ pre-commit  on\n  ○ pre-push    off, you turned it off\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestLineWithoutHintIsNotPadded(t *testing.T) {
	got := plain(
		protocol.Block{T: "line", Status: "done", Title: "short"},
		protocol.Block{T: "line", Status: "done", Title: "a much longer title", Hint: "h"},
	)
	want := "  ✓ short\n  ✓ a much longer title  h\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestCalloutAttachesUnderALineAndKeepsTheRunAligned(t *testing.T) {
	got := plain(
		protocol.Block{T: "line", Status: "needs-you", Title: "Slack", Hint: "not connected"},
		protocol.Block{T: "callout", Label: "next", Body: []protocol.Cell{cmd("rt setup slack connect")}},
		protocol.Block{T: "line", Status: "pending", Title: "Linear", Hint: "not connected yet"},
	)
	want := "  ◆ Slack   not connected\n    ▌ next rt setup slack connect\n  ◌ Linear  not connected yet\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestCalloutContinuationLinesIndentPastTheLabel(t *testing.T) {
	got := plain(protocol.Block{T: "callout", Label: "tip", Body: []protocol.Cell{text("Saved on this Mac only."), text("second line")}})
	want := "    ▌ tip Saved on this Mac only.\n    ▌     second line\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestKvPrintsSourceOnItsOwnLine(t *testing.T) {
	got := plain(protocol.Block{T: "kv", Key: "rt.worktreeApp", Value: "true", Source: "from team example"})
	want := "  rt.worktreeApp  true\n  from team example\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestKvWithoutAValuePrintsOnlyTheKey(t *testing.T) {
	if got := plain(protocol.Block{T: "kv", Key: "rt.notifications"}); got != "  rt.notifications\n" {
		t.Fatalf("got %q", got)
	}
}

func TestSummaryGetsABlankLineBeforeItUnlessFirst(t *testing.T) {
	sum := protocol.Block{T: "summary", Status: "needs-you", Title: "Setup needs you", Counts: []string{"5 ready", "1 needs you"}}
	if got := plain(sum); got != "  ◆ Setup needs you  5 ready · 1 needs you\n" {
		t.Fatalf("first: %q", got)
	}
	got := plain(protocol.Block{T: "line", Status: "done", Title: "a"}, sum)
	want := "  ✓ a\n\n  ◆ Setup needs you  5 ready · 1 needs you\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestBanner(t *testing.T) {
	got := plain(protocol.Block{T: "banner", Label: "PRODUCTION", Subject: "db-replica", Hint: "type the name to confirm"})
	if got != "  ▌ PRODUCTION db-replica  type the name to confirm\n" {
		t.Fatalf("got %q", got)
	}
}

func TestFailureShowsWhyNextAndDetails(t *testing.T) {
	got := plain(protocol.Block{
		T: "failure", Title: "This Mac cannot read the team's secrets yet",
		Why: "No key on this machine matches.", Next: cmd("rt setup status"), Details: "details are in the log",
	})
	want := "  ✗ This Mac cannot read the team's secrets yet\n" +
		"    ▌ why No key on this machine matches.\n" +
		"    ▌ next rt setup status\n" +
		"\n" +
		"  details are in the log\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestOnlyFailedUsesCoral(t *testing.T) {
	if !strings.Contains(styled(protocol.Block{T: "line", Status: "failed", Title: "x"}), coral) {
		t.Fatal("failed line is not coral")
	}
	for _, s := range []string{"done", "needs-you", "pending", "stale", "refused", "off", "skipped", "running", "warn"} {
		if strings.Contains(styled(protocol.Block{T: "line", Status: s, Title: "x", Hint: "h"}), coral) {
			t.Fatalf("status %q rendered coral", s)
		}
	}
	for _, label := range []string{"tip", "next", "fix", "why", "note"} {
		if strings.Contains(styled(protocol.Block{T: "callout", Label: label, Body: []protocol.Cell{text("x")}}), coral) {
			t.Fatalf("callout %q rendered coral", label)
		}
	}
}

func TestUnknownStatusFallsBackToADot(t *testing.T) {
	if got := plain(protocol.Block{T: "line", Status: "mystery", Title: "x"}); got != "  • x\n" {
		t.Fatalf("got %q", got)
	}
}

func TestTextIsCleanedOfEscapesAndControls(t *testing.T) {
	out := styled(protocol.Block{T: "line", Status: "done", Title: "evil\x1b[2Jname\x07\u009b", Hint: "a\tb"})
	if strings.Contains(out, "\x1b[2J") || strings.Contains(out, "\x07") {
		t.Fatalf("control sequence survived: %q", out)
	}
	if got := ansi.Strip(out); got != "  ✓ evilname  a b\n" {
		t.Fatalf("got %q", got)
	}
}

func TestLinkSegmentEmitsAHyperlinkAndCleansItsURL(t *testing.T) {
	out := styled(protocol.Block{T: "callout", Label: "note", Body: []protocol.Cell{{{Text: "docs", Role: "link", URL: "https://example.com/\x1b[2Jdocs"}}}})
	if !strings.Contains(out, "\x1b]8;;https://example.com/docs") {
		t.Fatalf("no OSC 8 link: %q", out)
	}
	if strings.Contains(out, "\x1b[2J") {
		t.Fatalf("escape survived in the URL: %q", out)
	}
}

func TestBodyTextUsesTheTerminalDefaultForeground(t *testing.T) {
	if got := styled(protocol.Block{T: "paragraph", Text: "plain words"}); strings.Contains(got, "\x1b[38") {
		t.Fatalf("a paragraph set a foreground color: %q", got)
	}
	out := styled(
		protocol.Block{T: "line", Status: "done", Title: "Skills linked"},
		protocol.Block{T: "kv", Key: "k", Value: "v"},
		protocol.Block{T: "callout", Label: "next", Body: []protocol.Cell{cmd("rt setup status")}},
	)
	for _, fixed := range []string{"230;224;255", "210;205;235"} {
		if strings.Contains(out, fixed) {
			t.Fatalf("body text painted with a fixed light color %s: %q", fixed, out)
		}
	}
}

func TestNoLeadingOrTrailingBlankLines(t *testing.T) {
	out := plain(protocol.Block{T: "line", Status: "done", Title: "x"})
	if strings.HasPrefix(out, "\n") || strings.HasSuffix(out, "\n\n") {
		t.Fatalf("stray blank line: %q", out)
	}
	if styled() != "" {
		t.Fatalf("no blocks should render nothing")
	}
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd ui && go test ./internal/render/`
Expected: FAIL, package `rt-ui/internal/render` does not exist. (`TestBodyTextUsesTheTerminalDefaultForeground` uses a paragraph, which Task 4 renders; until then it passes on empty output, and Task 4 makes it bite.)

- [ ] **Step 3: Write `style.go`**

Create `ui/internal/render/style.go`:

```go
// Package render prints rt's static output blocks in the rt-ui theme. It
// never reads keys and never takes the screen.
package render

import (
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/protocol"
	"rt-ui/internal/theme"
)

const indent = "  "

type statusDef struct {
	glyph string
	color color.Color
}

// Glyphs avoid Nerd Font code points and filled shapes: they must read in
// any terminal font, at the same weight as ✓ and ✗.
var statuses = map[string]statusDef{
	"done":      {theme.GlyphDone, theme.Mint},
	"failed":    {theme.GlyphCrashed, theme.Coral},
	"needs-you": {"◆", theme.Peach},
	"pending":   {"◌", theme.Dim},
	"stale":     {"↻", theme.Peach},
	"refused":   {"⊘", theme.Dim},
	"off":       {theme.GlyphStopped, theme.Dim},
	"skipped":   {"-", theme.Faint},
	"running":   {theme.GlyphRunning, theme.Mint},
	"warn":      {"!", theme.Peach},
}

func fg(c color.Color) lipgloss.Style { return lipgloss.NewStyle().Foreground(c) }

// Body text, titles and commands set no color: they take the terminal's own
// foreground, so they read on a light background as well as a dark one.
var (
	textStyle    = lipgloss.NewStyle()
	strongStyle  = lipgloss.NewStyle().Bold(true)
	commandStyle = lipgloss.NewStyle().Bold(true)
	dimStyle     = fg(theme.Dimmer)
	faintStyle   = fg(theme.Faint)
	keyStyle     = fg(theme.Lav)
	linkStyle    = fg(theme.Cyan).Underline(true)
	ruleStyle    = fg(theme.Rule)
	railStyle    = fg(theme.Panel)
)

// Glyph is the styled glyph for a status; an unknown status gets a dim dot.
func Glyph(status string) string {
	d, ok := statuses[status]
	if !ok {
		return faintStyle.Render("•")
	}
	return fg(d.color).Render(d.glyph)
}

func glyph(status string) string { return Glyph(status) }

// Clean strips escape sequences and control characters, so text that came
// from a branch name or a child process cannot repaint the terminal.
func Clean(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r == '\t':
			return ' '
		case r < 0x20 || (r >= 0x7f && r <= 0x9f):
			return -1
		}
		return r
	}, ansi.Strip(s))
}

func segment(s protocol.Segment) string {
	t := Clean(s.Text)
	switch s.Role {
	case "strong":
		return strongStyle.Render(t)
	case "dim":
		return dimStyle.Render(t)
	case "faint":
		return faintStyle.Render(t)
	case "key":
		return keyStyle.Render(t)
	case "command":
		return commandStyle.Render(t)
	case "link":
		if u := Clean(s.URL); u != "" {
			return ansi.SetHyperlink(u) + linkStyle.Render(t) + ansi.ResetHyperlink()
		}
		return linkStyle.Render(t)
	}
	if d, ok := statuses[s.Role]; ok {
		return fg(d.color).Render(t)
	}
	return textStyle.Render(t)
}

func cell(c protocol.Cell) string {
	var b strings.Builder
	for _, s := range c {
		b.WriteString(segment(s))
	}
	return b.String()
}

func pad(s string, w int) string {
	if n := w - lipgloss.Width(s); n > 0 {
		return s + strings.Repeat(" ", n)
	}
	return s
}

// joinCells pads every cell but the last to its column width.
func joinCells(cells []string, widths []int) string {
	var b strings.Builder
	for i, c := range cells {
		if i > 0 {
			b.WriteString("  ")
		}
		if i == len(cells)-1 {
			b.WriteString(c)
		} else {
			b.WriteString(pad(c, widths[i]))
		}
	}
	return b.String()
}
```

- [ ] **Step 4: Write `render.go`**

Create `ui/internal/render/render.go`:

```go
package render

import (
	"strings"

	"rt-ui/internal/protocol"
)

type Options struct {
	// Width is the terminal's column count; values under 20 fall back to 80.
	Width int
}

type renderer struct {
	width int
	out   strings.Builder
}

// Render returns the styled text for blocks: every line newline-terminated,
// no leading or trailing blank line.
func Render(blocks []protocol.Block, opts Options) string {
	w := opts.Width
	if w < 20 {
		w = 80
	}
	r := &renderer{width: w}
	r.blocks(blocks)
	return r.out.String()
}

func (r *renderer) emit(s string) {
	r.out.WriteString(s)
	r.out.WriteByte('\n')
}

// gap writes one blank line, never at the top and never two in a row.
func (r *renderer) gap() {
	s := r.out.String()
	if s == "" || strings.HasSuffix(s, "\n\n") {
		return
	}
	r.out.WriteByte('\n')
}

func (r *renderer) blocks(bs []protocol.Block) {
	for i := 0; i < len(bs); i++ {
		if bs[i].T != "line" {
			r.block(bs[i])
			continue
		}
		j := i
		for j < len(bs) && (bs[j].T == "line" || bs[j].T == "callout") {
			j++
		}
		r.lineRun(bs[i:j])
		i = j - 1
	}
}

func (r *renderer) block(b protocol.Block) {
	switch b.T {
	case "callout":
		r.callout(b)
	case "kv":
		r.kv(b)
	case "summary":
		r.summary(b)
	case "banner":
		r.banner(b)
	case "failure":
		r.failure(b)
	}
}
```

- [ ] **Step 5: Write `blocks_basic.go`**

Create `ui/internal/render/blocks_basic.go`:

```go
package render

import (
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/theme"
)

const calloutIndent = "    "

// lineRun renders consecutive lines, with any callouts between them, and
// pads hinted titles to one width so the hints line up.
func (r *renderer) lineRun(run []protocol.Block) {
	w := 0
	for _, b := range run {
		if b.T == "line" && b.Hint != "" {
			w = max(w, lipgloss.Width(Clean(b.Title)))
		}
	}
	for _, b := range run {
		if b.T == "callout" {
			r.callout(b)
			continue
		}
		head := indent + glyph(b.Status) + " "
		title := Clean(b.Title)
		if b.Hint == "" {
			r.emit(head + textStyle.Render(title))
			continue
		}
		r.emit(head + textStyle.Render(pad(title, w)) + "  " + faintStyle.Render(Clean(b.Hint)))
	}
}

func calloutColor(label string) color.Color {
	switch label {
	case "next", "fix":
		return theme.Peach
	case "why":
		return theme.Dimmer
	}
	return theme.Lav
}

func (r *renderer) callout(b protocol.Block) {
	r.calloutLines(calloutColor(b.Label), b.Label, b.Body)
}

func (r *renderer) calloutLines(c color.Color, label string, body []protocol.Cell) {
	label = Clean(label)
	bar := calloutIndent + fg(c).Render(theme.GlyphBar) + " "
	for i, line := range body {
		if i == 0 {
			r.emit(bar + fg(c).Render(label) + " " + cell(line))
			continue
		}
		r.emit(bar + strings.Repeat(" ", lipgloss.Width(label)+1) + cell(line))
	}
}

func (r *renderer) kv(b protocol.Block) {
	s := indent + keyStyle.Render(Clean(b.Key))
	if b.Value != "" {
		s += "  " + strongStyle.Render(Clean(b.Value))
	}
	r.emit(s)
	if b.Source != "" {
		r.emit(indent + faintStyle.Render(Clean(b.Source)))
	}
}

func (r *renderer) summary(b protocol.Block) {
	r.gap()
	s := indent + glyph(b.Status) + " " + strongStyle.Render(Clean(b.Title))
	if len(b.Counts) > 0 {
		counts := make([]string, len(b.Counts))
		for i, c := range b.Counts {
			counts[i] = Clean(c)
		}
		s += "  " + faintStyle.Render(strings.Join(counts, " · "))
	}
	r.emit(s)
}

func (r *renderer) banner(b protocol.Block) {
	s := indent + fg(theme.Coral).Bold(true).Render(theme.GlyphBar+" "+Clean(b.Label)) + " " + strongStyle.Render(Clean(b.Subject))
	if b.Hint != "" {
		s += "  " + faintStyle.Render(Clean(b.Hint))
	}
	r.emit(s)
}

func (r *renderer) failure(b protocol.Block) {
	s := indent + glyph("failed") + " " + textStyle.Render(Clean(b.Title))
	if b.Hint != "" {
		s += "  " + faintStyle.Render(Clean(b.Hint))
	}
	r.emit(s)
	if b.Why != "" {
		r.calloutLines(theme.Dimmer, "why", []protocol.Cell{{{Text: b.Why}}})
	}
	if len(b.Next) > 0 {
		r.calloutLines(theme.Peach, "next", []protocol.Cell{b.Next})
	}
	if b.Details != "" {
		r.gap()
		r.emit(indent + faintStyle.Render(Clean(b.Details)))
	}
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd ui && go vet ./internal/render/ && go test ./internal/render/`
Expected: `ok  rt-ui/internal/render`.

- [ ] **Step 7: Commit**

```bash
gofmt -w ui/internal/render/
git add ui/internal/render/
git commit -m "rt-ui: render core, statuses and the basic blocks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Go renderer layout blocks (table, tree, section, changes)

**Files:**
- Create: `ui/internal/render/blocks_layout.go`
- Create: `ui/internal/render/blocks_layout_test.go`
- Modify: `ui/internal/render/render.go` (the `block` switch)

**Interfaces:**
- Consumes: `(*renderer).emit`, `gap`, `blocks`, `cell`, `pad`, `joinCells`, `Clean`, the styles and `indent` (Task 2).
- Produces: rendering for `table`, `tree`, `section`, `changes`. No new exported names.

- [ ] **Step 1: Write the failing tests**

Create `ui/internal/render/blocks_layout_test.go`. It reuses `plain`, `styled`, `text`, `coral` from `blocks_basic_test.go` (same package `render_test`).

```go
package render_test

import (
	"fmt"
	"strings"
	"testing"

	"rt-ui/internal/protocol"
)

func cells(vals ...string) protocol.TableRow {
	row := protocol.TableRow{}
	for _, v := range vals {
		row.Cells = append(row.Cells, text(v))
	}
	return row
}

func TestTableWithHeadersAndARule(t *testing.T) {
	got := plain(protocol.Block{T: "table", Headers: []string{"KEY", "VALUE", "FROM"}, Rows: []protocol.TableRow{
		cells("rt.worktreeApp", "true", "team example"),
		cells("rt.repoRoots", "~/code", "machine"),
	}})
	row := func(a, b, c string) string { return fmt.Sprintf("  %-14s  %-6s  %s\n", a, b, c) }
	want := row("KEY", "VALUE", "FROM") +
		"  " + strings.Repeat("─", 14+2+6+2+12) + "\n" +
		row("rt.worktreeApp", "true", "team example") +
		row("rt.repoRoots", "~/code", "machine")
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}

func TestHeaderlessTableWithGroupLabels(t *testing.T) {
	got := plain(protocol.Block{T: "table", Rows: []protocol.TableRow{
		{Group: "ONLINE"},
		cells("finch", "reviewing"),
		{Group: "OFFLINE"},
		cells("wren", "3h ago"),
	}})
	want := "  ONLINE\n  finch  reviewing\n  OFFLINE\n  wren   3h ago\n"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}

func TestTableAlignsByDisplayWidth(t *testing.T) {
	got := plain(protocol.Block{T: "table", Rows: []protocol.TableRow{cells("日本", "x"), cells("abcd", "y")}})
	if got != "  日本  x\n  abcd  y\n" {
		t.Fatalf("got\n%s", got)
	}
}

func TestTableRowsMayCarryFewerCellsThanTheWidest(t *testing.T) {
	got := plain(protocol.Block{T: "table", Rows: []protocol.TableRow{cells("a", "b", "c"), cells("only")}})
	if got != "  a     b  c\n  only\n" {
		t.Fatalf("got\n%q", got)
	}
}

func TestTreeAlignsChildColumns(t *testing.T) {
	got := plain(protocol.Block{T: "tree", Root: protocol.Cell{{Text: "rt.worktreeApp", Role: "key"}}, Children: [][]protocol.Cell{
		{text("team example"), text("true")},
		{text("user"), text("not set")},
	}})
	want := "  rt.worktreeApp\n" +
		fmt.Sprintf("  ├── %-12s  %s\n", "team example", "true") +
		fmt.Sprintf("  ╰── %-12s  %s\n", "user", "not set")
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}

func TestSectionsAreSeparatedByOneBlankLineAndNestTheirBlocks(t *testing.T) {
	got := plain(
		protocol.Block{T: "section", Title: "Accounts", Subtitle: "1 of 2 connected", Blocks: []protocol.Block{
			{T: "line", Status: "done", Title: "GitHub", Hint: "signed in"},
		}},
		protocol.Block{T: "section", Title: "Tools", Blocks: []protocol.Block{
			{T: "line", Status: "done", Title: "Editor", Hint: "ready"},
		}},
	)
	want := "  Accounts  1 of 2 connected\n  ✓ GitHub  signed in\n\n  Tools\n  ✓ Editor  ready\n"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}

func TestChangesAlignHintsAndRemovedIsNotCoral(t *testing.T) {
	b := protocol.Block{T: "changes", Changes: []protocol.ChangeRow{
		{Op: "+", Name: "review", Hint: "now public"},
		{Op: "-", Name: "triage-internal", Hint: "no longer public"},
	}}
	want := fmt.Sprintf("  + %-15s  %s\n", "review", "now public") +
		fmt.Sprintf("  - %-15s  %s\n", "triage-internal", "no longer public")
	if got := plain(b); got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	if strings.Contains(styled(b), coral) {
		t.Fatal("a removed row rendered coral")
	}
}

func TestEmptyTableAndSectionPrintNothingExtra(t *testing.T) {
	if got := plain(protocol.Block{T: "table"}); got != "" {
		t.Fatalf("empty table printed %q", got)
	}
	if got := plain(protocol.Block{T: "tree", Root: text("root")}); got != "  root\n" {
		t.Fatalf("childless tree printed %q", got)
	}
	if got := plain(protocol.Block{T: "section", Title: "Empty"}); got != "  Empty\n" {
		t.Fatalf("empty section printed %q", got)
	}
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd ui && go test ./internal/render/ -run 'Table|Tree|Section|Changes'`
Expected: FAIL. The table tests get `""` because the `block` switch has no case for these types.

- [ ] **Step 3: Write `blocks_layout.go`**

Create `ui/internal/render/blocks_layout.go`:

```go
package render

import (
	"strings"

	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/theme"
)

// renderRows styles every cell and measures each column by display width.
func renderRows(rows [][]protocol.Cell, widths []int) [][]string {
	out := make([][]string, len(rows))
	for ri, row := range rows {
		for ci, c := range row {
			s := cell(c)
			out[ri] = append(out[ri], s)
			widths[ci] = max(widths[ci], lipgloss.Width(s))
		}
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
	widths := make([]int, cols)
	headers := make([]string, len(b.Headers))
	for i, h := range b.Headers {
		headers[i] = faintStyle.Render(Clean(h))
		widths[i] = lipgloss.Width(headers[i])
	}
	rendered := renderRows(rows, widths)

	if len(headers) > 0 {
		r.emit(indent + joinCells(headers, widths))
		total := 2 * (cols - 1)
		for _, w := range widths {
			total += w
		}
		r.emit(indent + ruleStyle.Render(strings.Repeat("─", total)))
	}
	for i, row := range b.Rows {
		if row.Group != "" {
			r.emit(indent + faintStyle.Render(Clean(row.Group)))
			continue
		}
		r.emit(indent + joinCells(rendered[i], widths))
	}
}

func (r *renderer) tree(b protocol.Block) {
	r.emit(indent + cell(b.Root))
	cols := 0
	for _, child := range b.Children {
		cols = max(cols, len(child))
	}
	widths := make([]int, cols)
	rendered := renderRows(b.Children, widths)
	for i, child := range rendered {
		branch := "├── "
		if i == len(rendered)-1 {
			branch = "╰── "
		}
		r.emit(indent + ruleStyle.Render(branch) + joinCells(child, widths))
	}
}

func (r *renderer) section(b protocol.Block) {
	r.gap()
	s := indent + strongStyle.Render(Clean(b.Title))
	if b.Subtitle != "" {
		s += "  " + faintStyle.Render(Clean(b.Subtitle))
	}
	r.emit(s)
	r.blocks(b.Blocks)
}

func (r *renderer) changes(b protocol.Block) {
	w := 0
	for _, c := range b.Changes {
		if c.Hint != "" {
			w = max(w, lipgloss.Width(Clean(c.Name)))
		}
	}
	for _, c := range b.Changes {
		mark := fg(theme.Mint).Render("+")
		if c.Op == "-" {
			mark = dimStyle.Render("-")
		}
		name := Clean(c.Name)
		if c.Hint == "" {
			r.emit(indent + mark + " " + textStyle.Render(name))
			continue
		}
		r.emit(indent + mark + " " + textStyle.Render(pad(name, w)) + "  " + faintStyle.Render(Clean(c.Hint)))
	}
}
```

- [ ] **Step 4: Wire the cases**

In `ui/internal/render/render.go`, add to the `block` switch after the `failure` case:

```go
	case "table":
		r.table(b)
	case "tree":
		r.tree(b)
	case "section":
		r.section(b)
	case "changes":
		r.changes(b)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd ui && go vet ./internal/render/ && go test ./internal/render/`
Expected: `ok`. All Task 2 tests still pass.

- [ ] **Step 6: Commit**

```bash
gofmt -w ui/internal/render/
git add ui/internal/render/
git commit -m "rt-ui: render tables, trees, sections and change lists

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Go renderer text blocks (paragraph, copy, verbatim, diff)

**Files:**
- Create: `ui/internal/render/blocks_text.go`
- Create: `ui/internal/render/blocks_text_test.go`
- Modify: `ui/internal/render/render.go` (the `block` switch)

**Interfaces:**
- Consumes: `(*renderer).emit`, `r.width`, `Clean`, `pad`, the styles, `indent`, `calloutIndent` (Tasks 2 and 3); `theme.DiffAddBg`, `theme.DiffDelBg`, `theme.Mint`, `theme.Coral` (existing).
- Produces: rendering for `paragraph`, `copy`, `verbatim`, `diff`. No new exported names.

- [ ] **Step 1: Write the failing tests**

Create `ui/internal/render/blocks_text_test.go`:

```go
package render_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/protocol"
	"rt-ui/internal/render"
)

func TestParagraphWrapsToTheTerminalAndKeepsItsOwnLineBreaks(t *testing.T) {
	b := protocol.Block{T: "paragraph", Text: "one two three four five six seven eight nine ten\nsecond"}
	got := ansi.Strip(render.Render([]protocol.Block{b}, render.Options{Width: 30}))
	want := "  one two three four five\n  six seven eight nine ten\n  second\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestParagraphIsCappedAt76ColumnsOnAWideTerminal(t *testing.T) {
	b := protocol.Block{T: "paragraph", Text: strings.Repeat("word ", 60)}
	for _, l := range strings.Split(strings.TrimRight(ansi.Strip(render.Render([]protocol.Block{b}, render.Options{Width: 200})), "\n"), "\n") {
		if len(l) > 78 {
			t.Fatalf("line is %d columns: %q", len(l), l)
		}
	}
}

func TestCopyBlockIsNeverWrapped(t *testing.T) {
	long := "example://join?invite=" + strings.Repeat("a", 120)
	got := ansi.Strip(render.Render([]protocol.Block{{T: "copy", Caption: "send this link", Text: long}}, render.Options{Width: 40}))
	want := "    send this link\n    │  " + long + "\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestVerbatimKeepsIndentationAndExpandsTabs(t *testing.T) {
	got := plain(protocol.Block{T: "verbatim", Caption: "value", Lines: []string{"{", "  \"a\": 1,", "\t\"b\": 2", "}"}})
	want := "    value\n    │ {\n    │   \"a\": 1,\n    │     \"b\": 2\n    │ }\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestDiffMarksAddedAndRemovedLines(t *testing.T) {
	b := protocol.Block{T: "diff", Hunks: []protocol.DiffHunk{{Header: "@@ -1,2 +1,2 @@", Lines: []protocol.DiffLine{
		{Kind: "context", Text: "const a = 1;"},
		{Kind: "del", Text: "old();"},
		{Kind: "add", Text: "next();"},
	}}}}
	want := "  @@ -1,2 +1,2 @@\n" +
		"     const a = 1;\n" +
		"  " + fmt.Sprintf("%-15s", " - old();") + "\n" +
		"  " + fmt.Sprintf("%-15s", " + next();") + "\n"
	if got := plain(b); got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
	if !strings.Contains(styled(b), coral) {
		t.Fatal("a deleted diff line should keep the coral tint")
	}
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd ui && go test ./internal/render/ -run 'Paragraph|Copy|Verbatim|Diff'`
Expected: FAIL, each gets `""`. One exception: `TestParagraphIsCappedAt76ColumnsOnAWideTerminal` passes on empty output until the paragraph renders; it only starts checking in Step 5.

- [ ] **Step 3: Write `blocks_text.go`**

Create `ui/internal/render/blocks_text.go`:

```go
package render

import (
	"strings"

	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/theme"
)

const paragraphMax = 76

// cleanCode is Clean for literal text: a tab becomes four spaces so code and
// JSON keep their shape.
func cleanCode(s string) string {
	return Clean(strings.ReplaceAll(s, "\t", "    "))
}

func (r *renderer) caption(s string) {
	if s != "" {
		r.emit(calloutIndent + faintStyle.Render(Clean(s)))
	}
}

func (r *renderer) paragraph(b protocol.Block) {
	w := min(r.width-2*len(indent), paragraphMax)
	for _, para := range strings.Split(b.Text, "\n") {
		for _, l := range strings.Split(lipgloss.Wrap(Clean(para), w, ""), "\n") {
			r.emit(indent + textStyle.Render(strings.TrimRight(l, " ")))
		}
	}
}

// copy never wraps and never styles inside the text: the person selects it.
func (r *renderer) copy(b protocol.Block) {
	r.caption(b.Caption)
	r.emit(calloutIndent + railStyle.Render("│") + "  " + textStyle.Render(Clean(b.Text)))
}

func (r *renderer) verbatim(b protocol.Block) {
	r.caption(b.Caption)
	for _, l := range b.Lines {
		r.emit(calloutIndent + railStyle.Render("│") + " " + dimStyle.Render(cleanCode(l)))
	}
}

func (r *renderer) diff(b protocol.Block) {
	add := lipgloss.NewStyle().Foreground(theme.Mint).Background(theme.DiffAddBg)
	del := lipgloss.NewStyle().Foreground(theme.Coral).Background(theme.DiffDelBg)
	for _, h := range b.Hunks {
		r.emit(indent + keyStyle.Render(Clean(h.Header)))
		w := 0
		for _, l := range h.Lines {
			w = max(w, lipgloss.Width(cleanCode(l.Text)))
		}
		w += 3
		for _, l := range h.Lines {
			t := cleanCode(l.Text)
			switch l.Kind {
			case "add":
				r.emit(indent + add.Render(pad(" + "+t, w)))
			case "del":
				r.emit(indent + del.Render(pad(" - "+t, w)))
			default:
				r.emit(indent + textStyle.Render("   "+t))
			}
		}
	}
}
```

- [ ] **Step 4: Wire the cases**

In `ui/internal/render/render.go`, add to the `block` switch after the `changes` case:

```go
	case "paragraph":
		r.paragraph(b)
	case "copy":
		r.copy(b)
	case "verbatim":
		r.verbatim(b)
	case "diff":
		r.diff(b)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd ui && go vet ./internal/render/ && go test ./internal/render/`
Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
gofmt -w ui/internal/render/
git add ui/internal/render/
git commit -m "rt-ui: render paragraphs, copy blocks, verbatim blocks and diffs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The `rt-ui render` verb

**Files:**
- Modify: `ui/cmd/rt-ui/main.go` (the verb switch and `usage`, the file's header comment)
- Modify: `ui/cmd/rt-ui/verbs.go` (add `runRender`)
- Create: `ui/internal/render/verb_test.go`

**Interfaces:**
- Consumes: `protocol.DecodeBlock`, `protocol.Version` (Task 1); `render.Render`, `render.Options` (Tasks 2 to 4); `testutil.Binary(t)` (existing).
- Produces: the CLI contract `rt-ui render [--width N] [--no-color]`. Stdin: one `{"t":"hello","protocol":1}` line, then one block per line. Stdout: the rendered text. Exit 0 on success, 2 on a bad hello or a bad block (and then stdout is empty), 70 if stdout is gone. Color depth comes from the environment (`COLORTERM`, `TERM`, `NO_COLOR`), never from whether stdout is a TTY, because rt pipes it.

- [ ] **Step 1: Write the failing tests**

Create `ui/internal/render/verb_test.go`:

```go
package render_test

import (
	"bytes"
	"errors"
	"os/exec"
	"strings"
	"testing"

	"rt-ui/internal/testutil"
)

const helloLine = `{"t":"hello","protocol":1}` + "\n"

func runVerb(t *testing.T, args []string, env []string, stdin string) (stdout, stderr string, exit int) {
	t.Helper()
	cmd := exec.Command(testutil.Binary(t), append([]string{"render"}, args...)...)
	cmd.Env = append([]string{"PATH=/usr/bin:/bin"}, env...)
	cmd.Stdin = strings.NewReader(stdin)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	err := cmd.Run()
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		exit = ee.ExitCode()
	} else if err != nil {
		t.Fatal(err)
	}
	return out.String(), errb.String(), exit
}

func TestRenderVerbPrintsBlocksPlainWithNoColor(t *testing.T) {
	stdin := helloLine + `{"t":"line","status":"done","title":"Skills linked","hint":"16 skills"}` + "\n"
	out, _, exit := runVerb(t, []string{"--no-color"}, nil, stdin)
	if exit != 0 || out != "  ✓ Skills linked  16 skills\n" {
		t.Fatalf("exit %d out %q", exit, out)
	}
}

func TestRenderVerbColorsFromTheEnvironmentEvenWhenPiped(t *testing.T) {
	stdin := helloLine + `{"t":"line","status":"failed","title":"x"}` + "\n"
	out, _, exit := runVerb(t, nil, []string{"COLORTERM=truecolor", "TERM=xterm-256color"}, stdin)
	if exit != 0 || !strings.Contains(out, "\x1b[") {
		t.Fatalf("exit %d, no color in %q", exit, out)
	}
}

func TestRenderVerbHonorsNoColorEnv(t *testing.T) {
	stdin := helloLine + `{"t":"line","status":"failed","title":"x"}` + "\n"
	out, _, _ := runVerb(t, nil, []string{"COLORTERM=truecolor", "TERM=xterm-256color", "NO_COLOR=1"}, stdin)
	if strings.Contains(out, "\x1b[38") {
		t.Fatalf("NO_COLOR ignored: %q", out)
	}
}

func TestRenderVerbPassesWidthToParagraphs(t *testing.T) {
	stdin := helloLine + `{"t":"paragraph","text":"one two three four five six seven eight nine ten"}` + "\n"
	out, _, _ := runVerb(t, []string{"--no-color", "--width", "30"}, nil, stdin)
	if out != "  one two three four five\n  six seven eight nine ten\n" {
		t.Fatalf("out %q", out)
	}
}

func TestHelloOnlyPrintsNothing(t *testing.T) {
	out, _, exit := runVerb(t, []string{"--no-color"}, nil, helloLine)
	if exit != 0 || out != "" {
		t.Fatalf("exit %d out %q", exit, out)
	}
}

func TestBadHelloExitsTwo(t *testing.T) {
	for _, stdin := range []string{"", `{"t":"hello","protocol":7}` + "\n", `{"t":"line","status":"done","title":"x"}` + "\n"} {
		out, _, exit := runVerb(t, []string{"--no-color"}, nil, stdin)
		if exit != 2 || out != "" {
			t.Fatalf("stdin %q: exit %d out %q", stdin, exit, out)
		}
	}
}

func TestUnknownBlockExitsTwoWithNoOutput(t *testing.T) {
	stdin := helloLine + `{"t":"line","status":"done","title":"first"}` + "\n" + `{"t":"sparkline"}` + "\n"
	out, stderr, exit := runVerb(t, []string{"--no-color"}, nil, stdin)
	if exit != 2 || out != "" {
		t.Fatalf("exit %d out %q", exit, out)
	}
	if !strings.Contains(stderr, "sparkline") {
		t.Fatalf("stderr does not name the block: %q", stderr)
	}
}

func TestLastBlockWithoutATrailingNewlineStillRenders(t *testing.T) {
	stdin := helloLine + `{"t":"line","status":"done","title":"x"}`
	out, _, exit := runVerb(t, []string{"--no-color"}, nil, stdin)
	if exit != 0 || out != "  ✓ x\n" {
		t.Fatalf("exit %d out %q", exit, out)
	}
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd ui && go test ./internal/render/ -run 'Verb|Hello|UnknownBlock|LastBlock'`
Expected: FAIL for every test that wants exit 0. `TestBadHelloExitsTwo` and `TestUnknownBlockExitsTwoWithNoOutput`'s exit check already see 2, from the usage exit; they only prove something once the verb exists (the second also needs `sparkline` in stderr, so it fails now).

- [ ] **Step 3: Add `runRender`**

In `ui/cmd/rt-ui/verbs.go`, add `"strconv"`, `"github.com/charmbracelet/colorprofile"` and `"rt-ui/internal/render"` to the imports, and append:

```go
// runRender prints static blocks to stdout and exits. The color depth comes
// from the environment, not from stdout, because rt pipes this output and
// writes it to the terminal itself.
func runRender(args []string) int {
	width, noColor := 80, false
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--width":
			if i+1 < len(args) {
				if n, err := strconv.Atoi(args[i+1]); err == nil {
					width = n
				}
				i++
			}
		case "--no-color":
			noColor = true
		}
	}

	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	if !sc.Scan() {
		fmt.Fprintln(os.Stderr, "rt-ui render: no hello on stdin")
		return ExitBadSpec
	}
	var hello struct {
		T        string `json:"t"`
		Protocol int    `json:"protocol"`
	}
	if err := json.Unmarshal(sc.Bytes(), &hello); err != nil || hello.T != "hello" {
		fmt.Fprintln(os.Stderr, "rt-ui render: first line is not a hello")
		return ExitBadSpec
	}
	if hello.Protocol != protocol.Version {
		fmt.Fprintf(os.Stderr, "rt-ui render: protocol %d, rt-ui speaks %d\n", hello.Protocol, protocol.Version)
		return ExitBadSpec
	}

	var blocks []protocol.Block
	for sc.Scan() {
		if len(sc.Bytes()) == 0 {
			continue
		}
		b, err := protocol.DecodeBlock(sc.Bytes())
		if err != nil {
			fmt.Fprintln(os.Stderr, "rt-ui render:", err)
			return ExitBadSpec
		}
		blocks = append(blocks, b)
	}
	if err := sc.Err(); err != nil {
		fmt.Fprintln(os.Stderr, "rt-ui render:", err)
		return ExitBadSpec
	}

	profile := colorprofile.Env(os.Environ())
	if noColor {
		profile = colorprofile.NoTTY
	}
	w := &colorprofile.Writer{Forward: os.Stdout, Profile: profile}
	if _, err := w.WriteString(render.Render(blocks, render.Options{Width: width})); err != nil {
		return ExitInternal
	}
	return ExitOK
}
```

- [ ] **Step 4: Register the verb**

In `ui/cmd/rt-ui/main.go`:

Replace the header comment's first two lines with:

```go
// rt-ui renders rt's interactive screens and its static output. For the
// interactive verbs stdin/stdout carry the protocol and every byte of UI goes
// to /dev/tty; render is the exception and prints to stdout. Exit codes are
// the contract TS maps.
```

Add this case before `default:` in the switch:

```go
	case "render":
		os.Exit(runRender(os.Args[2:]))
```

Replace the `usage` body with:

```go
	fmt.Fprintln(os.Stderr, "usage: rt-ui prompt | rt-ui pick | rt-ui steps | rt-ui render [--width N] [--no-color] | rt-ui session --view <kind> | rt-ui --version")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd ui && go vet ./... && go test ./internal/render/ ./cmd/...`
Expected: `ok`. (`colorprofile.Env` reads `NO_COLOR` itself, which is what `TestRenderVerbHonorsNoColorEnv` relies on.)

- [ ] **Step 6: Build the helper and look at it**

Run (repo root): `bun run ui:build`, then:

```bash
printf '%s\n' '{"t":"hello","protocol":1}' \
  '{"t":"line","status":"done","title":"Skills linked","hint":"16 skills"}' \
  '{"t":"line","status":"needs-you","title":"Slack","hint":"not connected"}' \
  '{"t":"callout","label":"next","body":[[{"text":"rt setup slack connect","role":"command"}]]}' \
  '{"t":"summary","status":"needs-you","title":"Setup needs you","counts":["1 ready","1 needs you"]}' \
  | COLORTERM=truecolor ui/dist/rt-ui render --width 80
```

Expected: three lines, a callout and a summary, the command in bold, no coral anywhere, and body text in the terminal's own text color. Report in your task report what you saw; do not claim it looks right without running it.

- [ ] **Step 7: Commit**

```bash
gofmt -w ui/cmd/rt-ui/ ui/internal/render/
git add ui/cmd/rt-ui/main.go ui/cmd/rt-ui/verbs.go ui/internal/render/verb_test.go
git commit -m "rt-ui: render verb prints static blocks to stdout

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Step sub-lines and a status on `done`

**Files:**
- Modify: `ui/internal/protocol/protocol.go` (`StepEvent`, `DecodeStep`)
- Modify: `ui/internal/steps/steps.go` (replace the file)
- Modify: `ui/internal/steps/steps_test.go` (one assertion changed, tests appended)
- Modify: `lib/ui/protocol.ts` (`StepEvent`)
- Modify: `lib/ui/spawn.ts` (`StepHandle`, `openStep`)
- Modify: `lib/ui/steps.ts` (`StepRunner.run`)
- Modify: `lib/ui/__tests__/steps.test.ts` (append)

**Interfaces:**
- Consumes: `render.Clean`, `render.Glyph` (Task 2); `RenderStatus` (Task 1); `testutil.RunPTY`, `testutil.Screen` (existing).
- Produces (wire): step event `{ "t": "sub", "text": string }`, and an optional `"status"` on the `done` event naming one of the ten statuses.
- Produces (TS): `StepHandle.sub(text: string): void`; `StepHandle.done(title?: string, hint?: string, status?: RenderStatus): Promise<boolean>`; `StepRunner.run<T>(pending, task: (step: { sub(text: string): void }) => Promise<T>, opts?)`. Existing callers that pass a zero-argument task keep compiling.

Behavior this task ships:

- A `sub` line is transient: at most the last five show under the running step, they are erased when the step ends with `done`, and they stay when it ends with `fail`.
- A `log` line is permanent, and makes any sub-lines above it permanent too.
- `done` with a `status` paints that status's glyph in place of the mint check. `fail` stays the only coral ending.
- The step verb's warning glyph becomes `!` (the status set's `warn`), and its text takes the terminal's default foreground.

- [ ] **Step 1: Write the failing Go tests**

In `ui/internal/steps/steps_test.go`, change the last assertion of `TestLogLinesAppearAboveTheActiveStep` from

```go
	if !strings.Contains(tty, "⚠") {
		t.Fatalf("warn glyph missing: %q", tty)
	}
```

to

```go
	if !strings.Contains(testutil.Screen(tty), "! diverged from origin/main") {
		t.Fatalf("warn glyph missing: %q", tty)
	}
```

Then append:

```go
func TestSubLinesAreErasedWhenTheStepSucceeds(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"connecting…"}`, `{"t":"sub","text":"checking the session"}`, `{"t":"sub","text":"opening the tunnel"}`, `{"t":"done","title":"connected"}`}
	_, tty, exit := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	screen := testutil.Screen(tty)
	if exit != 0 || !strings.Contains(screen, "connected") {
		t.Fatalf("exit %d screen %q", exit, screen)
	}
	if strings.Contains(screen, "checking the session") || strings.Contains(screen, "opening the tunnel") {
		t.Fatalf("sub-lines survived a successful step: %q", screen)
	}
}

func TestSubLinesStayWhenTheStepFails(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"connecting…"}`, `{"t":"sub","text":"checking the session"}`, `{"t":"fail","title":"could not connect"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	screen := testutil.Screen(tty)
	if !strings.Contains(screen, "checking the session") || !strings.Contains(screen, "could not connect") {
		t.Fatalf("screen %q", screen)
	}
}

func TestOnlyTheLastFiveSubLinesShow(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"installing…"}`}
	for _, n := range []string{"1", "2", "3", "4", "5", "6", "7"} {
		lines = append(lines, `{"t":"sub","text":"line-`+n+`"}`)
	}
	lines = append(lines, `{"t":"fail","title":"install failed"}`)
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	screen := testutil.Screen(tty)
	for _, gone := range []string{"line-1", "line-2"} {
		if strings.Contains(screen, gone) {
			t.Fatalf("%s should have rolled off: %q", gone, screen)
		}
	}
	for _, kept := range []string{"line-3", "line-4", "line-5", "line-6", "line-7", "install failed"} {
		if !strings.Contains(screen, kept) {
			t.Fatalf("%s missing: %q", kept, screen)
		}
	}
}

func TestLongSubLineIsTruncatedAndErased(t *testing.T) {
	long := strings.Repeat("x", 400)
	lines := []string{hello, `{"t":"start","title":"connecting…"}`, `{"t":"sub","text":"` + long + `"}`, `{"t":"done","title":"connected"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	screen := testutil.Screen(tty)
	if strings.Contains(screen, "xxxx") {
		t.Fatalf("a wrapped sub-line left fragments behind: %q", screen)
	}
	if !strings.Contains(screen, "connected") {
		t.Fatalf("done line missing: %q", screen)
	}
}

func TestALogLineMakesEarlierSubLinesPermanent(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"connecting…"}`, `{"t":"sub","text":"before the log"}`, `{"t":"log","level":"warn","text":"session was stale"}`, `{"t":"sub","text":"after the log"}`, `{"t":"done","title":"connected"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	screen := testutil.Screen(tty)
	if !strings.Contains(screen, "session was stale") || !strings.Contains(screen, "before the log") {
		t.Fatalf("the log line or the sub-line above it was erased: %q", screen)
	}
	if strings.Contains(screen, "after the log") {
		t.Fatalf("a sub-line after the log survived: %q", screen)
	}
}

func TestSubTextIsCleaned(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"connecting…"}`, `{"t":"sub","text":"a\u001b[2Jb"}`, `{"t":"fail","title":"failed"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	if strings.Contains(tty, "\x1b[2J") {
		t.Fatalf("escape from sub text reached the terminal: %q", tty)
	}
}

func TestDoneWithAStatusEndsInThatStatusNotAFailure(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"connecting Slack…"}`, `{"t":"done","title":"Slack","hint":"not connected","status":"needs-you"}`}
	_, tty, exit := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	if exit != 0 || !strings.Contains(tty, "◆") || !strings.Contains(tty, "Slack") {
		t.Fatalf("exit %d tty %q", exit, tty)
	}
	if strings.Contains(tty, "✓") || strings.Contains(tty, "✗") || strings.Contains(tty, "255;121;121") {
		t.Fatalf("a needs-you ending was painted as done or as a failure: %q", tty)
	}
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd ui && go test ./internal/steps/`
Expected: five FAIL, three pass.

- FAIL: `TestLogLinesAppearAboveTheActiveStep` (the glyph is still `⚠`), `TestSubLinesStayWhenTheStepFails`, `TestOnlyTheLastFiveSubLinesShow`, `TestALogLineMakesEarlierSubLinesPermanent`, `TestDoneWithAStatusEndsInThatStatusNotAFailure`.
- Pass already: `TestSubLinesAreErasedWhenTheStepSucceeds`, `TestLongSubLineIsTruncatedAndErased`, `TestSubTextIsCleaned`. `runSteps` skips an event it cannot decode, so today a `sub` event is dropped and nothing is drawn to erase or clean. These three guard the implementation once it draws sub-lines; they are not expected to fail now.

- [ ] **Step 3: Accept the event and the status**

In `ui/internal/protocol/protocol.go`, add a field to `StepEvent` after `Text`:

```go
	Status string `json:"status,omitempty"`
```

and change the `DecodeStep` switch line to:

```go
	case "hello", "start", "log", "sub", "done", "fail":
```

- [ ] **Step 4: Replace `steps.go`**

Replace the whole of `ui/internal/steps/steps.go` with:

```go
// Package steps renders one step: a spinner line while the parent works,
// then a final line in the status the step ended with. The tty is write-only
// and cooked, so Ctrl-C stays a signal to the whole group and the parent's
// own SIGINT handling runs.
package steps

import (
	"fmt"
	"os"
	"time"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	xterm "github.com/charmbracelet/x/term"

	"rt-ui/internal/protocol"
	"rt-ui/internal/render"
	"rt-ui/internal/theme"
	"rt-ui/internal/tty"
)

type Outcome int

const (
	Done Outcome = iota
	Failed
	Interrupted // parent went away (stdin EOF)
	Signalled   // SIGINT/SIGTERM/SIGHUP reached us
)

const frameEvery = theme.SpinnerInterval

// maxSubs caps the transient lines under a running step: more would scroll
// past the top of the screen, where the erase on success cannot reach.
const maxSubs = 5

var (
	spinStyle = lipgloss.NewStyle().Foreground(theme.Mint)
	textStyle = lipgloss.NewStyle()
	hintStyle = lipgloss.NewStyle().Foreground(theme.Faint)
	subStyle  = lipgloss.NewStyle().Foreground(theme.Dimmer)
	railGlyph = lipgloss.NewStyle().Foreground(theme.Panel).Render("│")
	okGlyph   = render.Glyph("done")
	badGlyph  = render.Glyph("failed")
	infoGlyph = lipgloss.NewStyle().Foreground(theme.Faint).Render("•")
)

func logGlyph(level string) string {
	switch level {
	case "warn":
		return render.Glyph("warn")
	case "error":
		return badGlyph
	case "success":
		return okGlyph
	}
	return infoGlyph
}

// Run consumes events until done/fail, the channel closes (parent gone), or
// a signal arrives. The spinner line is only ever painted once the first
// frame tick fires, so a step that finishes inside 80 ms paints its final
// line and nothing else.
func Run(events <-chan protocol.StepEvent, signals <-chan os.Signal, term *os.File) Outcome {
	var title string
	painted := false
	frame := 0
	ticker := time.NewTicker(frameEvery)
	defer ticker.Stop()

	// A sub-line that wraps takes two rows and breaks the erase count, so
	// each one is cut to fit the terminal.
	subWidth := 72
	if w, _, err := xterm.GetSize(term.Fd()); err == nil && w > 16 {
		subWidth = w - 8
	}
	var subs []string

	clearActive := func() {
		if painted {
			fmt.Fprint(term, "\r\x1b[2K")
		}
		painted = false
	}
	// eraseSubs leaves the cursor where the first sub-line was. It is only
	// valid with the cursor at column 0 of the row under the last one.
	eraseSubs := func() {
		if len(subs) > 0 {
			fmt.Fprintf(term, "\x1b[%dA\x1b[J", len(subs))
		}
	}
	final := func(glyph, t, hint string) {
		clearActive()
		line := "  " + glyph + " " + textStyle.Render(t)
		if hint != "" {
			line += "  " + hintStyle.Render(hint)
		}
		fmt.Fprint(term, line+"\n")
	}

	for {
		select {
		case <-ticker.C:
			if title == "" {
				continue
			}
			if !painted {
				tty.FirstPaint()
			}
			painted = true
			f := theme.SpinnerFrames[frame%len(theme.SpinnerFrames)]
			frame++
			fmt.Fprint(term, "\r\x1b[2K  "+spinStyle.Render(f)+" "+textStyle.Render(title))
		case <-signals:
			if title != "" {
				final(badGlyph, title, "interrupted")
			}
			return Signalled
		case ev, ok := <-events:
			if !ok {
				if title != "" {
					final(badGlyph, title, "interrupted")
				}
				return Interrupted
			}
			switch ev.T {
			case "start":
				title = ev.Title
			case "log":
				clearActive()
				subs = nil
				fmt.Fprint(term, "  "+logGlyph(ev.Level)+" "+textStyle.Render(ev.Text)+"\n")
			case "sub":
				clearActive()
				eraseSubs()
				subs = append(subs, "    "+railGlyph+" "+subStyle.Render(ansi.Truncate(render.Clean(ev.Text), subWidth, "…"))+"\n")
				if len(subs) > maxSubs {
					subs = subs[len(subs)-maxSubs:]
				}
				for _, l := range subs {
					fmt.Fprint(term, l)
				}
			case "done":
				t := ev.Title
				if t == "" {
					t = title
				}
				clearActive()
				eraseSubs()
				g := okGlyph
				if ev.Status != "" {
					g = render.Glyph(ev.Status)
				}
				final(g, t, ev.Hint)
				return Done
			case "fail":
				t := ev.Title
				if t == "" {
					t = title
				}
				final(badGlyph, t, ev.Hint)
				return Failed
			}
		}
	}
}
```

What changed from the old file, so you can check nothing else moved: the `sub` case, `subs`, `maxSubs`, `subWidth` and `eraseSubs` are new; `done` erases sub-lines and honors `ev.Status`; `log` resets `subs` and takes its glyph from `logGlyph`; `clearActive` now resets `painted` itself (the old `log` case did that by hand); `textStyle` sets no color; the warn glyph comes from the status set. The signal and EOF paths are as before.

- [ ] **Step 5: Run the Go tests to verify they pass**

Run: `cd ui && go mod tidy && go vet ./... && go test ./...`
Expected: `ok` for every package. `go mod tidy` moves `github.com/charmbracelet/x/term` from an indirect to a direct requirement in `ui/go.mod`.

- [ ] **Step 6: Write the failing TS tests**

In `lib/ui/__tests__/steps.test.ts`, add `import { openStep } from "../spawn.ts";` to the imports and append:

```ts
test("run hands the task a sub callback that streams sub events before done", async () => {
  const steps = createStepRunner();
  await steps.run(
    "connecting…",
    async (step) => {
      step.sub("checking the session");
      step.sub("opening the tunnel");
    },
    { done: "connected" },
  );
  expect(sent()).toEqual([
    { t: "hello", protocol: 1 },
    { t: "start", title: "connecting…" },
    { t: "sub", text: "checking the session" },
    { t: "sub", text: "opening the tunnel" },
    { t: "done", title: "connected" },
  ]);
});

test("off a terminal the sub callback is a no-op and the final line still prints", async () => {
  __test__.setInteractive(() => false);
  const steps = createStepRunner();
  await steps.run("connecting…", async (step) => step.sub("checking"), { done: "connected" });
  expect(out.join("")).toContain("connected");
  expect(out.join("")).not.toContain("checking");
});

test("a step can end in a status other than done", async () => {
  const step = openStep("connecting Slack…");
  await step.done("Slack", "not connected", "needs-you");
  expect(sent()).toEqual([
    { t: "hello", protocol: 1 },
    { t: "start", title: "connecting Slack…" },
    { t: "done", title: "Slack", hint: "not connected", status: "needs-you" },
  ]);
});
```

- [ ] **Step 7: Run them to verify they fail**

Run (repo root): `bun test lib/ui/__tests__/steps.test.ts`
Expected: three FAIL. The first two with `step.sub is not a function` (the task receives no argument); the third because the recorded `done` line has no `status`.

- [ ] **Step 8: Add `sub` and `status` on the TS side**

In `lib/ui/protocol.ts`, change the `StepEvent` union's `log` and `done` members to:

```ts
  | { t: "log"; level: StepLevel; text: string }
  | { t: "sub"; text: string }
  | { t: "done"; title: string; hint?: string; status?: RenderStatus }
```

(`RenderStatus` is declared further down the same file; a type may be used before its declaration.)

In `lib/ui/spawn.ts`:

Add `type RenderStatus` to the import from `./protocol.ts`.

Replace the `StepHandle` interface with:

```ts
export interface StepHandle {
  log(level: StepLevel, text: string): void;
  /** A transient line under the running step: erased when it ends done, kept when it fails. */
  sub(text: string): void;
  /** Resolves true when rt-ui painted the final line; false when it was dead (caller prints the line itself). A status ends the step in that state in place of done. */
  done(title?: string, hint?: string, status?: RenderStatus): Promise<boolean>;
  fail(title?: string, hint?: string): Promise<boolean>;
}
```

In `openStep`, change `finish` to take and send the status:

```ts
  const finish = async (t: "done" | "fail", finalTitle?: string, hint?: string, status?: RenderStatus): Promise<boolean> => {
    const sent = send({ t, title: finalTitle ?? title, ...(hint ? { hint } : {}), ...(status ? { status } : {}) });
```

(the rest of `finish` is unchanged) and replace the returned object with:

```ts
  return {
    log: (level, text) => send({ t: "log", level, text }),
    sub: (text) => {
      send({ t: "sub", text });
    },
    done: (t, h, s) => finish("done", t, h, s),
    fail: (t, h) => finish("fail", t, h),
  };
```

In `lib/ui/steps.ts`, change the `run` member of the `StepRunner` interface to:

```ts
  /** Run an async step with spinner then done/error transition. */
  run<T>(
    pending: string,
    task: (step: { sub(text: string): void }) => Promise<T>,
    opts?: { done?: string; doneHint?: string; error?: string; errorHint?: string },
  ): Promise<T>;
```

In `createStepRunner`, give the `run` implementation the same `task` parameter type and replace `const r = await task();` with:

```ts
        const r = await task({ sub: (text) => step?.sub(text) });
```

Leave `withSpinner` as it is: its zero-argument `task` is assignable to the new parameter type.

- [ ] **Step 9: Run the TS tests to verify they pass**

Run (repo root): `bun run ui:build && bun test lib/ui/__tests__/ && bun run typecheck`
Expected: all pass, no type errors. The fake helper records every stdin line, so it needs no change for `sub` or `status`.

- [ ] **Step 10: Commit**

```bash
gofmt -w ui/internal/steps/ ui/internal/protocol/
git add ui/internal/steps/ ui/internal/protocol/protocol.go ui/go.mod ui/go.sum lib/ui/protocol.ts lib/ui/spawn.ts lib/ui/steps.ts lib/ui/__tests__/steps.test.ts
git commit -m "rt-ui steps: sub-lines that clear on success, and a status on done

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The plain renderer

**Files:**
- Create: `lib/ui/out-plain.ts`
- Create: `lib/ui/__tests__/out-plain.test.ts`

**Interfaces:**
- Consumes: `Block`, `Cell`, `RenderStatus`, `TableRow` types (Task 1).
- Produces: `renderPlain(blocks: Block[]): string`. Uncolored text, every line newline-terminated, no leading or trailing blank line, `""` for no blocks, escape sequences and control characters stripped. Statuses print as bracketed words so piped output is greppable.

- [ ] **Step 1: Write the failing tests**

Create `lib/ui/__tests__/out-plain.test.ts`:

```ts
import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderPlain } from "../out-plain.ts";
import type { Block } from "../protocol.ts";

test("lines carry a bracketed status word and a hint", () => {
  expect(
    renderPlain([
      { t: "line", status: "done", title: "Skills linked", hint: "16 skills" },
      { t: "line", status: "needs-you", title: "Slack" },
      { t: "line", status: "pending", title: "Linear", hint: "not connected yet" },
    ]),
  ).toBe("[ok] Skills linked  16 skills\n[needs you] Slack\n[not yet] Linear  not connected yet\n");
});

test("every status has a word", () => {
  const all = ["done", "failed", "needs-you", "pending", "stale", "refused", "off", "skipped", "running", "warn"] as const;
  const text = renderPlain(all.map((status) => ({ t: "line", status, title: "x" })));
  expect(text.split("\n").filter(Boolean)).toEqual(["[ok] x", "[failed] x", "[needs you] x", "[not yet] x", "[out of date] x", "[refused] x", "[off] x", "[skipped] x", "[running] x", "[warning] x"]);
});

test("a callout prints its label and indents continuation lines past it", () => {
  expect(renderPlain([{ t: "callout", label: "next", body: [[{ text: "rt setup slack connect", role: "command" }], [{ text: "then retry" }]] }])).toBe(
    "  next: rt setup slack connect\n        then retry\n",
  );
});

test("a link segment prints its url", () => {
  expect(renderPlain([{ t: "callout", label: "note", body: [[{ text: "docs", role: "link", url: "https://example.com" }]] }])).toBe("  note: docs (https://example.com)\n");
});

test("kv, with and without a value", () => {
  expect(renderPlain([{ t: "kv", key: "rt.worktreeApp", value: "true", source: "from team example" }])).toBe("rt.worktreeApp: true\n  from team example\n");
  expect(renderPlain([{ t: "kv", key: "rt.notifications" }])).toBe("rt.notifications:\n");
});

test("a table pads columns by display width and prints group labels", () => {
  expect(
    renderPlain([
      {
        t: "table",
        headers: ["KEY", "VALUE"],
        rows: [{ group: "USER" }, { cells: [[{ text: "日本" }], [{ text: "x" }]] }, { cells: [[{ text: "abcd" }], [{ text: "y" }]] }],
      },
    ]),
  ).toBe("KEY   VALUE\nUSER:\n日本  x\nabcd  y\n");
});

test("a tree lists children under its root", () => {
  expect(renderPlain([{ t: "tree", root: [{ text: "rt.worktreeApp" }], children: [[[{ text: "team example" }], [{ text: "true" }]], [[{ text: "user" }], [{ text: "not set" }]]] }])).toBe(
    `rt.worktreeApp\n  - team example  true\n  - ${"user".padEnd(12)}  not set\n`,
  );
});

test("sections and summaries are separated by one blank line, never at the top", () => {
  expect(
    renderPlain([
      { t: "section", title: "Accounts", subtitle: "1 of 2 connected", blocks: [{ t: "line", status: "done", title: "GitHub" }] },
      { t: "section", title: "Tools", blocks: [{ t: "line", status: "done", title: "Editor" }] },
      { t: "summary", status: "needs-you", title: "Setup needs you", counts: ["2 ready", "1 needs you"] },
    ]),
  ).toBe("Accounts (1 of 2 connected)\n[ok] GitHub\n\nTools\n[ok] Editor\n\n[needs you] Setup needs you  2 ready, 1 needs you\n");
});

test("copy text sits on its own unindented line so it can be piped or pasted", () => {
  expect(renderPlain([{ t: "copy", caption: "send this link", text: "example://join?invite=abc" }])).toBe("send this link:\nexample://join?invite=abc\n");
});

test("paragraph, verbatim, changes, diff and banner", () => {
  expect(renderPlain([{ t: "paragraph", text: "Two skills disagree." }])).toBe("Two skills disagree.\n");
  expect(renderPlain([{ t: "verbatim", caption: "value", lines: ["{", "}"] }])).toBe("value:\n  {\n  }\n");
  expect(renderPlain([{ t: "changes", changes: [{ op: "+", name: "review", hint: "now public" }, { op: "-", name: "triage" }] }])).toBe("+ review  now public\n- triage\n");
  expect(renderPlain([{ t: "diff", hunks: [{ header: "@@ -1 +1 @@", lines: [{ kind: "context", text: "a" }, { kind: "del", text: "b" }, { kind: "add", text: "c" }] }] }])).toBe(
    "@@ -1 +1 @@\n  a\n- b\n+ c\n",
  );
  expect(renderPlain([{ t: "banner", label: "PRODUCTION", subject: "db-replica", hint: "type the name to confirm" }])).toBe("PRODUCTION db-replica  type the name to confirm\n");
});

test("a failure prints why, next and details", () => {
  expect(
    renderPlain([{ t: "failure", title: "This Mac cannot read the team's secrets yet", why: "No key matches.", next: [{ text: "rt setup status", role: "command" }], details: "details are in the log" }]),
  ).toBe("[failed] This Mac cannot read the team's secrets yet\n  why: No key matches.\n  next: rt setup status\n  details are in the log\n");
});

test("plain output is cleaned of escapes and controls", () => {
  expect(renderPlain([{ t: "line", status: "done", title: "evil\x1b[2Jname\x07", hint: "a\x1b]0;title\x07b" }])).toBe("[ok] evilname  ab\n");
  expect(renderPlain([{ t: "verbatim", lines: ["a\tb"] }])).toBe("  a\tb\n");
});

test("no blocks render nothing, and the shared fixture renders without throwing", () => {
  expect(renderPlain([])).toBe("");
  const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, "..", "..", "..", "ui", "fixtures", "render-document.json"), "utf8")) as Block[];
  const text = renderPlain(fixture);
  expect(text.startsWith("\n")).toBe(false);
  expect(text.endsWith("\n\n")).toBe(false);
  expect(text).not.toContain("\x1b");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (repo root): `bun test lib/ui/__tests__/out-plain.test.ts`
Expected: FAIL, cannot find module `../out-plain.ts`.

- [ ] **Step 3: Write the renderer**

Create `lib/ui/out-plain.ts`:

```ts
/**
 * The same blocks rt-ui draws, as uncolored text: what a pipe, an agent
 * without --json, or a machine with no rt-ui gets. Statuses are words so the
 * output can be grepped.
 */
import type { Block, Cell, RenderStatus } from "./protocol.ts";

const TAG: Record<RenderStatus, string> = {
  done: "[ok]",
  failed: "[failed]",
  "needs-you": "[needs you]",
  pending: "[not yet]",
  stale: "[out of date]",
  refused: "[refused]",
  off: "[off]",
  skipped: "[skipped]",
  running: "[running]",
  warn: "[warning]",
};

function cellText(cell: Cell): string {
  return cell.map((s) => (s.role === "link" && s.url ? `${s.text} (${s.url})` : s.text)).join("");
}

function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - Bun.stringWidth(s)));
}

/** Pads every cell but a row's last to its column width. */
function columns(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) row.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, Bun.stringWidth(c))));
  return rows.map((row) => row.map((c, i) => (i === row.length - 1 ? c : pad(c, widths[i]!))).join("  "));
}

function gap(out: string[]): void {
  if (out.length > 0 && out[out.length - 1] !== "") out.push("");
}

function caption(out: string[], text: string | undefined): void {
  if (text) out.push(`${text}:`);
}

function render(blocks: Block[], out: string[]): void {
  for (const b of blocks) {
    switch (b.t) {
      case "line":
        out.push(`${TAG[b.status]} ${b.title}${b.hint ? `  ${b.hint}` : ""}`);
        break;
      case "callout":
        b.body.forEach((c, i) => out.push(i === 0 ? `  ${b.label}: ${cellText(c)}` : `  ${" ".repeat(b.label.length + 2)}${cellText(c)}`));
        break;
      case "kv":
        out.push(b.value ? `${b.key}: ${b.value}` : `${b.key}:`);
        if (b.source) out.push(`  ${b.source}`);
        break;
      case "table": {
        const grid: string[][] = [];
        if (b.headers) grid.push(b.headers);
        for (const row of b.rows) if ("cells" in row) grid.push(row.cells.map(cellText));
        const lines = columns(grid);
        let at = 0;
        if (b.headers) out.push(lines[at++]!);
        for (const row of b.rows) out.push("group" in row ? `${row.group}:` : lines[at++]!);
        break;
      }
      case "tree":
        out.push(cellText(b.root));
        for (const line of columns(b.children.map((child) => child.map(cellText)))) out.push(`  - ${line}`);
        break;
      case "section":
        gap(out);
        out.push(b.subtitle ? `${b.title} (${b.subtitle})` : b.title);
        render(b.blocks, out);
        break;
      case "summary":
        gap(out);
        out.push(`${TAG[b.status]} ${b.title}${b.counts?.length ? `  ${b.counts.join(", ")}` : ""}`);
        break;
      case "paragraph":
        out.push(b.text);
        break;
      case "copy":
        caption(out, b.caption);
        out.push(b.text);
        break;
      case "verbatim":
        caption(out, b.caption);
        for (const l of b.lines) out.push(`  ${l}`);
        break;
      case "changes":
        for (const c of b.changes) out.push(`${c.op} ${c.name}${c.hint ? `  ${c.hint}` : ""}`);
        break;
      case "diff":
        for (const h of b.hunks) {
          out.push(h.header);
          for (const l of h.lines) out.push(`${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "} ${l.text}`);
        }
        break;
      case "banner":
        out.push(`${b.label} ${b.subject}${b.hint ? `  ${b.hint}` : ""}`);
        break;
      case "failure":
        out.push(`${TAG.failed} ${b.title}${b.hint ? `  ${b.hint}` : ""}`);
        if (b.why) out.push(`  why: ${b.why}`);
        if (b.next) out.push(`  next: ${cellText(b.next)}`);
        if (b.details) out.push(`  ${b.details}`);
        break;
    }
  }
}

// Text from a branch name or a child process must not repaint the terminal
// when the fallback writes it raw. Newlines and tabs are kept.
const ESCAPES = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

export function renderPlain(blocks: Block[]): string {
  const out: string[] = [];
  render(blocks, out);
  if (out.length === 0) return "";
  return (out.join("\n") + "\n").replace(ESCAPES, "").replace(CONTROLS, "");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (repo root): `bun test lib/ui/__tests__/out-plain.test.ts && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/ui/out-plain.ts lib/ui/__tests__/out-plain.test.ts
git commit -m "lib/ui: plain renderer for output blocks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `lib/ui/out.ts`

**Files:**
- Create: `lib/ui/out.ts`
- Create: `lib/ui/__tests__/out.test.ts`
- Modify: `lib/ui/__tests__/fake-rt-ui.ts` (a `render` verb)

**Interfaces:**
- Consumes: `renderPlain` (Task 7); `Block` and friends, `encodeLine`, `PROTOCOL_VERSION` (Task 1, existing); `resolveRtUi` (existing); the `rt-ui render` CLI contract (Task 5).
- Produces, all exported from `lib/ui/out.ts`:
  - Builders: `line(status, title, hint?)`, `callout(label, ...body: CellInput[])`, `kv(key, value?, source?)`, `table(rows: Array<CellInput[] | { group: string }>, headers?: string[])`, `tree(root: CellInput, children: CellInput[][])`, `section(title, subtitle: string | undefined, ...blocks: Block[])`, `summary(status, title, counts?: string[])`, `paragraph(text)`, `copy(text, caption?)`, `verbatim(lines: string[], caption?)`, `changes(rows: ChangeRow[])`, `diff(hunks: DiffHunk[])`, `banner(label, subject, hint?)`, `failure(f: FailureInput)`. Each returns a `Block`.
  - Segment helpers: `cmd(text)`, `key(text)`, `strong(text)`, `dim(text)`, `faint(text)`, `link(text, url)`. Each returns a `Segment`.
  - `type CellInput = string | Segment | Array<string | Segment>`.
  - `interface FailureInput { title: string; hint?: string; why?: string; next?: CellInput; details?: string }`.
  - Output: `print(...blocks: Block[]): void`, `fail(f: FailureInput): void`, `json(value: unknown, indent?: number): void`, `payload(text: string): void`, `payloadOnStdout(): void`.
  - `__test__ = { setHuman(fn | undefined), reset() }`.

- [ ] **Step 1: Teach the fake helper the `render` verb**

In `lib/ui/__tests__/fake-rt-ui.ts`, add `renderOut?: string;` to the `cfg` type, and insert this block before `if (verb === "session") {`:

```ts
if (verb === "render") {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value);
  }
  if (cfg.record) appendFileSync(cfg.record, JSON.stringify({ argv: process.argv.slice(3) }) + "\n" + buf);
  if (cfg.exit) process.exit(cfg.exit);
  process.stdout.write(cfg.renderOut ?? "STYLED\n");
  process.exit(0);
}
```

- [ ] **Step 2: Write the failing tests**

Create `lib/ui/__tests__/out.test.ts`:

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import * as out from "../out.ts";

const FAKE = resolve(import.meta.dir, "fake-rt-ui.ts");
let dir: string;
let record: string;
let stdout: string[];
let stderr: string[];
const realOut = process.stdout.write;
const realErr = process.stderr.write;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rt-out-"));
  record = join(dir, "record.ndjson");
  process.env.RT_UI_BIN = FAKE;
  process.env.RT_UI_FAKE = JSON.stringify({ record });
  delete process.env.NO_COLOR;
  out.__test__.setHuman(() => true);
  stdout = [];
  stderr = [];
  process.stdout.write = ((c: string | Uint8Array) => (stdout.push(String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => (stderr.push(String(c)), true)) as typeof process.stderr.write;
});
afterEach(() => {
  process.stdout.write = realOut;
  process.stderr.write = realErr;
  out.__test__.reset();
  delete process.env.RT_UI_BIN;
  delete process.env.RT_UI_FAKE;
  delete process.env.NO_COLOR;
  rmSync(dir, { recursive: true, force: true });
});

const sent = () =>
  readFileSync(record, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

test("builders produce wire blocks and normalize cell input", () => {
  expect(out.line("done", "Skills linked", "16 skills")).toEqual({ t: "line", status: "done", title: "Skills linked", hint: "16 skills" });
  expect(out.line("done", "x")).toEqual({ t: "line", status: "done", title: "x" });
  expect(out.callout("next", out.cmd("rt setup slack connect"), ["then ", out.strong("retry")])).toEqual({
    t: "callout",
    label: "next",
    body: [[{ text: "rt setup slack connect", role: "command" }], [{ text: "then " }, { text: "retry", role: "strong" }]],
  });
  expect(out.table([["a", out.dim("b")], { group: "G" }], ["X", "Y"])).toEqual({
    t: "table",
    headers: ["X", "Y"],
    rows: [{ cells: [[{ text: "a" }], [{ text: "b", role: "dim" }]] }, { group: "G" }],
  });
  expect(out.tree(out.key("root"), [["user", "not set"]])).toEqual({ t: "tree", root: [{ text: "root", role: "key" }], children: [[[{ text: "user" }], [{ text: "not set" }]]] });
  expect(out.section("Accounts", undefined, out.line("done", "GitHub"))).toEqual({ t: "section", title: "Accounts", blocks: [{ t: "line", status: "done", title: "GitHub" }] });
  expect(out.kv("k")).toEqual({ t: "kv", key: "k" });
  expect(out.link("docs", "https://example.com")).toEqual({ text: "docs", role: "link", url: "https://example.com" });
  expect(out.failure({ title: "x", next: out.cmd("rt setup status") })).toEqual({ t: "failure", title: "x", next: [{ text: "rt setup status", role: "command" }] });
});

test("at a terminal print pipes hello plus one block per line to rt-ui render and writes its output to stdout", () => {
  out.print(out.line("done", "Skills linked"), out.callout("tip", "saved"));
  expect(stdout.join("")).toBe("STYLED\n");
  expect(stderr.join("")).toBe("");
  const [head, ...lines] = sent();
  expect(head.argv[0]).toBe("--width");
  expect(head.argv[1]).toMatch(/^\d+$/);
  expect(head.argv).toHaveLength(2);
  expect(lines).toEqual([{ t: "hello", protocol: 1 }, { t: "line", status: "done", title: "Skills linked" }, { t: "callout", label: "tip", body: [[{ text: "saved" }]] }]);
});

test("NO_COLOR is passed to the helper as --no-color", () => {
  process.env.NO_COLOR = "1";
  out.print(out.line("done", "x"));
  expect(sent()[0].argv.at(-1)).toBe("--no-color");
});

test("off a terminal print writes the plain text and never spawns the helper", () => {
  out.__test__.setHuman(() => false);
  out.print(out.line("done", "Skills linked", "16 skills"));
  expect(stdout.join("")).toBe("[ok] Skills linked  16 skills\n");
  expect(existsSync(record)).toBe(false);
});

test("falls back to plain when the helper exits non-zero", () => {
  process.env.RT_UI_FAKE = JSON.stringify({ record, exit: 2 });
  out.print(out.line("done", "Skills linked"));
  expect(stdout.join("")).toBe("[ok] Skills linked\n");
});

test("falls back to plain when the helper cannot be found", () => {
  process.env.RT_UI_BIN = join(dir, "no-such-binary");
  out.print(out.line("done", "Skills linked"));
  expect(stdout.join("")).toBe("[ok] Skills linked\n");
});

test("print with no blocks writes nothing", () => {
  out.print();
  expect(stdout.join("")).toBe("");
  expect(existsSync(record)).toBe(false);
});

test("fail renders a failure block on stderr", () => {
  out.__test__.setHuman(() => false);
  out.fail({ title: "This Mac cannot read the team's secrets yet", why: "No key matches." });
  expect(stdout.join("")).toBe("");
  expect(stderr.join("")).toBe("[failed] This Mac cannot read the team's secrets yet\n  why: No key matches.\n");
});

test("the human gate is asked about the stream being written", () => {
  const asked: string[] = [];
  out.__test__.setHuman((stream) => (asked.push(stream), false));
  out.print(out.line("done", "x"));
  out.fail({ title: "y" });
  expect(asked).toEqual(["stdout", "stderr"]);
});

test("the real gate opens only on a TTY, without RT_BATCH and without --json", () => {
  out.__test__.reset();
  const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const argv = process.argv;
  const batch = process.env.RT_BATCH;
  const spawned = (): boolean => {
    const yes = existsSync(record);
    rmSync(record, { force: true });
    return yes;
  };
  const setTTY = (value: boolean) => Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
  try {
    delete process.env.RT_BATCH;
    setTTY(false);
    out.print(out.line("done", "x"));
    expect(spawned()).toBe(false);

    setTTY(true);
    out.print(out.line("done", "x"));
    expect(spawned()).toBe(true);

    process.env.RT_BATCH = "1";
    out.print(out.line("done", "x"));
    expect(spawned()).toBe(false);
    delete process.env.RT_BATCH;

    process.argv = [...argv, "--json"];
    out.print(out.line("done", "x"));
    expect(spawned()).toBe(false);
  } finally {
    process.argv = argv;
    if (batch === undefined) delete process.env.RT_BATCH;
    else process.env.RT_BATCH = batch;
    if (isTTY) Object.defineProperty(process.stdout, "isTTY", isTTY);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  }
});

test("after payloadOnStdout, print writes human text to stderr and payload still owns stdout", () => {
  out.__test__.setHuman(() => false);
  out.payloadOnStdout();
  out.print(out.line("done", "Installed the shell wrapper"));
  out.payload("/Users/sam/code/app\n");
  expect(stderr.join("")).toBe("[ok] Installed the shell wrapper\n");
  expect(stdout.join("")).toBe("/Users/sam/code/app\n");
});

test("payload writes its text byte for byte and json writes one line", () => {
  out.payload("no newline added");
  out.json({ ok: true, n: 1 });
  out.json({ a: 1 }, 2);
  expect(stdout.join("")).toBe('no newline added{"ok":true,"n":1}\n{\n  "a": 1\n}\n');
});
```

- [ ] **Step 3: Run them to verify they fail**

Run (repo root): `bun test lib/ui/__tests__/out.test.ts`
Expected: FAIL, cannot find module `../out.ts`.

- [ ] **Step 4: Write `out.ts`**

Create `lib/ui/out.ts`:

```ts
/**
 * The one way rt commands print. Builders return data; print() decides
 * whether a person is reading, asks rt-ui to draw the blocks if so, and
 * otherwise (a pipe, --json, RT_BATCH, a missing or failed helper) writes
 * the same words plainly. No color or glyph styling lives on this side.
 */
import { renderPlain } from "./out-plain.ts";
import { encodeLine, PROTOCOL_VERSION, type Block, type CalloutLabel, type Cell, type ChangeRow, type DiffHunk, type RenderStatus, type Segment } from "./protocol.ts";
import { resolveRtUi } from "./resolve.ts";

export type CellInput = string | Segment | Array<string | Segment>;

export interface FailureInput {
  title: string;
  hint?: string;
  why?: string;
  next?: CellInput;
  details?: string;
}

type Stream = "stdout" | "stderr";

function toCell(input: CellInput): Cell {
  const parts = Array.isArray(input) ? input : [input];
  return parts.map((p) => (typeof p === "string" ? { text: p } : p));
}

/** Drops undefined members so a block encodes without empty fields. */
function compact(o: Record<string, unknown>): Block {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Block;
}

// ─── segments ────────────────────────────────────────────────────────────────

export const cmd = (text: string): Segment => ({ text, role: "command" });
export const key = (text: string): Segment => ({ text, role: "key" });
export const strong = (text: string): Segment => ({ text, role: "strong" });
export const dim = (text: string): Segment => ({ text, role: "dim" });
export const faint = (text: string): Segment => ({ text, role: "faint" });
export const link = (text: string, url: string): Segment => ({ text, role: "link", url });

// ─── blocks ──────────────────────────────────────────────────────────────────

export function line(status: RenderStatus, title: string, hint?: string): Block {
  return compact({ t: "line", status, title, hint });
}

export function callout(label: CalloutLabel, ...body: CellInput[]): Block {
  return { t: "callout", label, body: body.map(toCell) };
}

export function kv(k: string, value?: string, source?: string): Block {
  return compact({ t: "kv", key: k, value, source });
}

export function table(rows: Array<CellInput[] | { group: string }>, headers?: string[]): Block {
  return compact({ t: "table", headers, rows: rows.map((r) => (Array.isArray(r) ? { cells: r.map(toCell) } : r)) });
}

export function tree(root: CellInput, children: CellInput[][]): Block {
  return { t: "tree", root: toCell(root), children: children.map((c) => c.map(toCell)) };
}

export function section(title: string, subtitle: string | undefined, ...blocks: Block[]): Block {
  return compact({ t: "section", title, subtitle, blocks });
}

export function summary(status: RenderStatus, title: string, counts?: string[]): Block {
  return compact({ t: "summary", status, title, counts });
}

export function paragraph(text: string): Block {
  return { t: "paragraph", text };
}

export function copy(text: string, caption?: string): Block {
  return compact({ t: "copy", text, caption });
}

export function verbatim(lines: string[], caption?: string): Block {
  return compact({ t: "verbatim", lines, caption });
}

export function changes(rows: ChangeRow[]): Block {
  return { t: "changes", changes: rows };
}

export function diff(hunks: DiffHunk[]): Block {
  return { t: "diff", hunks };
}

export function banner(label: string, subject: string, hint?: string): Block {
  return compact({ t: "banner", label, subject, hint });
}

export function failure(f: FailureInput): Block {
  return compact({ t: "failure", title: f.title, hint: f.hint, why: f.why, next: f.next === undefined ? undefined : toCell(f.next), details: f.details });
}

// ─── output ──────────────────────────────────────────────────────────────────

function realHuman(stream: Stream): boolean {
  const s = stream === "stdout" ? process.stdout : process.stderr;
  return Boolean(s.isTTY) && !process.env.RT_BATCH && !process.argv.includes("--json");
}

let human: (stream: Stream) => boolean = realHuman;
let humanStream: Stream = "stdout";

/**
 * For a verb whose stdout is read by another program (rt cd, rt nav): human
 * text moves to stderr for the rest of the process.
 */
export function payloadOnStdout(): void {
  humanStream = "stderr";
}

function write(stream: Stream, text: string): void {
  (stream === "stdout" ? process.stdout : process.stderr).write(text);
}

function renderStyled(blocks: Block[], stream: Stream): string | null {
  try {
    const columns = (stream === "stdout" ? process.stdout : process.stderr).columns ?? 80;
    const args = [resolveRtUi(), "render", "--width", String(columns)];
    if (process.env.NO_COLOR) args.push("--no-color");
    const input = encodeLine({ t: "hello", protocol: PROTOCOL_VERSION }) + blocks.map(encodeLine).join("");
    const r = Bun.spawnSync(args, { stdin: Buffer.from(input), stdout: "pipe", stderr: "pipe", env: { ...process.env } });
    return r.exitCode === 0 ? r.stdout.toString() : null;
  } catch {
    // A missing or unspawnable helper must never cost the person the message.
    return null;
  }
}

function emit(blocks: Block[], stream: Stream): void {
  if (blocks.length === 0) return;
  const styled = human(stream) ? renderStyled(blocks, stream) : null;
  write(stream, styled ?? renderPlain(blocks));
}

/** Human-facing blocks. Blocks that must align with each other go in one call. */
export function print(...blocks: Block[]): void {
  emit(blocks, humanStream);
}

/** A failure, on stderr. */
export function fail(f: FailureInput): void {
  emit([failure(f)], "stderr");
}

/** A --json envelope, exactly as JSON.stringify writes it. */
export function json(value: unknown, indent?: number): void {
  process.stdout.write(JSON.stringify(value, null, indent) + "\n");
}

/** Text another program reads. Written to stdout byte for byte, never styled. */
export function payload(text: string): void {
  process.stdout.write(text);
}

export const __test__ = {
  setHuman(fn: ((stream: Stream) => boolean) | undefined): void {
    human = fn ?? realHuman;
  },
  reset(): void {
    human = realHuman;
    humanStream = "stdout";
  },
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (repo root): `bun test lib/ui/__tests__/ && bun run typecheck`
Expected: all pass, no type errors.

- [ ] **Step 6: Run it against the real helper**

Run (repo root): `bun run ui:build`, then create `/tmp/out-smoke.ts` with:

```ts
import * as out from "/ABSOLUTE/PATH/TO/REPO/lib/ui/out.ts";
out.print(
  out.section("Accounts", "1 of 2 connected", out.line("done", "GitHub", "signed in"), out.line("needs-you", "Slack", "not connected"), out.callout("next", out.cmd("rt setup slack connect"))),
  out.summary("needs-you", "Setup needs you", ["1 ready", "1 needs you"]),
);
out.fail({ title: "This Mac cannot read the team's secrets yet", why: "No key on this machine matches.", next: out.cmd("rt setup status") });
```

Replace the import path with the worktree's absolute path. Run it three ways and report what each printed:

```bash
bun /tmp/out-smoke.ts            # in a real terminal: styled, failure on stderr
bun /tmp/out-smoke.ts | cat      # piped stdout: plain section, styled failure on stderr
RT_BATCH=1 bun /tmp/out-smoke.ts # all plain
rm /tmp/out-smoke.ts
```

If you have no real terminal (a subagent usually does not), run only the second and third forms, state that the styled form was not viewed, and leave it for the final review.

- [ ] **Step 7: Commit**

```bash
git add lib/ui/out.ts lib/ui/__tests__/out.test.ts lib/ui/__tests__/fake-rt-ui.ts
git commit -m "lib/ui: out module, the one way commands print

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The ratchet guard

**Files:**
- Create: `lib/__tests__/no-raw-output.test.ts`
- Create: `lib/__tests__/raw-output-allowlist.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a test named `no-*` (so `scripts/ci/test-scope.ts` runs it on every PR) that fails when a file under `commands/` or `lib/` prints raw and is not on the allowlist, and fails when the allowlist names a file that no longer prints raw. Later phases shrink the allowlist by deleting lines.

- [ ] **Step 1: Write the test with an empty allowlist**

Create `lib/__tests__/raw-output-allowlist.json` containing exactly:

```json
[]
```

Create `lib/__tests__/no-raw-output.test.ts`:

```ts
import { test, expect } from "bun:test";
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { relative, resolve } from "path";

// Human output goes through lib/ui/out.ts. This list holds the files that
// still print by hand; it only ever shrinks, and it is empty when the
// conversion is done.
const ROOT = resolve(import.meta.dir, "..", "..");
const ALLOWLIST = resolve(import.meta.dir, "raw-output-allowlist.json");
const SCAN_ROOTS = ["commands", "lib"];

// The output layer itself, and the color modules it retires last.
const EXEMPT = [/^lib\/ui\//, /^lib\/tui\//, /^lib\/ansi\.ts$/, /^lib\/tui\.ts$/];

const RAW = [/\bconsole\.(log|error|warn|info)\s*\(/, /\bprocess\.std(out|err)\.write\b/, /from\s+["'][^"']*\/(ansi|tui|tui\/palette)\.ts["']/, /\\x1b\[|\\u001b\[/];

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === "__tests__") return [];
    if (entry.isDirectory()) return collect(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

function offenders(): string[] {
  return SCAN_ROOTS.flatMap((root) => collect(resolve(ROOT, root)))
    .map((file) => relative(ROOT, file))
    .filter((file) => !EXEMPT.some((re) => re.test(file)))
    .filter((file) => RAW.some((re) => re.test(readFileSync(resolve(ROOT, file), "utf8"))))
    .sort();
}

if (process.env.RT_UPDATE_RAW_OUTPUT_ALLOWLIST) {
  writeFileSync(ALLOWLIST, JSON.stringify(offenders(), null, 2) + "\n");
}

const allowed = JSON.parse(readFileSync(ALLOWLIST, "utf8")) as string[];

test("no file outside the allowlist prints raw: use lib/ui/out.ts", () => {
  const known = new Set(allowed);
  expect(offenders().filter((file) => !known.has(file))).toEqual([]);
});

test("the allowlist names only files that still print raw: delete the line when a file is converted", () => {
  const current = new Set(offenders());
  expect(allowed.filter((file) => !current.has(file))).toEqual([]);
});

test("the allowlist is sorted and has no duplicates", () => {
  expect(allowed).toEqual([...new Set(allowed)].sort());
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (repo root): `bun test lib/__tests__/no-raw-output.test.ts`
Expected: the first test FAILS and lists about a hundred files (`commands/daemon.ts`, `commands/settings-keys.ts`, ...). The other two pass. This proves the scanner finds the offenders.

- [ ] **Step 3: Generate the allowlist**

Run (repo root): `RT_UPDATE_RAW_OUTPUT_ALLOWLIST=1 bun test lib/__tests__/no-raw-output.test.ts`
Expected: all three PASS, and `lib/__tests__/raw-output-allowlist.json` now lists the offenders. Confirm no path under `lib/ui/` or `lib/tui/` is in it:

```bash
grep -cE '"lib/(ui|tui)/' lib/__tests__/raw-output-allowlist.json
```

Expected: `0`.

The list includes files that will never be converted: agent-only verbs, logging seams and protocol writers. Leave them in. The spec's Guard section gives the rule, and the phase that reaches each one either moves it onto `out.json` or `out.payload` or adds it to `EXEMPT` with a reason. Do not add exemptions in this phase.

- [ ] **Step 4: Prove the guard can fail both ways**

```bash
echo 'console.log("probe");' > commands/zz-raw-output-probe.ts
bun test lib/__tests__/no-raw-output.test.ts
```

Expected: the first test FAILS naming `commands/zz-raw-output-probe.ts`.

```bash
rm commands/zz-raw-output-probe.ts
bun test lib/__tests__/no-raw-output.test.ts
```

Expected: PASS.

Now the other direction. Add `"commands/aaa-stale.ts",` as the first entry of the JSON array in `lib/__tests__/raw-output-allowlist.json` and run the test: the second test FAILS naming `commands/aaa-stale.ts`. Remove that entry and run again: PASS.

- [ ] **Step 5: Commit**

```bash
bun test lib/__tests__/no-raw-output.test.ts
git add lib/__tests__/no-raw-output.test.ts lib/__tests__/raw-output-allowlist.json
git commit -m "guard: no new raw printing outside lib/ui/out.ts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Document the layer and run every gate

**Files:**
- Modify: `AGENTS.md` (a new `## Output layer` section before `## The TypeScript CLI is UI-free`; one sentence added to `## Command descriptions are plain language`)

**Interfaces:**
- Consumes: everything above.
- Produces: the contract future phases and other agents read.

- [ ] **Step 1: Add the AGENTS.md section**

Insert before the line `## The TypeScript CLI is UI-free`:

```markdown
## Output layer

Everything rt prints for a person goes through `lib/ui/out.ts`. Builders
(`out.line`, `out.callout`, `out.kv`, `out.table`, `out.tree`, `out.section`
and the rest) return data; `out.print` draws them through the one-shot
`rt-ui render` verb at a terminal and prints the same words plainly
(`lib/ui/out-plain.ts`) off a TTY, under `--json` or `RT_BATCH`, or when the
helper is missing or fails. Before adding or changing output, read
`docs/superpowers/specs/2026-09-30-rt-output-layer-design.md`: the block
vocabulary, the ten statuses, the color roles and the rules.

Five rules cost the most when broken:

- **Coral is for failures.** A state that is not yet done, turned off,
  stopped or refused by policy has its own status (`pending`, `off`,
  `refused`, `needs-you`). Never reach for `failed` to draw attention.
- **Never style a payload.** Text another program reads (the `rt cd` path,
  `git credential`, a key, a bare path) goes through `out.payload`, and a
  verb whose stdout is a payload calls `out.payloadOnStdout()` so its human
  text moves to stderr.
- **`--json` goes through `out.json` and is frozen.** Plain text off a TTY is
  not frozen: it carries the same wording as the styled output, so a skill
  must read `--json`, never scrape text.
- **No colors on the TS side.** `out.ts` holds no ANSI and no glyph styling;
  the theme lives in `ui/internal/theme` and nowhere else.
- **Body text takes the terminal's own foreground.** Only accents (glyphs,
  callout labels, keys, hints, rails) use theme colors, so output reads on a
  light terminal as well as a dark one. Never give body text a fixed color.

`lib/__tests__/no-raw-output.test.ts` fails a PR that adds `console.*`,
`process.stdout.write`, a raw escape or a color import under `commands/` or
`lib/`. Its allowlist (`raw-output-allowlist.json`) names the files not yet
converted and only shrinks: converting a file means deleting its line.
```

- [ ] **Step 2: Extend the description rule**

In the section `## Command descriptions are plain language`, append this paragraph at the end of the section:

```markdown
The same style governs every message a command prints: say what happened for
the person in a short plain sentence, speak to "you" and "this", leave out
flags, store names, file paths and step ids, and put the command to run in a
`next` callout rather than mid-sentence. Name only verbs that exist.
```

- [ ] **Step 3: Run every gate**

Run from the repo root, in order, and record each result in your report:

```bash
bun run ui:build
bun run ui:test
bun run typecheck
bun run test
bun run test:pty
bun run picker:check
bun run format:check
```

Expected: all pass. `bun run test:pty` is here because Task 6 changes what `rt-ui steps` paints. `bun run test` may show a failure in a file this branch does not touch; if so, re-run that one file alone and on a clean checkout of the base commit before calling it pre-existing, and say which it was.

- [ ] **Step 4: Check the text rules**

The byte sequences below are the UTF-8 encodings of the two banned dashes. The check covers source and `AGENTS.md`, not this plan.

```bash
CHANGED=$(git diff --name-only $(git merge-base HEAD origin/main)..HEAD -- ui lib commands AGENTS.md)
LC_ALL=C grep -n $'\xe2\x80\x94\|\xe2\x80\x93' $CHANGED || echo "no banned dashes"
git diff $(git merge-base HEAD origin/main)..HEAD -- ui lib commands AGENTS.md | grep -E '^\+' | grep -ciE 'load.bearing'
```

Expected: `no banned dashes`, and a count of `0` added lines carrying the banned phrase.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: the output layer contract, and plain language for messages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After this plan

- Open the PR against `m4ttstack/mattstack` with screenshots of the Task 5 and Task 8 smoke output in a real terminal, in the terminal's dark and light schemes.
- Phase 2 (errors) is planned next, against the `out.fail` and `failure` API this phase ships.
