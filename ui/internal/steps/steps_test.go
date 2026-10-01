package steps_test

import (
	"strings"
	"testing"

	"rt-ui/internal/testutil"
)

const hello = `{"t":"hello","protocol":1}`

func TestDoneStepPrintsCheckLineAndExitsZero(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"fetching origin…"}`, `{"t":"done","title":"origin fetched","hint":"3 new commits"}`}
	stdout, tty, exit := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	if exit != 0 || stdout != "" {
		t.Fatalf("exit %d stdout %q", exit, stdout)
	}
	if !strings.Contains(tty, "✓") || !strings.Contains(tty, "origin fetched") || !strings.Contains(tty, "3 new commits") {
		t.Fatalf("tty %q", tty)
	}
}

func TestFailStepPrintsCrossLine(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"rebasing…"}`, `{"t":"fail","title":"rebase stopped","hint":"conflict in lib/state/db.ts"}`}
	_, tty, exit := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	if exit != 0 || !strings.Contains(tty, "✗") || !strings.Contains(tty, "rebase stopped") {
		t.Fatalf("exit %d tty %q", exit, tty)
	}
}

func TestLogLinesAppearAboveTheActiveStep(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"pushing…"}`, `{"t":"log","level":"warn","text":"diverged from origin/main"}`, `{"t":"done","title":"pushed"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	warnAt := strings.Index(tty, "diverged from origin/main")
	doneAt := strings.LastIndex(tty, "pushed")
	if warnAt < 0 || doneAt < 0 || warnAt > doneAt {
		t.Fatalf("order wrong: %q", tty)
	}
	if !strings.Contains(testutil.Screen(tty), "! diverged from origin/main") {
		t.Fatalf("warn glyph missing: %q", tty)
	}
}

func TestEOFWithoutDoneIsInterrupted(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"fetching origin…"}`}
	_, tty, exit := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	if exit != 0 || !strings.Contains(tty, "interrupted") {
		t.Fatalf("exit %d tty %q", exit, tty)
	}
}

func TestFastStepNeverPaintsASpinnerFrame(t *testing.T) {
	// start and done arrive together: the final line is all that is painted.
	lines := []string{hello, `{"t":"start","title":"fetching origin…"}`, `{"t":"done","title":"origin fetched"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	for _, f := range []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠣", "⠏"} {
		if strings.Contains(tty, f) {
			t.Fatalf("spinner frame %q painted for an instant step: %q", f, tty)
		}
	}
}

func TestBadHelloExits2(t *testing.T) {
	_, _, exit := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, []string{`{"t":"hello","protocol":7}`}, nil, nil, true)
	if exit != 2 {
		t.Fatalf("exit %d", exit)
	}
}

func TestCtrlCFinalizesInterruptedAndExits130(t *testing.T) {
	// The tty is cooked, so ^C on the pty is a SIGINT to the process group,
	// not a key: rt-ui must finalize the active line and exit 130 while the
	// parent (who keeps stdin open here) handles its own SIGINT.
	lines := []string{hello, `{"t":"start","title":"fetching origin…"}`}
	_, tty, exit := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, []string{"\x03"}, nil, false)
	if exit != 130 {
		t.Fatalf("exit %d, want 130", exit)
	}
	if !strings.Contains(tty, "interrupted") || !strings.HasSuffix(strings.TrimRight(tty, "\r"), "\n") {
		t.Fatalf("line not finalized with a newline: %q", tty)
	}
}

func TestSubLinesAreErasedWhenTheStepSucceeds(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"connecting…"}`, `{"t":"sub","text":"checking the session"}`, `{"t":"sub","text":"opening the tunnel"}`, `{"t":"done","title":"connected"}`}
	_, tty, exit := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	screen := testutil.Screen(tty)
	if exit != 0 || !strings.Contains(screen, "connected") {
		t.Fatalf("exit %d screen %q", exit, screen)
	}
	if strings.Contains(screen, "checking the session") || strings.Contains(screen, "opening the tunnel") {
		t.Fatalf("sub-lines survived a successful step: %q", screen)
	}
}

func TestSubLinesStayWhenTheStepFails(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"connecting…"}`, `{"t":"sub","text":"checking the session"}`, `{"t":"fail","title":"could not connect"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	screen := testutil.Screen(tty)
	if !strings.Contains(screen, "checking the session") || !strings.Contains(screen, "could not connect") {
		t.Fatalf("screen %q", screen)
	}
}

func TestOnlyTheLastFiveSubLinesShow(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"installing…"}`}
	for _, n := range []string{"1", "2", "3", "4", "5", "6", "7"} {
		lines = append(lines, `{"t":"sub","text":"line-`+n+`"}`)
	}
	lines = append(lines, `{"t":"fail","title":"install failed"}`)
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	screen := testutil.Screen(tty)
	for _, gone := range []string{"line-1", "line-2"} {
		if strings.Contains(screen, gone) {
			t.Fatalf("%s should have rolled off: %q", gone, screen)
		}
	}
	for _, kept := range []string{"line-3", "line-4", "line-5", "line-6", "line-7", "install failed"} {
		if !strings.Contains(screen, kept) {
			t.Fatalf("%s missing: %q", kept, screen)
		}
	}
}

