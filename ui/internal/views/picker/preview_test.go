package picker

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/protocol"
)

func TestKittyFacesSkipsTheQueryInsideHerdr(t *testing.T) {
	asked := false
	query := func() bool { asked = true; return true }
	env := map[string]string{"HERDR_PANE_ID": "w1:p1"}
	if kittyFaces(func(k string) string { return env[k] }, query) {
		t.Fatal("kitty faces chosen inside a herdr pane")
	}
	if asked {
		t.Fatal("asked the terminal inside a herdr pane")
	}
}

func TestKittyFacesAsksTheTerminalInAHerdrThatDrawsImages(t *testing.T) {
	env := map[string]string{"HERDR_PANE_ID": "w1:p1", "HERDR_SESSION_CONTROL_IMAGES": "1"}
	get := func(k string) string { return env[k] }
	if !kittyFaces(get, func() bool { return true }) {
		t.Fatal("kitty faces refused in a herdr that draws images")
	}
	if kittyFaces(get, func() bool { return false }) {
		t.Fatal("kitty faces chosen when the terminal said no")
	}
}

func TestKittyFacesAsksTheTerminalOutsideHerdr(t *testing.T) {
	none := func(string) string { return "" }
	if !kittyFaces(none, func() bool { return true }) {
		t.Fatal("kitty faces refused when the terminal said yes")
	}
	if kittyFaces(none, func() bool { return false }) {
		t.Fatal("kitty faces chosen when the terminal said no")
	}
}

func TestFaceTileFitsAWidePlaceholder(t *testing.T) {
	m := New(previewRequest())
	lines := m.faceLines(&protocol.PickPreviewFace{Placeholder: strings.Repeat("W", 40)})
	for i, l := range lines {
		if w := ansi.StringWidth(l); w != faceCols {
			t.Fatalf("line %d is %d cells, want %d", i, w, faceCols)
		}
	}
}

func TestGroupRuleFitsALongLabel(t *testing.T) {
	line := groupRuleLine(strings.Repeat("workspace-", 12), 40)
	if w := ansi.StringWidth(line); w > 40 {
		t.Fatalf("group rule is %d cells, want at most 40", w)
	}
}

func TestLongPreviewValueWrapsUnderItsKey(t *testing.T) {
	req := previewRequest()
	folder := "~/.mattstack/rt/worktrees/gh-m4ttstack-mattstack/eomer"
	req.Rows[0].Preview.Sections[0].Rows = []protocol.PickPreviewRow{{Key: "folder", Value: []protocol.PickSegment{{Text: folder}}}}
	m := New(req)
	m.cursor = 0
	lines := previewLines(m, 40, 30)
	joined := ""
	for _, l := range lines {
		plain := ansi.Strip(l)
		if w := ansi.StringWidth(plain); w > 40 {
			t.Fatalf("line is %d cells, want at most 40: %q", w, plain)
		}
		if strings.HasPrefix(plain, "folder") || (joined != "" && strings.HasPrefix(plain, strings.Repeat(" ", previewKeyWidth)) && strings.TrimSpace(plain) != "") {
			joined += strings.TrimSpace(strings.TrimPrefix(plain, "folder"))
		}
	}
	if joined != folder {
		t.Fatalf("wrapped folder reads %q, want %q", joined, folder)
	}
}

func previewRequest() protocol.PickRequest {
	seg := func(text string) []protocol.PickSegment { return []protocol.PickSegment{{Text: text}} }
	return protocol.PickRequest{
		Message:      "attach",
		ColumnHeader: seg("AGENT     STATUS"),
		Rows: []protocol.PickRow{{
			Value: "w1:p1",
			Group: "mattstack",
			Left:  seg("kirk      working"),
			Preview: &protocol.PickPreview{
				Face:   &protocol.PickPreviewFace{Placeholder: "?"},
				Header: [][]protocol.PickSegment{seg("kirk"), seg("working")},
				Sections: []protocol.PickPreviewSection{{
					Title: "where",
					Rows:  []protocol.PickPreviewRow{{Key: "repo", Value: seg("mattstack")}},
				}},
				Screen: []string{"$ bun test"},
			},
		}},
	}
}

func plainFrame(t *testing.T, width, height int) string {
	t.Helper()
	m := New(previewRequest())
	next, _ := m.Update(tea.WindowSizeMsg{Width: width, Height: height})
	lines := strings.Split(ansi.Strip(renderView(next.(*Model))), "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " ")
	}
	return strings.Join(lines, "\n") + "\n"
}

// matchGolden compares got with testdata/<name>; UPDATE_GOLDEN=1 rewrites it.
func matchGolden(t *testing.T, name, got string) {
	t.Helper()
	path := filepath.Join("testdata", name)
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (run with UPDATE_GOLDEN=1 to create it)", err)
	}
	if got != string(want) {
		t.Fatalf("frame differs from %s:\n%s", path, got)
	}
}

func TestPreviewColumnAt140(t *testing.T) {
	got := plainFrame(t, 140, 30)
	if !strings.Contains(got, " │ ") || !strings.Contains(got, "WHERE") || !strings.Contains(got, "$ bun test") {
		t.Fatalf("no preview column at 140:\n%s", got)
	}
	matchGolden(t, "preview-140.golden", got)
}

func TestNoPreviewColumnAt90(t *testing.T) {
	got := plainFrame(t, 90, 30)
	if strings.Contains(got, "WHERE") || strings.Contains(got, "$ bun test") {
		t.Fatalf("preview column drawn at 90:\n%s", got)
	}
	matchGolden(t, "preview-90.golden", got)
}
