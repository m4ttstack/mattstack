// The toast: a short confirmation floated over the frame's bottom right
// corner, above the keybar. It is glitter's own surface (GitHub Desktop
// confirms in banners a terminal has no room for) and it never takes a row
// from the layout, so showing or dropping one moves nothing under the mouse.
package mission

import (
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"rt-ui/internal/theme"
)

const toastLifetime = 3 * time.Second

// toastTick is tea.Tick behind a seam, the same shape as selectTick.
var toastTick = tea.Tick

// toastExpiredMsg ends the toast that was showing when its timer started; a
// newer toast has a newer generation and outlives it.
type toastExpiredMsg struct {
	generation int
}

// setToast shows text. SetModel calls it and cannot return a command, so the
// timer starts from armToast on the way out of Update.
func (m *Mission) setToast(text string) {
	m.toast = text
	m.toastGen++
	m.toastUnarmed = true
}

func (m *Mission) armToast() tea.Cmd {
	if !m.toastUnarmed {
		return nil
	}
	m.toastUnarmed = false
	gen := m.toastGen
	return toastTick(toastLifetime, func(time.Time) tea.Msg {
		return toastExpiredMsg{generation: gen}
	})
}

func (m *Mission) clearToast() {
	m.toast = ""
}

func renderToastBox(text string, maxWidth int) string {
	const chrome = 2 + 2 + 2 // border, padding, glyph and its gap
	textW := maxWidth - chrome
	if textW < 1 {
		return ""
	}
	on := lipgloss.NewStyle().Background(theme.Surface)
	line := on.Foreground(theme.Mint).Bold(true).Render(theme.GlyphDone+" ") + on.Foreground(theme.Text).Bold(true).Render(clip(text, textW))
	return on.Border(lipgloss.RoundedBorder()).BorderForeground(theme.Mint).BorderBackground(theme.Surface).Padding(0, 1).Render(line)
}

// renderToast composites the toast over parent with its bottom edge on the
// row above bottomRows (the keybar and any notice strip).
func renderToast(parent, text string, width, bottomRows int) string {
	box := renderToastBox(text, width-2)
	if box == "" {
		return parent
	}
	x := width - lipgloss.Width(box) - 1
	y := lipgloss.Height(parent) - bottomRows - lipgloss.Height(box)
	if x < 0 || y < 0 {
		return parent
	}
	return lipgloss.NewCompositor(
		lipgloss.NewLayer(parent).X(0).Y(0).Z(0),
		lipgloss.NewLayer(box).X(x).Y(y).Z(1),
	).Render()
}
