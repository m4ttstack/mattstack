package mission

import (
	"sort"
	"strings"

	"rt-ui/internal/textwrap"
)

func wrapSpans(spans []span, width int) [][]span {
	return textwrap.Spans(spans, width, spanText, withText)
}

func spanText(s span) string { return s.text }

func withText(s span, text string) span { return span{text: text, style: s.style} }

type diffRowIndex struct {
	key      *DiffLine
	n, width int
	start    []int
}

// diffRows is the screen-row layout of the current diff at textW, shared by
// the renderer, the viewport and diffHit so a click always maps to what was
// painted. It counts from DiffLine.Text less a CRLF ending, the exact text
// diffLineSpans guarantees every painted span list carries. Like forDiff
// it keys on the decoded Lines backing array, which each model push
// replaces; holding &Lines[0] keeps that array alive, so its address cannot
// be reused while cached.
func (m *Mission) diffRows(textW int) *diffRowIndex {
	lines := m.model.Diff.Lines
	ix := &m.diffRowsCache
	if len(lines) > 0 && ix.key == &lines[0] && ix.n == len(lines) && ix.width == textW {
		return ix
	}
	ix.start = make([]int, len(lines)+1)
	for i, l := range lines {
		rows := 1
		if l.Kind != "hunk" {
			rows = len(wrapSpans([]span{{text: strings.TrimSuffix(l.Text, "\r")}}, textW))
		}
		ix.start[i+1] = ix.start[i] + rows
	}
	ix.n, ix.width = len(lines), textW
	ix.key = nil
	if len(lines) > 0 {
		ix.key = &lines[0]
	}
	return ix
}

func (ix *diffRowIndex) total() int { return ix.start[ix.n] }

func (ix *diffRowIndex) lineAt(row int) int {
	return sort.Search(ix.n, func(i int) bool { return ix.start[i+1] > row })
}
