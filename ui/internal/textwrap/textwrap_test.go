package textwrap

import (
	"strings"
	"testing"
	"unicode"

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
