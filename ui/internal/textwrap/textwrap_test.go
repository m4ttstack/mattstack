package textwrap

import (
	"reflect"
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"

	"github.com/charmbracelet/x/ansi"
)

type run struct {
	text  string
	style string
}

func runText(r run) string { return r.text }

func withText(r run, text string) run { return run{text: text, style: r.style} }

func wrap(runs []run, width int) [][]run { return Spans(runs, width, runText, withText) }

func text(runs []run) string { return join(runs, runText) }

func TestSpansKeepsAStyleAcrossTheBreak(t *testing.T) {
	rows := wrap([]run{{text: "x := "}, {text: `"a long string literal"`, style: "mint"}}, 12)
	if len(rows) < 2 {
		t.Fatalf("expected a wrap, got %d rows", len(rows))
	}
	last := rows[len(rows)-1]
	if last[len(last)-1].style != "mint" {
		t.Fatalf("the literal's tail lost its style: %+v", last)
	}
	var joined strings.Builder
	for _, r := range rows {
		joined.WriteString(text(r))
	}
	if strings.ReplaceAll(joined.String(), " ", "") != strings.ReplaceAll(`x := "a long string literal"`, " ", "") {
		t.Fatalf("characters lost or duplicated: %q", joined.String())
	}
}

func TestSpansShortLineIsOneRow(t *testing.T) {
	if rows := wrap([]run{{text: "short"}}, 40); len(rows) != 1 {
		t.Fatalf("got %d rows", len(rows))
	}
}

func TestSpansEmptyLineIsOneRow(t *testing.T) {
	if rows := wrap(nil, 40); len(rows) != 1 {
		t.Fatalf("got %d rows", len(rows))
	}
	if rows := wrap([]run{{text: "\t\t\t      "}}, 5); len(rows) != 1 {
		t.Fatalf("a blank line wider than the row got %d rows", len(rows))
	}
}

func TestSpansShortLineNeverPaintsARawCarriageReturn(t *testing.T) {
	rows := wrap([]run{{text: "a\rb"}}, 40)
	if len(rows) != 1 || text(rows[0]) != "a b" {
		t.Fatalf("a lone \\r should paint as one space cell: %+v", rows)
	}
}

func TestSpansIndentWiderThanTheRowPaintsNoBlankRow(t *testing.T) {
	rows := wrap([]run{{text: "\t\t\treturn nil"}}, 8)
	if len(rows) == 0 || text(rows[0]) != "return" {
		t.Fatalf("the first row should carry the first word: %+v", rows)
	}
}

func dropSpace(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, s)
}

// ansi.Wrap measures in cells and breaks at any Unicode space while the
// runs are sliced by byte, so a tab (painted as spaces), a lone \r or \v
// (painted raw, zero cells, but moving the terminal's cursor), wide runes
// and an ideographic space at a break are where the two could drift apart.
func TestSpansTabsWideRunesAndUnicodeSpacesStayAligned(t *testing.T) {
	in := []run{
		{text: "\tif", style: "keyword"},
		{text: " x := \"漢字かな漢字かな漢字　カタカナ\tabc 한국어\r텍스트\" //\v注释 done"},
	}
	want := dropSpace(text(in))
	for width := 3; width <= 40; width++ {
		rows := wrap(in, width)
		var joined strings.Builder
		for r, row := range rows {
			s := text(row)
			if strings.ContainsAny(s, "\t\r\v\f") {
				t.Fatalf("width %d row %d kept a control space the painter mismeasures: %q", width, r, s)
			}
			if w := ansi.StringWidth(s); w > width {
				t.Fatalf("width %d row %d is %d cells, so the clip would drop text: %q", width, r, w, s)
			}
			joined.WriteString(s)
		}
		if got := dropSpace(joined.String()); got != want {
			t.Fatalf("width %d lost or duplicated text:\n got %q\nwant %q", width, got, want)
		}
		if rows[0][0].style != "keyword" {
			t.Fatalf("width %d: the keyword lost its style: %+v", width, rows[0])
		}
	}
}

