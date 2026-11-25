package picker

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/protocol"
)

func headedRequest() protocol.PickRequest {
	row := func(value, group string) protocol.PickRow {
		return protocol.PickRow{Value: value, Group: group, Left: []protocol.PickSegment{{Text: value, Column: true}}}
	}
	return protocol.PickRequest{
		T: "pick", Protocol: protocol.Version, Multi: true,
		Rows: []protocol.PickRow{row("api", "WEB-214"), row("web", "WEB-214"), row("docs", "main")},
		GroupHeadings: map[string]protocol.PickGroupHeading{
			"WEB-214": {
				Left:  []protocol.PickSegment{{Text: "[In Review]", Hex: "#F2C94C"}, {Text: "  Add a login rate limit to every public form we serve", Bold: true}},
				Right: []protocol.PickSegment{{Text: "!412 open", Tone: "dim"}, {Text: "  WEB-214", Tone: "dimmer"}},
			},
		},
	}
}

func headingLine(t *testing.T, m *Model, contains string) string {
	t.Helper()
	for _, line := range strings.Split(render(m), "\n") {
		if strings.Contains(ansi.Strip(line), contains) {
			return line
		}
	}
	t.Fatalf("no line contains %q:\n%s", contains, ansi.Strip(render(m)))
	return ""
}

func TestGroupHeadingClipsItsLeftAndKeepsItsRightWhole(t *testing.T) {
	m := New(headedRequest())
	m.width = 60
	line := ansi.Strip(headingLine(t, m, "[In Review]"))
	if w := ansi.StringWidth(line); w != 60 {
		t.Fatalf("heading is %d cells, want 60: %q", w, line)
	}
	if !strings.HasPrefix(line, "  [In Review]  Add a login") || !strings.Contains(line, "…") {
		t.Fatalf("heading left should start at the gutter and clip with an ellipsis: %q", line)
	}
	if !strings.HasSuffix(strings.TrimRight(line, " "), "!412 open  WEB-214") {
		t.Fatalf("heading right must stay whole at the edge: %q", line)
	}
}

func TestGroupHeadingShorterThanItsRightStillFitsTheWidth(t *testing.T) {
	m := New(headedRequest())
	m.width = 16
	for _, line := range strings.Split(render(m), "\n") {
		if w := ansi.StringWidth(line); w > 16 {
			t.Fatalf("line is %d cells, want at most 16: %q", w, ansi.Strip(line))
		}
	}
}

func TestGroupWithoutAHeadingKeepsItsPlainLine(t *testing.T) {
	m := New(headedRequest())
	m.width = 60
	if line := headingLine(t, m, "MAIN"); line != groupHeaderLine("main") {
		t.Fatalf("got %q, want today's plain line %q", line, groupHeaderLine("main"))
	}
}

func TestGroupHeadingPaintsHexAndDropsControlBytes(t *testing.T) {
	req := headedRequest()
	req.GroupHeadings["WEB-214"] = protocol.PickGroupHeading{Left: []protocol.PickSegment{{Text: "[Done]", Hex: "#F2C94C"}, {Text: " a\x1b[2Jb\nc"}}}
	m := New(req)
	m.width = 60
	line := headingLine(t, m, "[Done]")
	if !strings.Contains(line, "38;2;242;201;76") {
		t.Fatalf("the state segment should carry its own color: %q", line)
	}
	if strings.Contains(line, "\x1b[2J") {
		t.Fatalf("a heading must not pass control sequences through: %q", line)
	}
}

func TestUpdateSwapsHeadingsWithTheCursorAndMarksKept(t *testing.T) {
	m := New(headedRequest())
	m.width = 60
	m.cursor = 1
	m.selected["web"] = true
	rows := append([]protocol.PickRow(nil), m.req.Rows...)
	rows[0], rows[2] = rows[2], rows[0]
	next, _ := m.Update(UpdateMsg{Update: protocol.PickUpdate{
		Rows:          rows,
		GroupHeadings: map[string]protocol.PickGroupHeading{"main": {Left: []protocol.PickSegment{{Text: "the main checkout"}}}},
	}})
	m = next.(*Model)
	if got := m.req.Rows[m.matches[m.cursor].Index].Value; got != "web" {
		t.Fatalf("cursor should stay on web, landed on %q", got)
	}
	if !m.selected["web"] {
		t.Fatal("the mark on web should survive the update")
	}
	plain := ansi.Strip(render(m))
	if !strings.Contains(plain, "the main checkout") || strings.Contains(plain, "[In Review]") || !strings.Contains(plain, "WEB-214") {
		t.Fatalf("headings should be replaced whole:\n%s", plain)
	}
}

func TestUpdateWithoutHeadingsKeepsThem(t *testing.T) {
	m := New(headedRequest())
	m.width = 60
	next, _ := m.Update(UpdateMsg{Update: protocol.PickUpdate{Message: "still here"}})
	headingLine(t, next.(*Model), "[In Review]")
}

func TestRowLabelRunsThroughTheColumnSegment(t *testing.T) {
	row := protocol.PickRow{Left: []protocol.PickSegment{{Text: "api  ", Tone: "peach"}, {Text: ":10400", Column: true}, {Text: "  not listening"}}}
	if got := rowLabel(row); got != "api :10400" {
		t.Fatalf("label = %q, want %q", got, "api :10400")
	}
	first := protocol.PickRow{Left: []protocol.PickSegment{{Text: "a  spaced name", Column: true}, {Text: "  hint"}}}
	if got := rowLabel(first); got != "a  spaced name" {
		t.Fatalf("a leading column segment is the label as it stands, got %q", got)
	}
}

func TestCursorNeverLandsOnAHeading(t *testing.T) {
	m := New(headedRequest())
	m.width = 60
	seen := []string{}
	for range 3 {
		seen = append(seen, m.req.Rows[m.matches[m.cursor].Index].Value)
		next, _ := m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
		m = next.(*Model)
	}
	if strings.Join(seen, " ") != "api web docs" {
		t.Fatalf("down should step row to row, saw %v", seen)
	}
}
