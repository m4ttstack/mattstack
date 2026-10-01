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
	want := "    send this link\n    │ " + long + "\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestCopyBlockKeepsEachOfItsLines(t *testing.T) {
	got := plain(protocol.Block{T: "copy", Text: "line one\nline two"})
	want := "    │ line one\n    │ line two\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestVerbatimSplitsALineThatHoldsANewline(t *testing.T) {
	got := plain(protocol.Block{T: "verbatim", Lines: []string{"a\nb", "c"}})
	want := "    │ a\n    │ b\n    │ c\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestALongVerbatimLineIsCutWithTheRailOnEveryRow(t *testing.T) {
	line := "    at run (/Users/sample/.mattstack/user/plugins/seam-fixture-with-a-long-name/boom.ts:1:41)"
	got := ansi.Strip(render.Render([]protocol.Block{{T: "verbatim", Lines: []string{line}}}, render.Options{Width: 60}))
	want := "    │ " + line[:54] + "\n    │ " + line[54:] + "\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestParagraphTreatsACarriageReturnAsALineBreak(t *testing.T) {
	if got, want := plain(protocol.Block{T: "paragraph", Text: "one\r\ntwo\rthree"}), "  one\n  two\n  three\n"; got != want {
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

func TestLightBackgroundReadsColorfgbg(t *testing.T) {
	for value, want := range map[string]bool{
		"": false, "15;0": false, "7;8": false, "12;default": false, "0;99": false,
		"0;15": true, "0;default;15": true, "0;7": true,
	} {
		if got := render.LightBackground(value); got != want {
			t.Errorf("COLORFGBG=%q: got %v want %v", value, got, want)
		}
	}
}

func TestDiffTintsFollowTheBackground(t *testing.T) {
	blocks := []protocol.Block{{T: "diff", Hunks: []protocol.DiffHunk{{Header: "@@ -1 +1 @@", Lines: []protocol.DiffLine{{Kind: "del", Text: "old();"}, {Kind: "add", Text: "next();"}}}}}}
	dark := render.Render(blocks, render.Options{Width: 80})
	light := render.Render(blocks, render.Options{Width: 80, Light: true})
	for _, want := range []string{"48;2;59;34;49", "48;2;34;51;57"} {
		if !strings.Contains(dark, want) {
			t.Fatalf("dark render lost its tint %s: %q", want, dark)
		}
	}
	for _, want := range []string{"38;2;22;18;36;48;2;255;233;233", "38;2;22;18;36;48;2;229;251;241"} {
		if !strings.Contains(light, want) {
			t.Fatalf("light render has no dark ink on a pale tint %s: %q", want, light)
		}
	}
	if strings.Contains(light, coral) {
		t.Fatalf("light render kept coral text, which washes out on the pale tint: %q", light)
	}
}
