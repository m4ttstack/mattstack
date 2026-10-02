package textwrap

import "charm.land/lipgloss/v2"

// Clip fits s, plain or styled, into w cells, ending a cut with a bare
// ellipsis.
func Clip(s string, w int) string { return clip(s, w, "…") }

// ClipOn is Clip with the ellipsis painted in on: a cut styled string ends on
// a reset, and a bare ellipsis after it would take the terminal's default
// instead of the row's own style.
func ClipOn(s string, w int, on lipgloss.Style) string { return clip(s, w, on.Render("…")) }

// clip short-circuits a window of one cell or none: MaxWidth(0) does not
// truncate.
func clip(s string, w int, ellipsis string) string {
	if w <= 0 {
		return ""
	}
	if lipgloss.Width(s) > w {
		if w == 1 {
			return ellipsis
		}
		return lipgloss.NewStyle().Inline(true).MaxWidth(w-1).Render(s) + ellipsis
	}
	return lipgloss.NewStyle().Inline(true).MaxWidth(w).Render(s)
}
