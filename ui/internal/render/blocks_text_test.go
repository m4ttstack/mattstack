package render_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/background"
	"rt-ui/internal/protocol"
	"rt-ui/internal/render"
)

const missionCoral = "255;121;121"

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

func TestAWrappedIndentedLineCannotForgeARowAtTheTableColumn(t *testing.T) {
	body := "  ok\n  " + strings.Repeat("a", 72) + " fred  12:05\n  looks good, ship it"
	for _, w := range []int{40, 80, 120} {
		got := plainAt(w, protocol.Block{T: "section", Title: "#r", Blocks: []protocol.Block{
			{T: "table", Rows: []protocol.TableRow{cells("mal", "12:04")}},
			{T: "paragraph", Text: body},
		}})
		var atTable []string
		for _, l := range rows(got) {
			if strings.HasPrefix(l, "  ") && !strings.HasPrefix(l, "   ") {
				atTable = append(atTable, l)
			}
		}
		if len(atTable) != 2 || atTable[0] != "  #r" || !strings.HasPrefix(atTable[1], "  mal") {
			t.Fatalf("width %d: rows at the table column are %q:\n%s", w, atTable, got)
		}
		if w >= 80 && !strings.Contains(got, "\n    fred  12:05\n") {
			t.Fatalf("width %d: the wrapped row lost its indent:\n%s", w, got)
		}
	}
}

func TestAParagraphLeadWiderThanTheColumnStillFitsAndStaysIndented(t *testing.T) {
	text := strings.Repeat(" ", 90) + strings.Repeat("word ", 30)
	got := plainAt(40, protocol.Block{T: "paragraph", Text: text})
	checkWidth(t, got, 40)
	for _, l := range rows(got) {
		if !strings.HasPrefix(l, "   ") {
			t.Fatalf("row lost its hanging indent: %q\n%s", l, got)
		}
	}
	if strings.Count(got, "word") != 30 {
		t.Fatalf("words were lost:\n%s", got)
	}
}

func TestCopyBlockIsNeverWrapped(t *testing.T) {
	long := "example://join?invite=" + strings.Repeat("a", 120)
	got := ansi.Strip(render.Render([]protocol.Block{{T: "copy", Caption: "send this link", Text: long}}, render.Options{Width: 40}))
	want := "    send this link\n" + long + "\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestCopyBlockKeepsEachOfItsLines(t *testing.T) {
	got := plain(protocol.Block{T: "copy", Text: "line one\nline two"})
	want := "line one\nline two\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestACopyBlockPrintsAtColumnZeroWithNoRail(t *testing.T) {
	got := plain(protocol.Block{T: "copy", Caption: "message to send", Text: "Join the team:\n  rt team join sample\x1b[2J"})
	want := "    message to send\nJoin the team:\n  rt team join sample\n"
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
	if !strings.Contains(styled(b), missionCoral) {
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

func TestDiffTintsFollowTheBackground(t *testing.T) {
	blocks := []protocol.Block{{T: "diff", Hunks: []protocol.DiffHunk{{Header: "@@ -1 +1 @@", Lines: []protocol.DiffLine{{Kind: "del", Text: "old();"}, {Kind: "add", Text: "next();"}}}}}}
	dark := render.Render(blocks, render.Options{Width: 80, Background: background.Dark})
	light := render.Render(blocks, render.Options{Width: 80, Background: background.Light})
	unknown := render.Render(blocks, render.Options{Width: 80})
	for _, want := range []string{"48;2;59;34;49", "48;2;34;51;57"} {
		if !strings.Contains(dark, want) || !strings.Contains(unknown, want) {
			t.Fatalf("dark or unknown render lost its tint %s:\n%q\n%q", want, dark, unknown)
		}
	}
	for _, want := range []string{"38;2;22;18;36;48;2;255;233;233", "38;2;22;18;36;48;2;229;251;241"} {
		if !strings.Contains(light, want) {
			t.Fatalf("light render has no dark ink on a pale tint %s: %q", want, light)
		}
	}
	if strings.Contains(light, missionCoral) {
		t.Fatalf("light render kept coral text, which washes out on the pale tint: %q", light)
	}
}

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

func TestALongDiffLineStaysInsideTheNarrowestPane(t *testing.T) {
	long := "next(alpha, beta, gamma, delta, epsilon, zeta);"
	got := plainAt(20, protocol.Block{T: "diff", Hunks: []protocol.DiffHunk{{Header: "@@ -1 +1 @@", Lines: []protocol.DiffLine{
		{Kind: "del", Text: "old();"},
		{Kind: "add", Text: long},
	}}}})
	checkWidth(t, got, 20)
	rs := rows(got)
	if noSpace(strings.Join(rs[1:], "")) != "-old();+"+noSpace(long) {
		t.Fatalf("the diff lost text:\n%s", got)
	}
}

func TestABlockAfterACopyBlockStartsAfterOneBlankRow(t *testing.T) {
	copyBlock := protocol.Block{T: "copy", Caption: "send this link", Text: "example://join?invite=abc123"}
	line := protocol.Block{T: "line", Status: "done", Title: "Invite created"}
	if got, want := plain(copyBlock, line), "    send this link\nexample://join?invite=abc123\n\n  ✓ Invite created\n"; got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
	if got, want := plain(copyBlock, copyBlock), "    send this link\nexample://join?invite=abc123\n\n    send this link\nexample://join?invite=abc123\n"; got != want {
		t.Fatalf("two copies: got\n%q\nwant\n%q", got, want)
	}
	if got, want := plain(copyBlock, protocol.Block{T: "blank"}, line), "    send this link\nexample://join?invite=abc123\n\n  ✓ Invite created\n"; got != want {
		t.Fatalf("a blank after a copy: got\n%q\nwant\n%q", got, want)
	}
	nested := protocol.Block{T: "section", Title: "Invite", Blocks: []protocol.Block{copyBlock}}
	if got, want := plain(nested, line), "  Invite\n    send this link\nexample://join?invite=abc123\n\n  ✓ Invite created\n"; got != want {
		t.Fatalf("a copy ending a section: got\n%q\nwant\n%q", got, want)
	}
	if got := plain(line, copyBlock); strings.HasSuffix(got, "\n\n") {
		t.Fatalf("a copy left a trailing blank row: %q", got)
	}
}

func TestAVerbatimWhyKeepsTabIndentationAndLineBreaks(t *testing.T) {
	want := "    ▌ why     root\n" +
		"    ▌     " + strings.Repeat(" ", 8) + "child\n" +
		"    ▌         end\n" +
		"    ▌         final\n"
	for _, lines := range [][]string{
		{"\troot\r\n\t\tch\x1b[2Jild\n\tend\u202e", "\tfinal"},
		{"\troot", "\t\tch\x1b[2Jild", "\tend\u202e", "\tfinal"},
	} {
		original := append([]string(nil), lines...)
		got := plainAt(40, protocol.Block{T: "verbatim", Caption: "why", Lines: lines})
		checkWidth(t, got, 40)
		if got != want {
			t.Errorf("got\n%q\nwant\n%q", got, want)
		}
		for i, line := range lines {
			if line != original[i] {
				t.Errorf("input line %d changed from %q to %q", i, original[i], line)
			}
		}
	}
}
