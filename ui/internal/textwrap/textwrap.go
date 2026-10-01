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
