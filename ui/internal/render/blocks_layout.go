package render

import (
	"strings"

	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/textwrap"
)

// clipFloor is the narrowest a leading column is clipped to, so the last
// column keeps room to wrap.
const clipFloor = 8

func (r *renderer) measure(rows [][]protocol.Cell, widths []int) {
	for _, row := range rows {
		for ci, c := range row {
			widths[ci] = max(widths[ci], lipgloss.Width(r.cell(c)))
		}
	}
}

// fitColumns shrinks widths to avail cells. The last column takes what the
// others leave it; while that is less than it needs (its own width, capped
// at minWrap), the widest other column is clipped, never below clipFloor.
func fitColumns(widths []int, avail int) []int {
	out := append([]int(nil), widths...)
	n := len(out)
	if n == 0 {
		return out
	}
	others := func() int {
		t := 2 * (n - 1)
		for _, w := range out[:n-1] {
			t += w
		}
		return t
	}
	need := min(out[n-1], minWrap)
	for n > 1 && avail-others() < need {
		i := 0
		for j, w := range out[:n-1] {
			if w > out[i] {
				i = j
			}
		}
		if out[i] <= clipFloor {
			break
		}
		out[i] = max(clipFloor, out[i]-(need-(avail-others())))
	}
	out[n-1] = max(1, min(out[n-1], avail-others()))
	return out
}

// fitLine clips a laid-out row that the floors still left wider than avail.
func (r *renderer) fitLine(s string, avail int) string {
	if lipgloss.Width(s) <= avail {
		return s
	}
	return textwrap.ClipOn(s, avail, r.p.dim)
}

// rowLines lays one row into its columns. A leading cell wider than its
// column is clipped; the row's last cell wraps at its words in the room the
// others leave, or is clipped when that room is too narrow to wrap into.
// Rows after the first start under the last cell.
func (r *renderer) rowLines(row []protocol.Cell, widths []int, avail int) []string {
	if len(row) == 0 {
		return []string{""}
	}
	k := len(row) - 1
	var head strings.Builder
	for i, c := range row[:k] {
		s := r.cell(c)
		if lipgloss.Width(s) > widths[i] {
			s = textwrap.ClipOn(s, widths[i], r.p.dim)
		}
		head.WriteString(pad(s, widths[i]) + "  ")
	}
	lead := head.String()
	room := avail - lipgloss.Width(lead)
	last := r.cell(row[k])
	var parts []string
	switch {
	case lipgloss.Width(last) <= room:
		parts = []string{last}
	case room >= minWrap:
		for _, wrapped := range wrapCell(row[k], room) {
			parts = append(parts, r.cell(wrapped))
		}
	default:
		parts = []string{textwrap.ClipOn(last, max(1, room), r.p.dim)}
	}
	out := make([]string, len(parts))
	for i, p := range parts {
		if i == 0 {
			out[i] = r.fitLine(lead+p, avail)
			continue
		}
		out[i] = strings.Repeat(" ", lipgloss.Width(lead)) + p
	}
	return out
}

func (r *renderer) table(b protocol.Block) {
	cols := len(b.Headers)
	rows := make([][]protocol.Cell, len(b.Rows))
	for i, row := range b.Rows {
		rows[i] = row.Cells
		cols = max(cols, len(row.Cells))
	}
	header := make([]protocol.Cell, len(b.Headers))
	for i, h := range b.Headers {
		header[i] = protocol.Cell{{Text: h, Role: "faint"}}
	}
	widths := make([]int, cols)
	r.measure(append([][]protocol.Cell{header}, rows...), widths)
	measured := append([]int(nil), widths...)
	avail := r.width - len(indent)
	widths = fitColumns(widths, avail)
	room := avail - 2*(cols-1)
	for i := 0; i < cols-1; i++ {
		room -= widths[i]
		if widths[i] < measured[i] {
			r.stackedTable(b, header, avail)
			return
		}
	}
	if cols > 0 && room < min(measured[cols-1], minWrap) {
		r.stackedTable(b, header, avail)
		return
	}

	if len(header) > 0 {
		for _, l := range r.rowLines(header, widths, avail) {
			r.emit(indent + l)
		}
		total := 2 * (cols - 1)
		for _, w := range widths {
			total += w
		}
		r.emit(indent + r.p.rule.Render(strings.Repeat("─", min(total, avail))))
	}
	for _, row := range b.Rows {
		if row.Group != "" {
			r.emit(indent + r.fitLine(r.p.dim.Render(Clean(row.Group)), avail))
			continue
		}
		for _, l := range r.rowLines(row.Cells, widths, avail) {
			r.emit(indent + l)
		}
	}
}

func (r *renderer) stackedTable(b protocol.Block, header []protocol.Cell, avail int) {
	under := indent + "    "
	for _, row := range b.Rows {
		if row.Group != "" {
			r.emit(indent + r.fitLine(r.p.dim.Render(Clean(row.Group)), avail))
			continue
		}
		if len(row.Cells) == 0 {
			r.emit(indent)
			continue
		}
		first := row.Cells[0]
		if len(header) > 0 {
			first = append(append(protocol.Cell{}, header[0]...), append(protocol.Cell{{Text: "  "}}, first...)...)
		}
		for _, l := range r.stackedLines(first, avail) {
			r.emit(indent + l)
		}
		for i, c := range row.Cells[1:] {
			cell := c
			if i+1 < len(header) {
				cell = append(append(protocol.Cell{}, header[i+1]...), append(protocol.Cell{{Text: "  "}}, c...)...)
			}
			for _, l := range r.stackedLines(cell, avail-4) {
				r.emit(under + l)
			}
		}
	}
}

func (r *renderer) stackedLines(c protocol.Cell, w int) []string {
	var out []string
	for _, l := range wrapCell(c, w) {
		out = append(out, r.fitLine(r.cell(l), max(1, w)))
	}
	return out
}

func (r *renderer) tree(b protocol.Block) {
	avail := r.width - len(indent)
	for _, row := range wrapCell(b.Root, avail) {
		r.emit(indent + r.fitLine(r.cell(row), avail))
	}
	cols := 0
	for _, child := range b.Children {
		cols = max(cols, len(child))
	}
	widths := make([]int, cols)
	r.measure(b.Children, widths)
	widths = fitColumns(widths, avail-4)
	for i, child := range b.Children {
		branch, cont := "├── ", "│   "
		if i == len(b.Children)-1 {
			branch, cont = "╰── ", "    "
		}
		for j, l := range r.rowLines(child, widths, avail-4) {
			p := branch
			if j > 0 {
				p = cont
			}
			r.emit(indent + r.p.rule.Render(p) + l)
		}
	}
}

func (r *renderer) section(b protocol.Block) {
	r.gap()
	s := indent + strongStyle.Render(Clean(b.Title))
	if b.Subtitle != "" {
		s += "  " + r.p.dim.Render(Clean(b.Subtitle))
	}
	r.emit(s)
	r.blocks(b.Blocks)
}

func (r *renderer) changes(b protocol.Block) {
	w := 0
	for _, c := range b.Changes {
		if c.Hint != "" {
			w = max(w, lipgloss.Width(Clean(c.Name)))
		}
	}
	for _, c := range b.Changes {
		mark := fg(r.p.tones.Mint).Render("+")
		if c.Op == "-" {
			mark = r.p.dim.Render("-")
		}
		name := Clean(c.Name)
		if c.Hint == "" {
			r.emit(indent + mark + " " + textStyle.Render(name))
			continue
		}
		r.emit(indent + mark + " " + textStyle.Render(pad(name, w)) + "  " + r.p.dim.Render(Clean(c.Hint)))
	}
}
