package mission_test

import (
	"strings"
	"testing"
	"time"
)

func mainWorktreeModel(mainCurrent bool) string {
	main, linked := "false", "true"
	if mainCurrent {
		main, linked = "true", "false"
	}
	rows := `"worktrees":[` +
		`{"path":"/repo","name":"repo-tools","branch":"main","badge":{},"current":` + main + `,"onDeck":false,"main":true},` +
		`{"path":"/w/gandalf","name":"gandalf","branch":"mission-tui","badge":{},"current":` + linked + `,"onDeck":false,"main":false}],`
	return strings.Replace(canCommitModel, `"changes":`, rows+`"changes":`, 1)
}

func TestShiftWSwitchesToTheMainWorktree(t *testing.T) {
	s := openMission(t, mainWorktreeModel(false), "Commit 1 file to main")
	s.Type("W")
	l := waitIntent(t, s, "mission:worktree")
	if !strings.Contains(l, `"path":"/repo"`) {
		t.Fatalf("W should switch to the main worktree: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}

func TestShiftWOnTheMainWorktreeSaysSoWithoutEmitting(t *testing.T) {
	s := openMission(t, mainWorktreeModel(true), "Commit 1 file to main")
	s.Type("W")
	s.WaitForPaint("Already in the main worktree")
	if l, ok := s.ReadLine(200 * time.Millisecond); ok {
		t.Fatalf("W on the main worktree must not emit: %q", l)
	}
	s.Send(`{"t":"close"}`)
	s.Wait()
}
