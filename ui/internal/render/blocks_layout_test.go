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

func TestUnknownOpsAndAbsentFieldsDoNotPanic(t *testing.T) {
	_ = plain(
		protocol.Block{T: "changes", Changes: []protocol.ChangeRow{{Op: "?", Name: "x"}, {}}},
		protocol.Block{T: "tree"},
		protocol.Block{T: "section"},
		protocol.Block{T: "table", Headers: []string{"A"}},
		protocol.Block{T: "table", Rows: []protocol.TableRow{{}, {Group: "G"}}},
	)
}

func TestTableRuleAndTreeBranchesUseTheStaticRuleTone(t *testing.T) {
	const staticRule = "38;2;115;109;150"
	table := styled(protocol.Block{T: "table", Headers: []string{"KEY"}, Rows: []protocol.TableRow{cells("a")}})
	if !strings.Contains(table, "\x1b["+staticRule+"m───") {
		t.Fatalf("table rule tone: %q", table)
	}
	tree := styled(protocol.Block{T: "tree", Root: text("root"), Children: [][]protocol.Cell{{text("child")}}})
	if !strings.Contains(tree, "\x1b["+staticRule+"m╰── ") {
		t.Fatalf("tree branch tone: %q", tree)
	}
}

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
