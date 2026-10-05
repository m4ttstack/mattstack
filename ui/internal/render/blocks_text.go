package render

import (
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/protocol"
	"rt-ui/internal/textwrap"
	"rt-ui/internal/theme"
)

const paragraphMax = 76

// cleanCode is Clean for literal text: a tab becomes four spaces so code and
// JSON keep their shape.
func cleanCode(s string) string {
	return Clean(strings.ReplaceAll(s, "\t", "    "))
}

func (r *renderer) caption(s string) {
	if s != "" {
		r.emit(calloutIndent + r.p.dim.Render(Clean(s)))
	}
}

// paragraph repeats each line's leading spaces on every row it wraps to, so
// a continuation row never starts at the column a table row starts at: a
// chat body wrapped back to the author's column would forge an author row.
func (r *renderer) paragraph(b protocol.Block) {
	w := min(r.width-2*len(indent), paragraphMax)
	for _, para := range splitLines(b.Text) {
		lead, rest := hangingIndent(Clean(para), w)
		for _, l := range strings.Split(lipgloss.Wrap(rest, max(w-len(lead), 1), ""), "\n") {
			r.emit(indent + textStyle.Render(strings.TrimRight(lead+l, " ")))
		}
	}
}

// hangingIndent splits s into its leading spaces and the rest. A lead too
// wide to leave minWrap columns is cut down, but never below one space, so
// the rows still fit the column and still sit right of it.
func hangingIndent(s string, w int) (string, string) {
	rest := strings.TrimLeft(s, " ")
	n := len(s) - len(rest)
	if n > 0 {
		n = max(1, min(n, w-minWrap))
	}
	return strings.Repeat(" ", n), rest
}

// copy prints its text at column 0 with no rail, never wrapped and never
// restyled inside, so a drag-select pastes it clean. That is also why it
// must never carry untrusted multi-line text: a line here could pose as
// output.
func (r *renderer) copy(b protocol.Block) {
	r.caption(b.Caption)
	for _, l := range splitLines(b.Text) {
		r.emit(textStyle.Render(Clean(l)))
	}
	r.afterCopy = true
}

func (r *renderer) verbatim(b protocol.Block) {
	if b.Caption == "why" {
		body := textLines(b.Lines)
		for _, line := range body {
			line[0].Text = cleanCode(line[0].Text)
		}
		r.calloutLines(r.p.tones.Quiet, "why", body)
		return
	}
	r.caption(b.Caption)
	rail := calloutIndent + r.p.rule.Render("│") + " "
	w := r.width - lipgloss.Width(rail)
	for _, line := range b.Lines {
		for _, l := range splitLines(line) {
			for _, row := range codeRows(cleanCode(l), w) {
				r.emit(rail + r.p.dim.Render(row))
			}
		}
	}
}

func textLines(lines []string) []protocol.Cell {
	var body []protocol.Cell
	for _, line := range lines {
		for _, text := range splitLines(line) {
			body = append(body, protocol.Cell{{Text: text}})
		}
	}
	return body
}

// codeRows wraps a literal line at its spaces, and a word too wide for the
// row at a separator, and hangs every row under the line's own indent. Only
// the spaces at a break are dropped, so the end of a stack line still
// carries its file and line number.
func codeRows(s string, w int) []string {
	if w < minWrap || ansi.StringWidth(s) <= w {
		return []string{s}
	}
	lead, rest := hangingIndent(s, w)
	same := func(t string) string { return t }
	with := func(_, t string) string { return t }
	rows := textwrap.SpansWith([]string{rest}, w-len(lead), textwrap.Options{WordsOnly: true, Separators: separators}, same, with)
	out := make([]string, len(rows))
	for i, row := range rows {
		out[i] = lead + strings.Join(row, "")
	}
	return out
}

func (r *renderer) diff(b protocol.Block) {
	add := lipgloss.NewStyle().Foreground(theme.Mint).Background(theme.DiffAddBg)
	del := lipgloss.NewStyle().Foreground(theme.Coral).Background(theme.DiffDelBg)
	if r.light {
		// Mint and coral text wash out on a pale tint. The ink is fixed, not
		// the terminal's own, so the row reads even when the resolved
		// background is wrong.
		add = lipgloss.NewStyle().Foreground(theme.Bg).Background(theme.DiffAddBgLight)
		del = lipgloss.NewStyle().Foreground(theme.Bg).Background(theme.DiffDelBgLight)
	}
	avail := r.width - len(indent)
	for _, h := range b.Hunks {
		r.emit(indent + r.p.key.Render(Clean(h.Header)))
		w := 0
		for _, l := range h.Lines {
			w = max(w, lipgloss.Width(cleanCode(l.Text)))
		}
		w = min(w+3, avail)
		for _, l := range h.Lines {
			sign, band := "   ", textStyle
			switch l.Kind {
			case "add":
				sign, band = " + ", add
			case "del":
				sign, band = " - ", del
			}
			for i, row := range diffRows(cleanCode(l.Text), w-3) {
				s := sign
				if i > 0 {
					s = "   "
				}
				if l.Kind == "add" || l.Kind == "del" {
					r.emit(indent + band.Render(pad(s+row, w)))
				} else {
					r.emit(indent + band.Render(s+row))
				}
			}
		}
	}
}

// diffRows wraps a line of code as the mission diff does, at spaces and
// hyphens, and cuts a word wider than the pane, so a band never runs past it.
func diffRows(s string, w int) []string {
	w = max(1, w)
	same := func(t string) string { return t }
	with := func(_, t string) string { return t }
	rows := textwrap.Spans([]string{s}, w, same, with)
	out := make([]string, len(rows))
	for i, row := range rows {
		out[i] = strings.Join(row, "")
	}
	return out
}
