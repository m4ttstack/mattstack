package mission

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
)

func pushNeedsPullMission(t *testing.T, seq int) *Mission {
	t.Helper()
	m := newMouseTestMission()
	next := m.model
	next.PushNeedsPullPrompt = &PushNeedsPullPrompt{Seq: seq}
	pushModel(t, m, next)
	return m
}

func TestPushNeedsPullOpensNewerCommitsOnRemote(t *testing.T) {
	m := pushNeedsPullMission(t, 1)
	if m.menu == nil || m.menu.Title() != pushNeedsPullTitle {
		t.Fatal("a rejected push opens Newer Commits on Remote")
	}
	out := ansi.Strip(m.View().Content)
	for _, want := range []string{"unable to push commits", "Fetch", "Cancel"} {
		if !strings.Contains(out, want) {
			t.Fatalf("dialog missing %q:\n%s", want, out)
		}
	}
}

func TestPushNeedsPullFetchClosesTheDialog(t *testing.T) {
	m := pushNeedsPullMission(t, 1)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.menu != nil {
		t.Fatal("Fetch emits and closes the dialog")
	}
}

func TestPushNeedsPullOpensOncePerSeq(t *testing.T) {
	m := pushNeedsPullMission(t, 1)
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.menu != nil {
		t.Fatal("esc dismisses the dialog")
	}
	next := m.model
	next.PushNeedsPullPrompt = &PushNeedsPullPrompt{Seq: 1}
	pushModel(t, m, next)
	if m.menu != nil {
		t.Fatal("a seen seq must not reopen")
	}
	next.PushNeedsPullPrompt = &PushNeedsPullPrompt{Seq: 2}
	pushModel(t, m, next)
	if m.menu == nil || m.menu.Title() != pushNeedsPullTitle {
		t.Fatal("a new seq opens again")
	}
}
