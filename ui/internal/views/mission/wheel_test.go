package mission

import (
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
)

// longChangesMission is the mouse fixture with 40 changes and 60 diff
// lines, so both the Changes list and the diff pane scroll.
func longChangesMission() *Mission {
	m := newMouseTestMission()
	m.model.Changes = nil
	for i := range 40 {
		m.model.Changes = append(m.model.Changes, ChangeRow{Path: fmt.Sprintf("file-%02d.go", i), Status: "modified", Include: "none"})
	}
	m.model.ChangedTotal = 40
	m.selected = "file-00.go"
	m.model.Diff.Path = "file-00.go"
	m.model.Diff.Lines = nil
	for i := range 60 {
		m.model.Diff.Lines = append(m.model.Diff.Lines, DiffLine{Kind: "context", OldNo: i + 1, NewNo: i + 1, Text: fmt.Sprintf("line %02d", i)})
	}
	m.View()
	return m
}

func wheel(m *Mission, x, y int, button tea.MouseButton) tea.Cmd {
	_, cmd := m.Update(tea.MouseWheelMsg{X: x, Y: y, Button: button})
	return cmd
}

func frameText(m *Mission) string { return ansi.Strip(m.View().Content) }

func frameRow(m *Mission, y int) string { return strings.Split(frameText(m), "\n")[y] }

func TestWheelOverChangesScrollsTheListNotTheSelection(t *testing.T) {
	instantSelectTick(t)
	m := longChangesMission()
	y := changesRowY(m, 1)
	if cmd := wheel(m, 5, y, tea.MouseWheelDown); cmd != nil {
		t.Fatalf("a wheel tick over the Changes list must emit nothing, got a cmd resolving to %#v", cmd())
	}
	if m.selected != "file-00.go" {
		t.Fatalf("the wheel must not move the selection, got %q", m.selected)
	}
	if row := frameRow(m, changesRowY(m, 0)); !strings.Contains(row, "file-03.go") {
		t.Fatalf("the list should have scrolled %d rows, top row %q", wheelStep, row)
	}
	for range 20 {
		if cmd := wheel(m, 5, y, tea.MouseWheelDown); cmd != nil {
			t.Fatal("repeated wheel ticks must never emit")
		}
	}
	if frame := frameText(m); !strings.Contains(frame, "file-39.go") || m.selected != "file-00.go" {
		t.Fatalf("the wheel should reach the end with the selection held, selected %q:\n%s", m.selected, frame)
	}
	if h := m.hitTest(5, changesRowY(m, 0)); h.kind != hitFileRow || h.idx != m.changesTop || m.changesTop == 0 {
		t.Fatalf("hit zones must follow the scrolled window, top %d hit %+v", m.changesTop, h)
	}
}

func TestAKeyAfterAChangesWheelScrollReFollowsTheCursor(t *testing.T) {
	instantSelectTick(t)
	m := longChangesMission()
	for range 5 {
		wheel(m, 5, changesRowY(m, 1), tea.MouseWheelDown)
	}
	m.View()
	m.Update(downKey())
	if m.selected != "file-01.go" {
		t.Fatalf("the key moves the cursor from where it was, got %q", m.selected)
	}
	m.View()
	if m.changesTop != 0 || !strings.Contains(frameText(m), "file-01.go") {
		t.Fatalf("the view should follow the cursor back into sight, top %d", m.changesTop)
	}
}

func TestAClickAfterAChangesWheelScrollHitsThePaintedRow(t *testing.T) {
	instantSelectTick(t)
	m := longChangesMission()
	wheel(m, 5, changesRowY(m, 1), tea.MouseWheelDown)
	m.View()
	m.Update(tea.MouseClickMsg{X: 12, Y: changesRowY(m, 0), Button: tea.MouseLeft})
	if want := fmt.Sprintf("file-%02d.go", wheelStep); m.selected != want {
		t.Fatalf("the click should select the row painted under it, %q, got %q", want, m.selected)
	}
}

func TestWheelHoverFollowsTheScrolledChangesRow(t *testing.T) {
	m := longChangesMission()
	y := changesRowY(m, 1)
	m.Update(tea.MouseMotionMsg{X: 12, Y: y})
	wheel(m, 12, y, tea.MouseWheelDown)
	if m.hoverFile != 1+wheelStep {
		t.Fatalf("the hover should name the row now under the pointer, got %d", m.hoverFile)
	}
}

