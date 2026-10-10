package mission

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
)

func localChangesMission(t *testing.T, seq int, files []string, stash *StashModel) *Mission {
	t.Helper()
	m := newMouseTestMission()
	next := m.model
	next.Stash = stash
	next.LocalChangesPrompt = &LocalChangesPrompt{Seq: seq, Action: "pull", Files: files}
	pushModel(t, m, next)
	return m
}

func TestLocalChangesOpensDesktopsDialogWithTheFiles(t *testing.T) {
	m := localChangesMission(t, 1, []string{"docs/settings.pen", "RELEASE_NOTES.md"}, nil)
	if m.menu == nil || m.menu.Title() != localChangesTitle {
		t.Fatal("a pull blocked by local changes opens Desktop's dialog")
	}
	out := ansi.Strip(m.View().Content)
	for _, want := range []string{
		"Unable to pull when changes are present on your",
		"The following files would be overwritten:",
		"docs/settings.pen",
		"RELEASE_NOTES.md",
		"You can stash your changes now and recover them",
		"Stash Changes and Continue",
		"Close",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("dialog missing %q:\n%s", want, out)
		}
	}
}

func TestLocalChangesWithNoFilesSkipsTheFileList(t *testing.T) {
	m := localChangesMission(t, 1, nil, nil)
	out := ansi.Strip(m.View().Content)
	if strings.Contains(out, "would be overwritten") {
		t.Fatalf("no files means no file list sentence:\n%s", out)
	}
	if !strings.Contains(out, "Stash Changes and Continue") {
		t.Fatalf("stashing is still offered:\n%s", out)
	}
}

func TestLocalChangesWithAnExistingStashOffersOnlyClose(t *testing.T) {
	m := localChangesMission(t, 1, []string{"a.txt"}, &StashModel{Branch: "main", Sha: "abc"})
	out := ansi.Strip(m.View().Content)
	for _, gone := range []string{"Stash Changes and Continue", "You can stash"} {
		if strings.Contains(out, gone) {
			t.Fatalf("an existing stash must hide %q:\n%s", gone, out)
		}
	}
	if !strings.Contains(out, "Close") {
		t.Fatalf("Close stays:\n%s", out)
	}
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd != nil || m.menu != nil {
		t.Fatal("Close only dismisses")
	}
}

func TestLocalChangesStashClosesAndEmits(t *testing.T) {
	m := localChangesMission(t, 1, []string{"a.txt"}, nil)
	if _, cmd := m.Update(tea.KeyPressMsg{Code: tea.KeyEnter}); cmd == nil || m.menu != nil {
		t.Fatal("Stash Changes and Continue emits and closes the dialog")
	}
}

func TestLocalChangesOpensOncePerSeq(t *testing.T) {
	m := localChangesMission(t, 1, []string{"a.txt"}, nil)
	m.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if m.menu != nil {
		t.Fatal("esc dismisses the dialog")
	}
	next := m.model
	next.LocalChangesPrompt = &LocalChangesPrompt{Seq: 1, Action: "pull", Files: []string{"a.txt"}}
	pushModel(t, m, next)
	if m.menu != nil {
		t.Fatal("a seen seq must not reopen")
	}
	next.LocalChangesPrompt = &LocalChangesPrompt{Seq: 2, Action: "pull", Files: []string{"a.txt"}}
	pushModel(t, m, next)
	if m.menu == nil || m.menu.Title() != localChangesTitle {
		t.Fatal("a new seq opens again")
	}
}
