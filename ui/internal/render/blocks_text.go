package render

import (
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/protocol"
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
		r.emit(calloutIndent + faintStyle.Render(Clean(s)))
	}
}

func (r *renderer) paragraph(b protocol.Block) {
	w := min(r.width-2*len(indent), paragraphMax)
	for _, para := range splitLines(b.Text) {
		for _, l := range strings.Split(lipgloss.Wrap(Clean(para), w, ""), "\n") {
			r.emit(indent + textStyle.Render(strings.TrimRight(l, " ")))
		}
	}
}

// copy never wraps and never styles inside the text: the person selects it.
func (r *renderer) copy(b protocol.Block) {
	r.caption(b.Caption)
	for _, l := range splitLines(b.Text) {
		r.emit(calloutIndent + railStyle.Render("│") + " " + textStyle.Render(Clean(l)))
	}
}

func (r *renderer) verbatim(b protocol.Block) {
	r.caption(b.Caption)
	rail := calloutIndent + railStyle.Render("│") + " "
	w := r.width - lipgloss.Width(rail)
	for _, line := range b.Lines {
		for _, l := range splitLines(line) {
			for _, row := range cutRows(cleanCode(l), w) {
				r.emit(rail + dimStyle.Render(row))
			}
		}
	}
}

// cutRows breaks s every w cells with no word wrap and nothing dropped: the
// end of a stack line carries its file and line number.
func cutRows(s string, w int) []string {
	if w < minWrap {
		return []string{s}
	}
	var rows []string
	for ansi.StringWidth(s) > w {
		head := ansi.Truncate(s, w, "")
		if head == "" || !strings.HasPrefix(s, head) {
			break
		}
		rows = append(rows, head)
		s = s[len(head):]
	}
	return append(rows, s)
}

func (r *renderer) diff(b protocol.Block) {
	add := lipgloss.NewStyle().Foreground(theme.Mint).Background(theme.DiffAddBg)
	del := lipgloss.NewStyle().Foreground(theme.Coral).Background(theme.DiffDelBg)
	if r.light {
		// Mint and coral text wash out on a pale tint. The ink is fixed, not
		// the terminal's own, so the row reads even when COLORFGBG is wrong.
		add = lipgloss.NewStyle().Foreground(theme.Bg).Background(theme.DiffAddBgLight)
		del = lipgloss.NewStyle().Foreground(theme.Bg).Background(theme.DiffDelBgLight)
	}
	for _, h := range b.Hunks {
		r.emit(indent + keyStyle.Render(Clean(h.Header)))
		w := 0
		for _, l := range h.Lines {
			w = max(w, lipgloss.Width(cleanCode(l.Text)))
		}
		w += 3
		for _, l := range h.Lines {
			t := cleanCode(l.Text)
			switch l.Kind {
			case "add":
				r.emit(indent + add.Render(pad(" + "+t, w)))
			case "del":
				r.emit(indent + del.Render(pad(" - "+t, w)))
			default:
				r.emit(indent + textStyle.Render("   "+t))
			}
		}
	}
}
