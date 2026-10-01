package render

import (
	"strings"

	"charm.land/lipgloss/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/theme"
)

// renderRows styles every cell and measures each column by display width.
func renderRows(rows [][]protocol.Cell, widths []int) [][]string {
	out := make([][]string, len(rows))
	for ri, row := range rows {
		for ci, c := range row {
			s := cell(c)
			out[ri] = append(out[ri], s)
			widths[ci] = max(widths[ci], lipgloss.Width(s))
		}
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
	widths := make([]int, cols)
	headers := make([]string, len(b.Headers))
	for i, h := range b.Headers {
		headers[i] = faintStyle.Render(Clean(h))
		widths[i] = lipgloss.Width(headers[i])
	}
	rendered := renderRows(rows, widths)

	if len(headers) > 0 {
		r.emit(indent + joinCells(headers, widths))
		total := 2 * (cols - 1)
		for _, w := range widths {
			total += w
		}
		r.emit(indent + ruleStyle.Render(strings.Repeat("─", total)))
	}
	for i, row := range b.Rows {
		if row.Group != "" {
			r.emit(indent + faintStyle.Render(Clean(row.Group)))
			continue
		}
		r.emit(indent + joinCells(rendered[i], widths))
	}
}

func (r *renderer) tree(b protocol.Block) {
	r.emit(indent + cell(b.Root))
	cols := 0
	for _, child := range b.Children {
		cols = max(cols, len(child))
	}
	widths := make([]int, cols)
	rendered := renderRows(b.Children, widths)
	for i, child := range rendered {
		branch := "├── "
		if i == len(rendered)-1 {
			branch = "╰── "
		}
		r.emit(indent + ruleStyle.Render(branch) + joinCells(child, widths))
	}
}

func (r *renderer) section(b protocol.Block) {
	r.gap()
	s := indent + strongStyle.Render(Clean(b.Title))
	if b.Subtitle != "" {
		s += "  " + faintStyle.Render(Clean(b.Subtitle))
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
		mark := fg(theme.Mint).Render("+")
		if c.Op == "-" {
			mark = dimStyle.Render("-")
		}
		name := Clean(c.Name)
		if c.Hint == "" {
			r.emit(indent + mark + " " + textStyle.Render(name))
			continue
		}
		r.emit(indent + mark + " " + textStyle.Render(pad(name, w)) + "  " + faintStyle.Render(Clean(c.Hint)))
	}
}
