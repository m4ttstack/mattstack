// Package render prints rt's static output blocks in the rt-ui theme. It
// never reads keys and never takes the screen.
package render

import (
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/protocol"
	"rt-ui/internal/textwrap"
	"rt-ui/internal/theme"
)

const indent = "  "

type statusDef struct {
	glyph string
	color color.Color
}

// Glyphs avoid Nerd Font code points and filled shapes: they must read in
// any terminal font, at the same weight as ✓ and ✗.
var statuses = map[string]statusDef{
	"done":      {theme.GlyphDone, theme.Mint},
	"failed":    {theme.GlyphCrashed, theme.Coral},
	"needs-you": {"◆", theme.Peach},
	"pending":   {"◌", theme.Dim},
	"stale":     {"↻", theme.Peach},
	"refused":   {"⊘", theme.Dim},
	"off":       {theme.GlyphStopped, theme.Dim},
	"skipped":   {"-", theme.Faint},
	"running":   {theme.GlyphRunning, theme.Mint},
	"warn":      {"!", theme.Peach},
}

func fg(c color.Color) lipgloss.Style { return lipgloss.NewStyle().Foreground(c) }

// Body text, titles and commands set no color: they take the terminal's own
// foreground, so they read on a light background as well as a dark one.
var (
	textStyle    = lipgloss.NewStyle()
	strongStyle  = lipgloss.NewStyle().Bold(true)
	commandStyle = lipgloss.NewStyle().Bold(true)
	dimStyle     = fg(theme.Dimmer)
	faintStyle   = fg(theme.Faint)
	keyStyle     = fg(theme.Lav)
	linkStyle    = fg(theme.Cyan).Underline(true)
	ruleStyle    = fg(theme.Rule)
	railStyle    = fg(theme.Panel)
)

// Glyph is the styled glyph for a status; an unknown status gets a dim dot.
func Glyph(status string) string {
	d, ok := statuses[status]
	if !ok {
		return faintStyle.Render("•")
	}
	return fg(d.color).Render(d.glyph)
}

func glyph(status string) string { return Glyph(status) }

// Clean strips escape sequences and control characters, so text that came
// from a branch name or a child process cannot repaint the terminal. A line
// break becomes a space, as the plain renderer does, so a multi-line field
// must be split with splitLines first.
func Clean(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r == '\t' || r == '\n' || r == '\r':
			return ' '
		case r < 0x20 || (r >= 0x7f && r <= 0x9f):
			return -1
		}
		return r
	}, ansi.Strip(s))
}

var lineBreaks = strings.NewReplacer("\r\n", "\n", "\r", "\n")

// splitLines breaks text where the plain renderer does: at \r\n, \r or \n.
func splitLines(s string) []string {
	return strings.Split(lineBreaks.Replace(s), "\n")
}

func segment(s protocol.Segment) string {
	t := Clean(s.Text)
	switch s.Role {
	case "strong":
		return strongStyle.Render(t)
	case "dim":
		return dimStyle.Render(t)
	case "faint":
		return faintStyle.Render(t)
	case "key":
		return keyStyle.Render(t)
	case "command":
		return commandStyle.Render(t)
	case "link":
		if u := Clean(s.URL); u != "" {
			return ansi.SetHyperlink(u) + linkStyle.Render(t) + ansi.ResetHyperlink()
		}
		return linkStyle.Render(t)
	}
	if d, ok := statuses[s.Role]; ok {
		return fg(d.color).Render(t)
	}
	return textStyle.Render(t)
}

func cell(c protocol.Cell) string {
	var b strings.Builder
	for _, s := range c {
		b.WriteString(segment(s))
	}
	return b.String()
}

// minWrap is the narrowest column worth wrapping into: below it, text is
// emitted whole and the terminal wraps it.
const minWrap = 20

func segText(s protocol.Segment) string { return s.Text }

func withSegText(s protocol.Segment, t string) protocol.Segment {
	s.Text = t
	return s
}

// wrapCell breaks a cell into rows of at most w cells. Text is cleaned first
// so the wrap measures exactly what segment paints.
func wrapCell(c protocol.Cell, w int) []protocol.Cell {
	if w < minWrap {
		return []protocol.Cell{c}
	}
	clean := make(protocol.Cell, len(c))
	for i, s := range c {
		clean[i] = withSegText(s, Clean(s.Text))
	}
	rows := textwrap.Spans(clean, w, segText, withSegText)
	out := make([]protocol.Cell, len(rows))
	for i, r := range rows {
		out[i] = r
	}
	return out
}

func hasCommand(c protocol.Cell) bool {
	for _, s := range c {
		if s.Role == "command" {
			return true
		}
	}
	return false
}

func pad(s string, w int) string {
	if n := w - lipgloss.Width(s); n > 0 {
		return s + strings.Repeat(" ", n)
	}
	return s
}

// joinCells pads every cell but the last to its column width.
func joinCells(cells []string, widths []int) string {
	var b strings.Builder
	for i, c := range cells {
		if i > 0 {
			b.WriteString("  ")
		}
		if i == len(cells)-1 {
			b.WriteString(c)
		} else {
			b.WriteString(pad(c, widths[i]))
		}
	}
	return b.String()
}
