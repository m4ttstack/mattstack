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
	out := strings.TrimRight(ansi.Strip(render.Render([]protocol.Block{b}, render.Options{Width: 200})), "\n")
	if out == "" {
		t.Fatal("paragraph rendered nothing")
	}
	for _, l := range strings.Split(out, "\n") {
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

func TestDiffTreatsAnUnknownKindAsContext(t *testing.T) {
	b := protocol.Block{T: "diff", Hunks: []protocol.DiffHunk{{Header: "@@", Lines: []protocol.DiffLine{{Kind: "mystery", Text: "x"}}}}}
	if got, want := plain(b), "  @@\n     x\n"; got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestTextBlocksTolerateEmptyFields(t *testing.T) {
	for _, typ := range []string{"paragraph", "copy", "verbatim", "diff"} {
		_ = plain(protocol.Block{T: typ})
	}
	if got := plain(protocol.Block{T: "diff", Hunks: []protocol.DiffHunk{{Header: "@@"}}}); got != "  @@\n" {
		t.Fatalf("got %q", got)
	}
}
