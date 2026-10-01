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
// pads hinted titles to one width so the hints line up.
func (r *renderer) lineRun(run []protocol.Block) {
	w := 0
	for _, b := range run {
		if b.T == "line" && b.Hint != "" {
			w = max(w, lipgloss.Width(Clean(b.Title)))
		}
	}
	for _, b := range run {
		if b.T == "callout" {
			r.callout(b)
			continue
		}
		head := indent + glyph(b.Status) + " "
		title := Clean(b.Title)
		if b.Hint == "" {
			r.emit(head + textStyle.Render(title))
			continue
		}
		r.emit(head + textStyle.Render(pad(title, w)) + "  " + faintStyle.Render(Clean(b.Hint)))
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

func (r *renderer) calloutLines(c color.Color, label string, body []protocol.Cell) {
	label = Clean(label)
	bar := calloutIndent + fg(c).Render(theme.GlyphBar) + " "
	for i, line := range body {
		if i == 0 {
			r.emit(bar + fg(c).Render(label) + " " + cell(line))
			continue
		}
		r.emit(bar + strings.Repeat(" ", lipgloss.Width(label)+1) + cell(line))
	}
}

func (r *renderer) kv(b protocol.Block) {
	s := indent + keyStyle.Render(Clean(b.Key))
	if b.Value != "" {
		s += "  " + strongStyle.Render(Clean(b.Value))
	}
	r.emit(s)
	if b.Source != "" {
		r.emit(indent + faintStyle.Render(Clean(b.Source)))
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
	s := indent + glyph("failed") + " " + textStyle.Render(Clean(b.Title))
	if b.Hint != "" {
		s += "  " + faintStyle.Render(Clean(b.Hint))
	}
	r.emit(s)
	if b.Why != "" {
		r.calloutLines(theme.Dimmer, "why", []protocol.Cell{{{Text: b.Why}}})
	}
	if len(b.Next) > 0 {
		r.calloutLines(theme.Peach, "next", []protocol.Cell{b.Next})
	}
	if b.Details != "" {
		r.gap()
		r.emit(indent + faintStyle.Render(Clean(b.Details)))
	}
}