func wrapWords(runs []run, width int) [][]run {
	return SpansWith(runs, width, Options{WordsOnly: true}, runText, withText)
}

func rowTexts(rows [][]run) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = text(r)
	}
	return out
}

// Spans is the mission diff wrap: it breaks after a hyphen, and SpansWith
// must leave that alone.
func TestSpansStillBreaksAfterAHyphen(t *testing.T) {
	in := []run{{text: "push with --force-with-lease now"}}
	want := []string{"push with --", "force-with-lease", "now"}
	if got := rowTexts(wrap(in, 16)); !reflect.DeepEqual(got, want) {
		t.Fatalf("Spans rows changed: %q", got)
	}
	if got := rowTexts(SpansWith(in, 16, Options{}, runText, withText)); !reflect.DeepEqual(got, want) {
		t.Fatalf("zero Options must be Spans: %q", got)
	}
}

func TestWordsOnlyKeepsAFlagWhole(t *testing.T) {
	got := rowTexts(wrapWords([]run{{text: "push with --force-with-lease now"}}, 20))
	want := []string{"push with", "--force-with-lease", "now"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestWordsOnlyCutsAnOverlongWordBetweenClusters(t *testing.T) {
	word := strings.Repeat("e"+string(rune(0x301)), 30)
	rows := rowTexts(wrapWords([]run{{text: "a " + word}}, 20))
	if len(rows) != 3 {
		t.Fatalf("got %d rows: %q", len(rows), rows)
	}
	for i, r := range rows {
		first, _ := utf8.DecodeRuneInString(r)
		if unicode.Is(unicode.Mn, first) {
			t.Fatalf("row %d starts with a combining mark: %q", i, r)
		}
		if w := ansi.StringWidth(r); w > 20 {
			t.Fatalf("row %d is %d cells", i, w)
		}
	}
	if strings.Join(rows, "") != "a"+word {
		t.Fatalf("text lost: %q", rows)
	}
}

func TestWordsOnlyKeepsAStyleAcrossTheBreakAndTheIndentation(t *testing.T) {
	rows := wrapWords([]run{{text: "  x := "}, {text: `"a long string literal"`, style: "mint"}}, 12)
	want := []string{`  x := "a`, "long string", `literal"`}
	if got := rowTexts(rows); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
	last := rows[len(rows)-1]
	if last[len(last)-1].style != "mint" {
		t.Fatalf("the literal's tail lost its style: %+v", last)
	}
}

func TestWordsOnlyShortAndBlankLinesAreOneRow(t *testing.T) {
	if rows := wrapWords([]run{{text: "short"}}, 40); len(rows) != 1 {
		t.Fatalf("got %d rows", len(rows))
	}
	if rows := wrapWords(nil, 40); len(rows) != 1 {
		t.Fatalf("got %d rows", len(rows))
	}
	if rows := wrapWords([]run{{text: "\t\t\t      "}}, 5); len(rows) != 1 {
		t.Fatalf("a blank line wider than the row got %d rows", len(rows))
	}
}

func TestWordsOnlyLosesNoTextAtAnyWidth(t *testing.T) {
	in := []run{
		{text: "\tif", style: "keyword"},
		{text: " x := \"漢字かな漢字かな漢字　カタカナ\tabc 한국어\r텍스트\" //\v注释 done"},
	}
	want := dropSpace(text(in))
	for width := 3; width <= 40; width++ {
		rows := wrapWords(in, width)
		var joined strings.Builder
		for r, row := range rows {
			s := text(row)
			if strings.ContainsAny(s, "\t\r\v\f") {
				t.Fatalf("width %d row %d kept a control space: %q", width, r, s)
			}
			if w := ansi.StringWidth(s); w > width {
				t.Fatalf("width %d row %d is %d cells: %q", width, r, w, s)
			}
			joined.WriteString(s)
		}
		if got := dropSpace(joined.String()); got != want {
			t.Fatalf("width %d lost or duplicated text:\n got %q\nwant %q", width, got, want)
		}
	}
}
