package render

import (
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/theme"
)

const calloutIndent = "    "

// lineRun renders consecutive lines, with any callouts between them, and
// pads hinted titles to one width so the hints line up. A hint wraps inside
// its own column. A hint holding a word wider than that column takes the
// row below its title, whole, so a ref or a path is never cut; a title too
// wide to leave the hint a column worth wrapping into does the same and
// stays out of the alignment.
func (r *renderer) lineRun(run []protocol.Block) {
	textW := r.width - len(calloutIndent)
	titleCap := textW - 2 - minWrap
	w := 0
	for _, b := range run {
		if b.T != "line" || b.Hint == "" {
			continue
		}
		if tw := lipgloss.Width(Clean(b.Title)); tw <= titleCap {
			w = max(w, tw)
		}
	}
	for _, b := range run {
		if b.T == "callout" {
			r.callout(b)
			continue
		}
		head := indent + r.glyph(b.Status) + " "
		titleW := lipgloss.Width(Clean(b.Title))
		hint := protocol.Cell{{Text: b.Hint, Role: "faint"}}
		if b.Hint != "" && titleW <= titleCap {
			if longestWord(Clean(b.Hint)) > textW-w-2 {
				r.emit(head + textStyle.Render(Clean(b.Title)))
				for _, row := range wrapCell(hint, textW) {
					r.emit(calloutIndent + r.cell(row))
				}
				continue
			}
			for i, row := range wrapCell(hint, textW-w-2) {
				if i == 0 {
					r.emit(head + textStyle.Render(pad(Clean(b.Title), w)) + "  " + r.cell(row))
					continue
				}
				r.emit(calloutIndent + strings.Repeat(" ", w+2) + r.cell(row))
			}
			continue
		}
		title := wrapCell(protocol.Cell{{Text: b.Title}}, textW)
		inline := b.Hint != "" && len(title) == 1 && titleW+2+lipgloss.Width(Clean(b.Hint)) <= textW
		for i, row := range title {
			s := calloutIndent + r.cell(row)
			if i == 0 {
				s = head + r.cell(row)
			}
			if inline {
				s += "  " + r.cell(hint)
			}
			r.emit(s)
		}
		if b.Hint != "" && !inline {
			for _, row := range wrapCell(hint, textW) {
				r.emit(calloutIndent + r.cell(row))
			}
		}
	}
}

func longestWord(s string) int {
	n := 0
	for _, word := range strings.Fields(s) {
		n = max(n, lipgloss.Width(word))
	}
	return n
}

func (r *renderer) calloutColor(label string) color.Color {
	switch label {
	case "next", "fix":
		return r.p.tones.Peach
	case "why":
		return r.p.tones.Quiet
	}
	return r.p.tones.Lav
}

func (r *renderer) callout(b protocol.Block) {
	r.calloutLines(r.calloutColor(b.Label), b.Label, b.Body)
}

func (r *renderer) calloutLines(c color.Color, label string, body []protocol.Cell) {
	label = Clean(label)
	bar := calloutIndent + fg(c).Render(theme.GlyphBar) + " "
	cont := bar + strings.Repeat(" ", lipgloss.Width(label)+1)
	w := min(r.width-lipgloss.Width(cont), paragraphMax)
	first := true
	for _, line := range body {
		for _, row := range calloutRows(line, w) {
			if first {
				r.emit(bar + fg(c).Render(label) + " " + r.cell(row))
				first = false
				continue
			}
			r.emit(cont + r.cell(row))
		}
	}
}

// calloutRows breaks one body row. A command is pasted whole, so it is never
// split: a row that is only a command stays whole, a command that ends a row
// of prose takes a row of its own, and any other row wraps at its spaces
// with each command kept on one row.
func calloutRows(line protocol.Cell, w int) []protocol.Cell {
	if !hasCommand(line) {
		return wrapCell(line, w)
	}
	if prose, command, ok := trailingCommand(line); ok {
		return append(calloutRows(prose, w), command)
	}
	if onlyCommands(line) || widestCommand(line) > w {
		return []protocol.Cell{line}
	}
	glued := withCommandSpaces([]protocol.Cell{line}, " ", nbsp)[0]
	return withCommandSpaces(wrapCell(glued, w), nbsp, " ")
}

// nbsp holds a command together through wrapCell, which breaks only at
// plain spaces.
const nbsp = string(rune(0xA0))

// trailingCommand splits a row whose one command is its last segment into
// the prose before it and the command.
func trailingCommand(line protocol.Cell) (protocol.Cell, protocol.Cell, bool) {
	n := len(line)
	if n < 2 || line[n-1].Role != "command" {
		return nil, nil, false
	}
	prose := append(protocol.Cell(nil), line[:n-1]...)
	var words strings.Builder
	for _, s := range prose {
		if s.Role == "command" {
			return nil, nil, false
		}
		words.WriteString(s.Text)
	}
	if strings.TrimSpace(Clean(words.String())) == "" {
		return nil, nil, false
	}
	prose[n-2].Text = strings.TrimRight(prose[n-2].Text, " ")
	return prose, protocol.Cell{line[n-1]}, true
}

