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
