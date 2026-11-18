package picker

import (
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/protocol"
	rtrender "rt-ui/internal/render"
	"rt-ui/internal/termimage"
	"rt-ui/internal/theme"
)

const (
	// previewMinTerminal is the narrowest terminal that still gets a preview
	// column; below it the list keeps the whole width.
	previewMinTerminal = 100
	faceCols           = 16
	faceRows           = 8
	previewKeyWidth    = 9
	// previewGap is the " │ " between the list and the preview column.
	previewGap = 3
)

// previewWidth is the preview column's width, or 0 when this request carries
// no previews or the terminal is too narrow for two columns.
func (m *Model) previewWidth() int {
	if m.width < previewMinTerminal || !m.hasPreviews() {
		return 0
	}
	w := m.width / 3
	if w < 40 {
		w = 40
	}
	if w > 52 {
		w = 52
	}
	return w
}

func (m *Model) hasPreviews() bool {
	for _, r := range m.req.Rows {
		if r.Preview != nil {
			return true
		}
	}
	return false
}

var faceCache = map[string]string{}

// faceLines is the face drawn into its faceCols x faceRows box, or the
// placeholder tile when there is no face or it cannot be read.
func faceLines(face *protocol.PickPreviewFace) []string {
	if face != nil && face.Path != "" {
		drawn, ok := faceCache[face.Path]
		if !ok {
			if s, err := termimage.HalfBlock(face.Path, faceCols, faceRows); err == nil {
				drawn = s
			}
			faceCache[face.Path] = drawn
		}
		if drawn != "" {
			return strings.Split(drawn, "\n")
		}
	}
	glyph := "?"
	if face != nil && face.Placeholder != "" {
		glyph = face.Placeholder
	}
	tile := lipgloss.NewStyle().Background(theme.Surface).Foreground(theme.Faint)
	lines := make([]string, faceRows)
	for i := range lines {
		text := strings.Repeat(" ", faceCols)
		if i == faceRows/2-1 {
			pad := (faceCols - lipgloss.Width(glyph)) / 2
			text = strings.Repeat(" ", pad) + glyph + strings.Repeat(" ", faceCols-pad-lipgloss.Width(glyph))
		}
		lines[i] = tile.Render(text)
	}
	return lines
}

func previewSegs(segs []protocol.PickSegment) string {
	var sb strings.Builder
	for _, s := range segs {
		st := fg(segColor(s))
		if s.Tone == "" || s.Tone == "text" {
			st = fg(theme.TextSoft)
		}
		sb.WriteString(st.Bold(s.Bold).Render(rtrender.Clean(s.Text)))
	}
	return sb.String()
}

// previewLines paints the cursor row's preview into exactly height lines of
// at most width cells.
func previewLines(m *Model, width, height int) []string {
	out := make([]string, 0, height)
	var p *protocol.PickPreview
	if m.cursor >= 0 && m.cursor < len(m.matches) {
		p = m.req.Rows[m.matches[m.cursor].Index].Preview
	}
	if p != nil {
		face := faceLines(p.Face)
		for i := 0; i < faceRows; i++ {
			line := face[i]
			if i < len(p.Header) {
				line += "  " + previewSegs(p.Header[i])
			}
			out = append(out, line)
		}
		for _, sec := range p.Sections {
			out = append(out, "", fg(theme.Meta).Render(strings.ToUpper(rtrender.Clean(sec.Title))))
			for _, r := range sec.Rows {
				key := ansi.Truncate(rtrender.Clean(r.Key), previewKeyWidth-1, "")
				out = append(out, fg(theme.Faint).Render(key+strings.Repeat(" ", previewKeyWidth-lipgloss.Width(key)))+previewSegs(r.Value))
			}
		}
		if len(p.Screen) > 0 {
			out = append(out, "", fg(theme.Meta).Render("ON SCREEN"))
			box := fg(theme.Rule)
			out = append(out, box.Render("╭"+strings.Repeat("─", width-2)+"╮"))
			for _, s := range p.Screen {
				text := ansi.Truncate(rtrender.Clean(s), width-4, "…")
				out = append(out, box.Render("│ ")+fg(theme.Dim).Render(text)+strings.Repeat(" ", width-4-lipgloss.Width(text))+box.Render(" │"))
			}
			out = append(out, box.Render("╰"+strings.Repeat("─", width-2)+"╯"))
		}
	}
	for i := range out {
		out[i] = ansi.Truncate(out[i], width, "")
	}
	for len(out) < height {
		out = append(out, "")
	}
	return out[:height]
}

// joinPreview lays the preview column beside body lines already drawn at
// listWidth, separated by a ruled gap.
func joinPreview(m *Model, body []string, listWidth, previewW int) {
	pv := previewLines(m, previewW, len(body))
	sep := fg(theme.Rule).Render(" │ ")
	for i, line := range body {
		if pad := listWidth - lipgloss.Width(line); pad > 0 {
			line += strings.Repeat(" ", pad)
		}
		body[i] = line + sep + pv[i]
	}
}

// columnHeaderLine names the list's columns, starting where row text does
// (gutter, separator, group indent) so the caller's padding lines them up.
func columnHeaderLine(m *Model, width int) string {
	var sb strings.Builder
	for _, s := range m.req.ColumnHeader {
		c := theme.Meta
		if s.Tone != "" {
			c = segColor(s)
		}
		sb.WriteString(fg(c).Bold(s.Bold).Render(rtrender.Clean(s.Text)))
	}
	lead := 2 + m.rowIndent()
	return onBg.Render(strings.Repeat(" ", lead)) + ansi.Truncate(sb.String(), width-lead, "")
}
