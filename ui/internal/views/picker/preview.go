package picker

import (
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/protocol"
	rtrender "rt-ui/internal/render"
	"rt-ui/internal/termimage"
	"rt-ui/internal/textwrap"
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

// kittyQueryWait is how long the picker waits for the kitty graphics reply
// before it settles on half-blocks.
const kittyQueryWait = 150 * time.Millisecond

// kittyFaces decides whether faces go out as kitty images. A herdr pane
// answers the kitty query OK even when its server never draws images for
// session-control clients such as Flock; a server that does sets
// HERDR_SESSION_CONTROL_IMAGES=1 on its panes, and any other herdr pane gets
// half-blocks without asking.
func kittyFaces(getenv func(string) string, query func() bool) bool {
	if getenv("HERDR_PANE_ID") != "" && getenv("HERDR_SESSION_CONTROL_IMAGES") != "1" {
		return false
	}
	return query()
}

// firstFaceID keeps the picker's kitty image ids clear of low ids other
// programs in the same terminal are likely to use.
const firstFaceID = 0x52540

// assignFaceIDs gives every preview face path its own kitty image id.
func (m *Model) assignFaceIDs() {
	m.faceIDs = map[string]uint32{}
	for _, r := range m.req.Rows {
		if r.Preview == nil || r.Preview.Face == nil || r.Preview.Face.Path == "" {
			continue
		}
		if _, ok := m.faceIDs[r.Preview.Face.Path]; !ok {
			m.faceIDs[r.Preview.Face.Path] = firstFaceID + uint32(len(m.faceIDs))
		}
	}
}

type sendFacesMsg struct{}

// facesAfterFirstFrame outlasts the first frame. Ghostty keeps kitty images
// per screen, and bubbletea writes raw output ahead of each frame, so faces
// sent from Init land on the main screen before the first frame switches to
// the alternate one, where the placeholders cannot see them.
const facesAfterFirstFrame = 80 * time.Millisecond

func (m *Model) sendFacesSoon() tea.Cmd {
	if len(m.faceIDs) == 0 {
		return nil
	}
	return tea.Tick(facesAfterFirstFrame, func(time.Time) tea.Msg { return sendFacesMsg{} })
}

// sendFaces transmits every face once, at start; the face box then shows
// each by its placeholder text. A face that cannot be read loses its id and
// falls back to the empty tile.
func (m *Model) sendFaces() tea.Cmd {
	var sb strings.Builder
	for path, id := range m.faceIDs {
		seq, err := termimage.KittyTransmit(id, path, faceCols, faceRows)
		if err != nil {
			delete(m.faceIDs, path)
			continue
		}
		sb.WriteString(seq)
	}
	if sb.Len() == 0 {
		return nil
	}
	return tea.Raw(sb.String())
}

// faceLines is the face drawn into its faceCols x faceRows box (a kitty
// placement, else half-blocks), or the placeholder tile when there is no
// face or it cannot be read.
func (m *Model) faceLines(face *protocol.PickPreviewFace) []string {
	if face != nil && face.Path != "" {
		if id, ok := m.faceIDs[face.Path]; ok {
			return termimage.KittyPlaceholder(id, faceCols, faceRows)
		}
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
		glyph = ansi.Truncate(rtrender.Clean(face.Placeholder), faceCols, "")
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

func segText(s protocol.PickSegment) string { return s.Text }

func withSegText(s protocol.PickSegment, t string) protocol.PickSegment {
	s.Text = t
	return s
}

func previewSegs(segs []protocol.PickSegment) string {
	var sb strings.Builder
	for _, s := range segs {
		st := fg(segColor(s))
		if s.Hex == "" && (s.Tone == "" || s.Tone == "text") {
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
		face := m.faceLines(p.Face)
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
				lead := fg(theme.Faint).Render(key + strings.Repeat(" ", previewKeyWidth-lipgloss.Width(key)))
				for _, row := range textwrap.SpansWith(r.Value, width-previewKeyWidth, textwrap.Options{WordsOnly: true, Separators: "/\\-_.:"}, segText, withSegText) {
					out = append(out, lead+previewSegs(row))
					lead = strings.Repeat(" ", previewKeyWidth)
				}
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

// groupRuleLine is the group label for a list that also has a column header:
// lowercase and brighter with a faint rule to the edge, so it reads as a
// divider rather than a second header line.
func groupRuleLine(group string, width int) string {
	label := ansi.Truncate(rtrender.Clean(group), max(width-3, 0), "…")
	fill := width - 2 - lipgloss.Width(label) - 1
	if fill < 0 {
		fill = 0
	}
	return onBg.Render("  ") + fg(theme.TextSoft).Render(label) + " " + fg(theme.Rule).Render(strings.Repeat("─", fill))
}
