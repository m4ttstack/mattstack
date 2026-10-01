// Package textwrap breaks a line of styled runs into rows without losing a
// run's style at the break.
package textwrap

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/charmbracelet/x/ansi"
)

// controlSpaces rewrites the whitespace ansi.Wrap and lipgloss measure
// differently: ansi.Wrap counts each as one cell, while lipgloss paints a
// tab as four and passes \r, \v and \f through raw at zero width, where the
// terminal moves its cursor (a \r repaints the row over its own gutter).
var controlSpaces = strings.NewReplacer("\t", "    ", "\r", " ", "\v", " ", "\f", " ")

// Spans breaks a line at ansi.Wrap's word boundaries, computed on the plain
// text: ansi.Wrap on painted text neither reopens a style on the next row
// nor keeps the whitespace it breaks at, so the runs are sliced at the break
// points instead. text reads a run's text and with returns the run holding
// other text in the same style.
func Spans[T any](runs []T, width int, text func(T) string, with func(T, string) T) [][]T {
	runs = normalizeSpaces(runs, text, with)
	plain := join(runs, text)
	if width < 1 || ansi.StringWidth(plain) <= width {
		return [][]T{runs}
	}
	rows := strings.Split(ansi.Wrap(plain, width, ""), "\n")
	out := make([][]T, 0, len(rows))
	pos := 0
	for _, r := range rows {
		// Indentation wider than the whole row comes back as an empty
		// first row, which would paint a gutter beside nothing.
		if r == "" {
			continue
		}
		// Every row is a byte-exact substring of plain; the only bytes
		// between two rows are the whitespace run ansi.Wrap dropped, which
		// can be any Unicode space (an ideographic space included).
		for pos < len(plain) && !strings.HasPrefix(plain[pos:], r) {
			c, size := utf8.DecodeRuneInString(plain[pos:])
			if !unicode.IsSpace(c) {
				break
			}
			pos += size
		}
		out = append(out, slice(runs, pos, pos+len(r), text, with))
		pos += len(r)
	}
	if len(out) == 0 {
		return [][]T{nil}
	}
	return out
}

func join[T any](runs []T, text func(T) string) string {
	var b strings.Builder
	for _, r := range runs {
		b.WriteString(text(r))
	}
	return b.String()
}

func normalizeSpaces[T any](runs []T, text func(T) string, with func(T, string) T) []T {
	if !strings.ContainsAny(join(runs, text), "\t\r\v\f") {
		return runs
	}
	out := make([]T, len(runs))
	for i, r := range runs {
		out[i] = with(r, controlSpaces.Replace(text(r)))
	}
	return out
}

func slice[T any](runs []T, from, to int, text func(T) string, with func(T, string) T) []T {
	var out []T
	at := 0
	for _, r := range runs {
		t := text(r)
		lo, hi := at, at+len(t)
		at = hi
		if hi <= from || lo >= to {
			continue
		}
		a, b := max(from, lo)-lo, min(to, hi)-lo
		out = append(out, with(r, t[a:b]))
	}
	return out
}

// Options changes where a line may break. The zero value is Spans.
type Options struct {
	// WordsOnly breaks at whitespace and nowhere else: a hyphen is not a
	// break point, so a flag or a branch name stays whole, and a word wider
	// than the row is cut between grapheme clusters, so a combining mark
	// never starts a row without its base.
	WordsOnly bool
}

// SpansWith is Spans with Options applied.
func SpansWith[T any](runs []T, width int, opts Options, text func(T) string, with func(T, string) T) [][]T {
	if !opts.WordsOnly {
		return Spans(runs, width, text, with)
	}
	runs = normalizeSpaces(runs, text, with)
	plain := join(runs, text)
	if width < 1 || ansi.StringWidth(plain) <= width {
		return [][]T{runs}
	}
	bounds := wordRows(plain, width)
	if len(bounds) == 0 {
		return [][]T{nil}
	}
	out := make([][]T, len(bounds))
	for i, b := range bounds {
		out[i] = slice(runs, b[0], b[1], text, with)
	}
	return out
}

type piece struct {
	from, to, width int
	space           bool
}

// pieces splits s into alternating runs of whitespace and of everything
// else, measured in cells. A no-break space belongs to its word.
func pieces(s string) []piece {
	var out []piece
	for i := 0; i < len(s); {
		cluster, w := ansi.FirstGraphemeCluster(s[i:], ansi.GraphemeWidth)
		if cluster == "" {
			break
		}
		r, _ := utf8.DecodeRuneInString(cluster)
		space := unicode.IsSpace(r) && r != 0xA0
		if n := len(out); n > 0 && out[n-1].space == space {
			out[n-1].to += len(cluster)
			out[n-1].width += w
		} else {
			out = append(out, piece{from: i, to: i + len(cluster), width: w, space: space})
		}
		i += len(cluster)
	}
	return out
}

// wordRows returns the byte range of every row. The whitespace a row breaks
// at belongs to no row; indentation before the first word stays on its row.
func wordRows(s string, width int) [][2]int {
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
			if start >= 0 && used+w > width {
				flush()
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