func diffBodyTopY(t *testing.T, m *Mission) (x, y int) {
	t.Helper()
	x = sidebarWidth + 5
	y, ok := findHitY(m, x, hitDiffGutter)
	if !ok {
		t.Fatal("no diff row found")
	}
	return x, y
}

func TestWheelOverTheDiffScrollsTheViewNotTheCursor(t *testing.T) {
	m := longChangesMission()
	x, y := diffBodyTopY(t, m)
	if cmd := wheel(m, x, y, tea.MouseWheelDown); cmd != nil {
		t.Fatal("a wheel tick over the diff must emit nothing")
	}
	if m.diffCursor != 0 || m.diffTop != wheelStep {
		t.Fatalf("the wheel should scroll the view %d rows and hold the cursor, cursor %d top %d", wheelStep, m.diffCursor, m.diffTop)
	}
	m.View()
	if m.diffTop != wheelStep || strings.Contains(frameText(m), "line 00") {
		t.Fatalf("the render must keep the scrolled top, got %d", m.diffTop)
	}
	if h := m.hitTest(x, y); h.idx != wheelStep {
		t.Fatalf("a click on the top row should hit line %d, got %+v", wheelStep, h)
	}
	for range 40 {
		wheel(m, x, y, tea.MouseWheelDown)
	}
	m.View()
	if m.diffCursor != 0 || !strings.Contains(frameText(m), "line 59") {
		t.Fatalf("the wheel should reach the end with the cursor held, cursor %d", m.diffCursor)
	}
}

func TestAKeyAfterADiffWheelScrollReFollowsTheCursor(t *testing.T) {
	m := longChangesMission()
	x, y := diffBodyTopY(t, m)
	m.focusDiffPane()
	for range 5 {
		wheel(m, x, y, tea.MouseWheelDown)
	}
	m.View()
	m.Update(downKey())
	m.View()
	if m.diffCursor != 1 || m.diffTop != 0 {
		t.Fatalf("the key moves the cursor from where it was and the view follows, cursor %d top %d", m.diffCursor, m.diffTop)
	}
}

func TestWheelInABranchModalScrollsTheListNotTheCursor(t *testing.T) {
	m := longBranchModalFixture(t)
	m.View()
	cursor := m.modal.cursor
	x, y, ok := paintedAt(m, "branch-001")
	if !ok {
		t.Fatal("branch-001 not painted")
	}
	before := m.modalHitTest(x, y)
	if cmd := wheel(m, x, y, tea.MouseWheelDown); cmd != nil {
		t.Fatal("a wheel tick in a modal must emit nothing")
	}
	if m.modal.cursor != cursor {
		t.Fatalf("the wheel must not move the modal cursor, %d -> %d", cursor, m.modal.cursor)
	}
	if h := m.modalHitTest(x, y); h.kind != hitModalRow || h.idx != before.idx+wheelStep {
		t.Fatalf("the row under the pointer should be %d rows on, before %+v after %+v", wheelStep, before, h)
	}
	if m.modal.hoverRow != before.idx+wheelStep {
		t.Fatalf("hover should name the row now under the pointer, got %d", m.modal.hoverRow)
	}
	if row := frameRow(m, y); !strings.Contains(row, fmt.Sprintf("branch-%03d", 1+wheelStep)) {
		t.Fatalf("the modal list should have scrolled, pointer row %q", row)
	}
}

func TestAKeyAfterAModalWheelScrollReFollowsTheCursor(t *testing.T) {
	m := longBranchModalFixture(t)
	m.View()
	x, y, _ := paintedAt(m, "branch-001")
	for range 10 {
		wheel(m, x, y, tea.MouseWheelDown)
	}
	m.View()
	cursor := m.modal.cursor
	m.Update(downKey())
	if m.modal.cursor != cursor+1 {
		t.Fatalf("the key moves the cursor from where it was, %d -> %d", cursor, m.modal.cursor)
	}
	if frame := frameText(m); !strings.Contains(frame, fmt.Sprintf("branch-%03d", cursor+1)) {
		t.Fatalf("the view should follow the cursor back into sight:\n%s", frame)
	}
}

func TestTheModalThumbTracksTheWheel(t *testing.T) {
	m := longBranchModalFixture(t)
	before := m.View().Content
	x, y, _ := paintedAt(m, "branch-001")
	for range 30 {
		wheel(m, x, y, tea.MouseWheelDown)
	}
	if m.View().Content == before || m.modal.scrollTop == 0 {
		t.Fatal("the scrolled window and its thumb should repaint")
	}
}
