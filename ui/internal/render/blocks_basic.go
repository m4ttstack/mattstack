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
// its own column; a title too wide to leave the hint a column worth wrapping
// into takes the hint on the rows below it and stays out of the alignment.
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
		head := indent + glyph(b.Status) + " "
		titleW := lipgloss.Width(Clean(b.Title))
		hint := protocol.Cell{{Text: b.Hint, Role: "faint"}}
		if b.Hint != "" && titleW <= titleCap {
			for i, row := range wrapCell(hint, textW-w-2) {
				if i == 0 {
					r.emit(head + textStyle.Render(pad(Clean(b.Title), w)) + "  " + cell(row))
					continue
				}
				r.emit(calloutIndent + strings.Repeat(" ", w+2) + cell(row))
			}
			continue
		}
		title := wrapCell(protocol.Cell{{Text: b.Title}}, textW)
		inline := b.Hint != "" && len(title) == 1 && titleW+2+lipgloss.Width(Clean(b.Hint)) <= textW
		for i, row := range title {
			s := calloutIndent + cell(row)
			if i == 0 {
				s = head + cell(row)
			}
			if inline {
				s += "  " + cell(hint)
			}
			r.emit(s)
		}
		if b.Hint != "" && !inline {
			for _, row := range wrapCell(hint, textW) {
				r.emit(calloutIndent + cell(row))
			}
		}
	}
}

func calloutColor(label string) color.Color {
	switch label {
	case "next", "fix":
		return theme.Peach
	case "why":
		return theme.Dimmer
	}
	return theme.Lav
}

func (r *renderer) callout(b protocol.Block) {
	r.calloutLines(calloutColor(b.Label), b.Label, b.Body)
}

// calloutLines never wraps a cell holding a command: it is pasted whole.
func (r *renderer) calloutLines(c color.Color, label string, body []protocol.Cell) {
	label = Clean(label)
	bar := calloutIndent + fg(c).Render(theme.GlyphBar) + " "
	cont := bar + strings.Repeat(" ", lipgloss.Width(label)+1)
	w := min(r.width-lipgloss.Width(cont), paragraphMax)
	first := true
	for _, line := range body {
		rows := []protocol.Cell{line}
		if !hasCommand(line) {
			rows = wrapCell(line, w)
		}
		for _, row := range rows {
			if first {
				r.emit(bar + fg(c).Render(label) + " " + cell(row))
				first = false
				continue
			}
			r.emit(cont + cell(row))
		}
	}
}

func (r *renderer) kv(b protocol.Block) {
	s := indent + keyStyle.Render(Clean(b.Key))
	if b.Value != "" {
		s += "  " + strongStyle.Render(Clean(b.Value))
	}
	r.emit(s)
	if b.Source != "" {
		r.emit(indent + "  " + faintStyle.Render(Clean(b.Source)))
	}
}

func (r *renderer) summary(b protocol.Block) {
	r.gap()
	s := indent + glyph(b.Status) + " " + strongStyle.Render(Clean(b.Title))
	if len(b.Counts) > 0 {
		counts := make([]string, len(b.Counts))
		for i, c := range b.Counts {
			counts[i] = Clean(c)
		}
		s += "  " + faintStyle.Render(strings.Join(counts, " · "))
	}
	r.emit(s)
}

func (r *renderer) banner(b protocol.Block) {
	s := indent + fg(theme.Coral).Bold(true).Render(theme.GlyphBar+" "+Clean(b.Label)) + " " + strongStyle.Render(Clean(b.Subject))
	if b.Hint != "" {
		s += "  " + faintStyle.Render(Clean(b.Hint))
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
		s := calloutIndent + cell(row)
		if i == 0 {
			s = indent + glyph("failed") + " " + cell(row)
		}
		if inline {
			s += "  " + faintStyle.Render(hint)
		}
		r.emit(s)
	}
	if hint != "" && !inline {
		for _, row := range wrapCell(protocol.Cell{{Text: hint, Role: "faint"}}, w) {
			r.emit(calloutIndent + cell(row))
		}
	}
	if b.Why != "" {
		r.calloutLines(theme.Dimmer, "why", []protocol.Cell{{{Text: b.Why}}})
	}
	if len(b.Next) > 0 {
		r.calloutLines(theme.Peach, "next", []protocol.Cell{b.Next})
	}
	if b.Details != "" {
		r.gap()
		dw := min(r.width-len(indent), paragraphMax)
		for _, l := range splitLines(b.Details) {
			for _, row := range wrapCell(protocol.Cell{{Text: l, Role: "faint"}}, dw) {
				r.emit(indent + cell(row))
			}
		}
	}
}