func onlyCommands(line protocol.Cell) bool {
	for _, s := range line {
		if s.Role != "command" && strings.TrimSpace(s.Text) != "" {
			return false
		}
	}
	return true
}

func widestCommand(line protocol.Cell) int {
	n := 0
	for _, s := range line {
		if s.Role == "command" {
			n = max(n, lipgloss.Width(Clean(s.Text)))
		}
	}
	return n
}

// withCommandSpaces swaps from for to inside command segments only.
func withCommandSpaces(rows []protocol.Cell, from, to string) []protocol.Cell {
	out := make([]protocol.Cell, len(rows))
	for i, row := range rows {
		out[i] = make(protocol.Cell, len(row))
		for j, s := range row {
			if s.Role == "command" {
				s.Text = strings.ReplaceAll(s.Text, from, to)
			}
			out[i][j] = s
		}
	}
	return out
}

// kvRun pads a run of kv keys to one width so the values line up. A key too
// wide to leave its value a column worth wrapping into stays out of the
// alignment and takes its value on the row below.
func (r *renderer) kvRun(run []protocol.Block) {
	textW := r.width - len(indent)
	keyCap := textW - 2 - minWrap
	w := 0
	for _, b := range run {
		if kw := lipgloss.Width(Clean(b.Key)); b.Value != "" && kw <= keyCap {
			w = max(w, kw)
		}
	}
	for _, b := range run {
		key := r.p.key.Render(Clean(b.Key))
		value := protocol.Cell{{Text: b.Value, Role: "strong"}}
		switch {
		case b.Value == "":
			r.emit(indent + key)
		case lipgloss.Width(key) <= keyCap:
			for i, row := range wrapCell(value, textW-w-2) {
				if i == 0 {
					r.emit(indent + pad(key, w) + "  " + r.cell(row))
					continue
				}
				r.emit(indent + strings.Repeat(" ", w+2) + r.cell(row))
			}
		default:
			r.emit(indent + key)
			for _, row := range wrapCell(value, textW-2) {
				r.emit(indent + "  " + r.cell(row))
			}
		}
		if b.Source != "" {
			r.emit(indent + "  " + r.p.dim.Render(Clean(b.Source)))
		}
	}
}

func (r *renderer) summary(b protocol.Block) {
	r.gap()
	s := indent + r.glyph(b.Status) + " " + strongStyle.Render(Clean(b.Title))
	if len(b.Counts) > 0 {
		counts := make([]string, len(b.Counts))
		for i, c := range b.Counts {
			counts[i] = Clean(c)
		}
		s += "  " + r.p.dim.Render(strings.Join(counts, " · "))
	}
	r.emit(s)
}

func (r *renderer) banner(b protocol.Block) {
	s := indent + fg(r.p.tones.Coral).Bold(true).Render(theme.GlyphBar+" "+Clean(b.Label)) + " " + strongStyle.Render(Clean(b.Subject))
	if b.Hint != "" {
		s += "  " + r.p.dim.Render(Clean(b.Hint))
	}
	r.emit(s)
}

func (r *renderer) failure(b protocol.Block) {
	w := min(r.width-len(calloutIndent), paragraphMax)
	title := wrapCell(protocol.Cell{{Text: b.Title}}, w)
	hint := Clean(b.Hint)
	inline := hint != "" && len(title) == 1 &&
		lipgloss.Width(Clean(b.Title))+2+lipgloss.Width(hint) <= w
	for i, row := range title {
		s := calloutIndent + r.cell(row)
		if i == 0 {
			s = indent + r.glyph("failed") + " " + r.cell(row)
		}
		if inline {
			s += "  " + r.p.dim.Render(hint)
		}
		r.emit(s)
	}
	if hint != "" && !inline {
		for _, row := range wrapCell(protocol.Cell{{Text: hint, Role: "faint"}}, w) {
			r.emit(calloutIndent + r.cell(row))
		}
	}
	if b.Why != "" {
		r.calloutLines(r.p.tones.Quiet, "why", []protocol.Cell{{{Text: b.Why}}})
	}
	if len(b.Next) > 0 {
		r.calloutLines(r.p.tones.Peach, "next", []protocol.Cell{b.Next})
	}
	if b.Details != "" {
		dw := min(r.width-len(calloutIndent), paragraphMax)
		for _, l := range splitLines(b.Details) {
			for _, row := range wrapCell(protocol.Cell{{Text: l, Role: "faint"}}, dw) {
				r.emit(calloutIndent + r.cell(row))
			}
		}
	}
}
