package mission

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/session"
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
	if m.toast != "" {
		t.Fatalf("nothing to confirm until the switch lands, got %q", m.toast)
	}
	landOnMainWorktree(t, m)
	if m.toast != "Switched back to the main worktree" {
		t.Fatalf("toast = %q, want the confirmation", m.toast)
	}
	if text, _ := m.notice(); text != "" {
		t.Fatalf("the confirmation is a toast, not a notice strip row, got %q", text)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if m.toast != "" {
		t.Fatalf("the toast should clear on the next key, got %q", m.toast)
	}
}

func TestToastFloatsAboveTheKeybarAtTheRightEdge(t *testing.T) {
	m := newTestMission()
	before := strings.Split(ansi.Strip(m.View().Content), "\n")
	m.setToast("Switched back to the main worktree")
	after := strings.Split(ansi.Strip(m.View().Content), "\n")
	if len(after) != len(before) {
		t.Fatalf("a toast must not change the frame height: %d rows, was %d", len(after), len(before))
	}
	keybar := len(after) - 1
	if after[keybar] != before[keybar] {
		t.Fatalf("the toast must leave the keybar alone:\n%q\n%q", before[keybar], after[keybar])
	}
	for gap := 1; gap <= toastGap; gap++ {
		if after[keybar-gap] != before[keybar-gap] {
			t.Fatalf("the toast keeps %d clear rows above the keybar:\n%q\n%q", toastGap, before[keybar-gap], after[keybar-gap])
		}
	}
	bottom := keybar - toastGap - 1
	if !strings.HasSuffix(after[bottom-1], theme.GlyphDone+" Switched back to the main worktree │ ") {
		t.Fatalf("toast text should sit flush right: %q", after[bottom-1])
	}
	if !strings.HasSuffix(after[bottom], "╯ ") || !strings.HasSuffix(after[bottom-2], "╮ ") {
		t.Fatalf("toast should be a bordered box:\n%q\n%q", after[bottom-2], after[bottom])
	}
}

func TestADriverToastShowsOncePerSeq(t *testing.T) {
	m := newTestMission()
	next := m.model
	next.Toast = &Toast{Seq: 1, Text: "Copied"}
	pushModel(t, m, next)
	if m.toast != "Copied" {
		t.Fatalf("toast = %q, want the driver's", m.toast)
	}
	m.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	pushModel(t, m, next)
	if m.toast != "" {
		t.Fatalf("a model re-sent with the same toast must not show it again, got %q", m.toast)
	}
	next.Toast = &Toast{Seq: 2, Text: "Fetched"}
	pushModel(t, m, next)
	if m.toast != "Fetched" {
		t.Fatalf("toast = %q, want the next seq's", m.toast)
	}
}

func TestShiftWKeepsItsOwnWordingOverTheDriversSwitchToast(t *testing.T) {
	m := mainWorktreeMission()
	m.model.Current.Worktree = "/w/gandalf"
	m.Update(tea.KeyPressMsg{Code: 'W', Text: "W"})
	next := m.model
	next.Current.Worktree = "/repo"
	next.Toast = &Toast{Seq: 1, Text: "Switched to repo-tools"}
	pushModel(t, m, next)
	if m.toast != "Switched back to the main worktree" {
		t.Fatalf("toast = %q, want W's own confirmation", m.toast)
	}
}

func TestToastExpiresOnItsOwnTimerOnly(t *testing.T) {
	m := newTestMission()
	m.setToast("first")
	stale := m.toastGen
	m.setToast("second")
	m.Update(toastExpiredMsg{generation: stale})
	if m.toast != "second" {
		t.Fatalf("an older toast's timer must not end a newer one, got %q", m.toast)
	}
	m.Update(toastExpiredMsg{generation: m.toastGen})
	if m.toast != "" {
		t.Fatalf("the toast should end when its own timer fires, got %q", m.toast)
	}
}

func TestAModelThatRaisesAToastStartsItsTimer(t *testing.T) {
	var scheduled time.Duration
	orig := toastTick
	toastTick = func(d time.Duration, fn func(time.Time) tea.Msg) tea.Cmd {
		scheduled = d
		return func() tea.Msg { return fn(time.Time{}) }
	}
	t.Cleanup(func() { toastTick = orig })

	m := mainWorktreeMission()
	m.model.Current.Worktree = "/w/gandalf"
	m.awaitingMain = "/repo"
	next := m.model
	next.Current.Worktree = "/repo"
	raw, err := json.Marshal(next)
	if err != nil {
		t.Fatal(err)
	}
	m.Update(session.ModelUpdate{Raw: raw})
	if scheduled != toastLifetime {
		t.Fatalf("toast timer = %v, want %v", scheduled, toastLifetime)
	}
}

func TestASwitchToTheMainWorktreeFromTheFoldoutStaysQuiet(t *testing.T) {
	m := mainWorktreeMission()
	m.model.Current.Worktree = "/w/gandalf"
	landOnMainWorktree(t, m)
	if m.toast != "" {
		t.Fatalf("only W confirms the switch, got %q", m.toast)
	}
}

func TestKeybarListsTheMainWorktreeKeyInEveryMode(t *testing.T) {
	for _, mode := range []string{"changes", "history", "stash"} {
		if out := ansi.Strip(renderKeybar(200, mode)); !strings.Contains(out, "w worktree · W main") {
			t.Fatalf("%s keybar missing W main: %q", mode, out)
		}
	}
}