func TestLongSubLineIsTruncatedAndErased(t *testing.T) {
	long := strings.Repeat("x", 400)
	lines := []string{hello, `{"t":"start","title":"connecting…"}`, `{"t":"sub","text":"` + long + `"}`, `{"t":"done","title":"connected"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	screen := testutil.Screen(tty)
	if strings.Contains(screen, "xxxx") {
		t.Fatalf("a wrapped sub-line left fragments behind: %q", screen)
	}
	if !strings.Contains(screen, "connected") {
		t.Fatalf("done line missing: %q", screen)
	}
}

func TestALogLineMakesEarlierSubLinesPermanent(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"connecting…"}`, `{"t":"sub","text":"before the log"}`, `{"t":"log","level":"warn","text":"session was stale"}`, `{"t":"sub","text":"after the log"}`, `{"t":"done","title":"connected"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	screen := testutil.Screen(tty)
	if !strings.Contains(screen, "session was stale") || !strings.Contains(screen, "before the log") {
		t.Fatalf("the log line or the sub-line above it was erased: %q", screen)
	}
	if strings.Contains(screen, "after the log") {
		t.Fatalf("a sub-line after the log survived: %q", screen)
	}
}

func TestSubTextIsCleaned(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"connecting…"}`, `{"t":"sub","text":"a\u001b[2Jb"}`, `{"t":"fail","title":"failed"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	if strings.Contains(tty, "\x1b[2J") {
		t.Fatalf("escape from sub text reached the terminal: %q", tty)
	}
}

func TestDoneWithAStatusEndsInThatStatusNotAFailure(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"connecting Slack…"}`, `{"t":"done","title":"Slack","hint":"not connected","status":"needs-you"}`}
	_, tty, exit := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	if exit != 0 || !strings.Contains(tty, "◆") || !strings.Contains(tty, "Slack") {
		t.Fatalf("exit %d tty %q", exit, tty)
	}
	if strings.Contains(tty, "✓") || strings.Contains(tty, "✗") || strings.Contains(tty, "255;121;121") {
		t.Fatalf("a needs-you ending was painted as done or as a failure: %q", tty)
	}
}

func TestDoneWithTheFailedStatusIsNotPaintedAsAFailure(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"syncing…"}`, `{"t":"done","title":"synced","status":"failed"}`}
	_, tty, exit := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	if exit != 0 || !strings.Contains(tty, "•") || !strings.Contains(tty, "synced") {
		t.Fatalf("exit %d tty %q", exit, tty)
	}
	if strings.Contains(tty, "✗") || strings.Contains(tty, "255;121;121") {
		t.Fatalf("done painted the coral cross: %q", tty)
	}
}

func TestDoneWithAnUnknownStatusGetsTheDimDot(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"syncing…"}`, `{"t":"done","title":"synced","status":"mystery"}`}
	_, tty, exit := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	if exit != 0 || !strings.Contains(tty, "•") || !strings.Contains(tty, "synced") {
		t.Fatalf("exit %d tty %q", exit, tty)
	}
	if strings.Contains(tty, "✗") || strings.Contains(tty, "255;121;121") {
		t.Fatalf("done painted the coral cross: %q", tty)
	}
}

func rowOf(screen, needle string) int {
	for i, l := range strings.Split(screen, "\n") {
		if strings.Contains(l, needle) {
			return i
		}
	}
	return -1
}

func TestSubLinesSitUnderTheirStepAfterAFailure(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"connecting…"}`, `{"t":"sub","text":"checking the session"}`, `{"t":"sub","text":"opening the tunnel"}`, `{"t":"fail","title":"could not connect"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	screen := testutil.Screen(tty)
	step, first, second := rowOf(screen, "could not connect"), rowOf(screen, "checking the session"), rowOf(screen, "opening the tunnel")
	if step < 0 || step >= first || first >= second {
		t.Fatalf("want step row < sub rows in order, got %d %d %d: %q", step, first, second, screen)
	}
}

func TestSubLinesSitUnderTheirStepWhenTheParentVanishes(t *testing.T) {
	lines := []string{hello, `{"t":"start","title":"connecting…"}`, `{"t":"sub","text":"checking the session"}`}
	_, tty, _ := testutil.RunPTY(t, []string{testutil.Binary(t), "steps"}, lines, nil, nil, true)
	screen := testutil.Screen(tty)
	step, sub := rowOf(screen, "connecting…"), rowOf(screen, "checking the session")
	if step < 0 || step >= sub {
		t.Fatalf("step row %d sub row %d: %q", step, sub, screen)
	}
}
