package textwrap

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

func TestClipFitsAStringAndMarksTheCut(t *testing.T) {
	for _, c := range []struct {
		in   string
		w    int
		want string
	}{
		{"hello world", 6, "hello…"},
		{"hello", 1, "…"},
		{"hello", 0, ""},
		{"hi", 5, "hi"},
		{"日本語", 4, "日…"},
	} {
		if got := ansi.Strip(Clip(c.in, c.w)); got != c.want {
			t.Errorf("Clip(%q, %d) = %q, want %q", c.in, c.w, got, c.want)
		}
	}
}

func TestClipOnPaintsTheEllipsisAfterAStyledCut(t *testing.T) {
	on := lipgloss.NewStyle().Foreground(lipgloss.Color("#7F78A0"))
	got := ClipOn(lipgloss.NewStyle().Bold(true).Render("hello world"), 6, on)
	if ansi.Strip(got) != "hello…" || !strings.Contains(got, "38;2;127;120;160m…") {
		t.Fatalf("got %q", got)
	}
}
