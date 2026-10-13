package mission

import (
	"encoding/json"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/theme"
)

func mainWorktreeMission() *Mission {
	m := newTestMission()
	m.model.Worktrees = []WorktreeRow{
		{Path: "/repo", Name: "repo-tools", Branch: "main", Main: true},
		{Path: "/w/gandalf", Name: "gandalf", Branch: "mission-tui", Current: true},
		{Path: "/w/frodo", Name: "frodo", Branch: "picker-polish", OnDeck: true},
	}
	return m
}

func TestMainWorktreeRowWearsTheHomeGlyphInLav(t *testing.T) {
	m := mainWorktreeMission()
	m.Update(tea.KeyPressMsg{Code: 'w', Text: "w"})
	out := m.View().Content
	if !strings.Contains(out, fgSGR(theme.Lav)+"m"+theme.GlyphHome) {
		t.Fatalf("main worktree row missing its Lav %s:\n%s", theme.GlyphHome, ansi.Strip(out))
	}
	if strings.Contains(lineContaining(t, ansi.Strip(out), "gandalf"), theme.GlyphHome) {
		t.Fatalf("a linked worktree must not wear the home glyph:\n%s", ansi.Strip(out))
	}
}

func TestMainWorktreeGlyphTurnsMintWhenCurrent(t *testing.T) {
	m := mainWorktreeMission()
	m.model.Worktrees[0].Current = true
	m.model.Worktrees[1].Current = false
	m.Update(tea.KeyPressMsg{Code: 'w', Text: "w"})
	if out := m.View().Content; !strings.Contains(out, fgSGR(theme.Mint)+"m"+theme.GlyphHome) {
		t.Fatalf("current main worktree should paint its glyph Mint:\n%s", out)
	}
}

func TestMainWorktreeIsSetOffByARuleWithABlankRowEitherSide(t *testing.T) {
	m := mainWorktreeMission()
	m.Update(tea.KeyPressMsg{Code: 'w', Text: "w"})
	const width = 40
	lines := modalBoxLines(m.modal, width, 20)
	for i := range lines {
		lines[i] = ansi.Strip(lines[i])
	}
	// Lines 0 and 1 are the filter line and its rule.
	if !strings.Contains(lines[2], "repo-tools main") {
		t.Fatalf("the main worktree should be the first row, got %q", lines[2])
	}
	blank := strings.Repeat(" ", width)
	if lines[3] != blank || lines[5] != blank {
		t.Fatalf("the rule needs a blank row above and below, got %q and %q", lines[3], lines[5])
	}
	if want := " " + strings.Repeat("─", width-2) + " "; lines[4] != want {
		t.Fatalf("expected an inset rule under the main worktree, got %q", lines[4])
	}
	if !strings.Contains(lines[6], "gandalf") {
		t.Fatalf("the first linked worktree should follow the separator, got %q", lines[6])
	}
}

func TestMainWorktreeSeparatorNeedsAMainRowWithRowsBelowIt(t *testing.T) {
	plain := newTestMission()
	plain.Update(tea.KeyPressMsg{Code: 'w', Text: "w"})
	if n := len(modalDisplayLines(plain.modal)); n != 2 {
		t.Fatalf("no main row means no separator: %d display lines, want 2", n)
	}

	m := mainWorktreeMission()
	m.Update(tea.KeyPressMsg{Code: 'w', Text: "w"})
	for _, r := range "repo-tools" {
		m.Update(tea.KeyPressMsg{Code: r, Text: string(r)})
	}
	if n := len(modalDisplayLines(m.modal)); n != 1 {
		t.Fatalf("a main row with nothing below it draws no separator: %d display lines, want 1", n)
	}
}

func TestMainWorktreeStaysFirstWhileFiltering(t *testing.T) {
	m := mainWorktreeMission()
	m.Update(tea.KeyPressMsg{Code: 'w', Text: "w"})
	m.Update(tea.KeyPressMsg{Code: 'o', Text: "o"})
	ms := m.modal
	if len(ms.matches) < 2 {
		t.Fatalf("setup: expected repo-tools and frodo to match, got %d", len(ms.matches))
	}
	if first := ms.rows[ms.matches[0].Index]; !first.main {
		t.Fatalf("main worktree should lead the matches, got %q", first.label)
	}
}

func TestMainWorktreeSeparatorIsNotAClickTarget(t *testing.T) {
	m := mainWorktreeMission()
	m.Update(tea.KeyPressMsg{Code: 'w', Text: "w"})
	lines := modalDisplayLines(m.modal)
	if len(lines) != 6 {
		t.Fatalf("want main row, three separator lines, two rows; got %d", len(lines))
	}
	for i, wantRow := range []bool{true, false, false, false, true, true} {
		if lines[i].isRow() != wantRow {
			t.Fatalf("display line %d: isRow = %v, want %v", i, lines[i].isRow(), wantRow)
		}
	}
}

func landOnMainWorktree(t *testing.T, m *Mission) {
	t.Helper()
	next := m.model
	next.Current.Worktree = "/repo"
	raw, err := json.Marshal(next)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.SetModel(raw); err != nil {
		t.Fatal(err)
	}
}

func TestShiftWConfirmsOnceTheMainWorktreeLands(t *testing.T) {
	m := mainWorktreeMission()
	m.model.Current.Worktree = "/w/gandalf"
	m.Update(tea.KeyPressMsg{Code: 'W', Text: "W"})
	if text, _ := m.notice(); text != "" {
		t.Fatalf("nothing to confirm until the switch lands, got %q", text)
	}
	landOnMainWorktree(t, m)
	if text, tone := m.notice(); text != "Switched back to the main worktree" || tone != noticeInfo {
		t.Fatalf("notice = %q (%s), want the info confirmation", text, tone)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if text, _ := m.notice(); text != "" {
		t.Fatalf("the confirmation should clear on the next key, got %q", text)
	}
}

func TestASwitchToTheMainWorktreeFromTheFoldoutStaysQuiet(t *testing.T) {
	m := mainWorktreeMission()
	m.model.Current.Worktree = "/w/gandalf"
	landOnMainWorktree(t, m)
	if text, _ := m.notice(); text != "" {
		t.Fatalf("only W confirms the switch, got %q", text)
	}
}

func TestKeybarListsTheMainWorktreeKeyInEveryMode(t *testing.T) {
	for _, mode := range []string{"changes", "history", "stash"} {
		if out := ansi.Strip(renderKeybar(200, mode)); !strings.Contains(out, "w worktree · W main") {
			t.Fatalf("%s keybar missing W main: %q", mode, out)
		}
	}
}
