//go:build darwin || linux

package background_test

import (
	"bytes"
	"io"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/creack/pty"

	"rt-ui/internal/testutil"
)

const hello = `{"t":"hello","protocol":1}`

// shell runs script as the session leader of a fresh pty, with the pty as
// its stdin, stdout and stderr, so the helper's /dev/tty and the shell's
// read share one line discipline. typed goes in before the script starts;
// reply is written once a DA1 query shows up, and later 700 ms in.
func shell(t *testing.T, script, typed, reply, later string) string {
	t.Helper()
	return shellAfter(t, script, typed, reply, later, 0)
}

// shellAfter is shell with the reply held back by delay, a terminal with
// some latency.
func shellAfter(t *testing.T, script, typed, reply, later string, delay time.Duration) string {
	t.Helper()
	ptmx, pts, err := pty.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer ptmx.Close()
	cmd := exec.Command("/bin/sh", "-c", script)
	// A private TMPDIR keeps each test's lock file, and the answer it holds,
	// from outliving the test.
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=" + t.TempDir(), "TMPDIR=" + t.TempDir(), "TERM=xterm-256color", "COLORTERM=truecolor", "BIN=" + testutil.Binary(t), "HELLO=" + hello}
	cmd.Stdin, cmd.Stdout, cmd.Stderr = pts, pts, pts
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 0}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	pts.Close()
	if typed != "" {
		io.WriteString(ptmx, typed)
	}
	if later != "" {
		time.AfterFunc(700*time.Millisecond, func() { io.WriteString(ptmx, later) })
	}
	var mu sync.Mutex
	var out bytes.Buffer
	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 4096)
		answered := reply == ""
		for {
			n, err := ptmx.Read(buf)
			mu.Lock()
			out.Write(buf[:n])
			ask := !answered && strings.Contains(out.String(), "\x1b[c")
			mu.Unlock()
			if ask {
				answered = true
				time.AfterFunc(delay, func() { io.WriteString(ptmx, reply) })
			}
			if err != nil {
				return
			}
		}
	}()
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	select {
	case <-exited:
	case <-time.After(10 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("the script did not finish")
	}
	select {
	case <-done:
	case <-time.After(time.Second):
	}
	mu.Lock()
	defer mu.Unlock()
	return out.String()
}

const report = `printf '%s\n' "$HELLO" | RT_UI_BACKGROUND=auto "$BIN" render --report-background 2>&1 >/dev/null`

func TestPendingInputSkipsTheQueryAndIsStillThere(t *testing.T) {
	out := shell(t, "sleep 0.3; "+report+`; read line; echo "GOT:[$line]"`, "typeahead\n", "\x1b[?62;22c", "")
	if strings.Contains(out, "\x1b]11;?") {
		t.Fatalf("the terminal was asked over pending input: %q", out)
	}
	if !strings.Contains(out, "GOT:[typeahead]") || !strings.Contains(out, "background=unknown") {
		t.Fatalf("out %q", out)
	}
}

func TestAPartialLineSkipsTheQueryAndIsStillThere(t *testing.T) {
	out := shell(t, "sleep 0.3; "+report+`; read line; echo "GOT:[$line]"`, "type", "\x1b[?62;22c", "ahead\n")
	if strings.Contains(out, "\x1b]11;?") {
		t.Fatalf("the terminal was asked over a partial line: %q", out)
	}
	if !strings.Contains(out, "GOT:[typeahead]") {
		t.Fatalf("the partial line was lost: %q", out)
	}
}

func TestKeysTypedAfterTheRepliesSurvive(t *testing.T) {
	out := shell(t, report+`; read line; echo "GOT:[$line]"`, "", "\x1b]11;rgb:1a1a/1b1b/2626\x1b\\\x1b[?62;22clater\n", "")
	if !strings.Contains(out, "background=dark") || !strings.Contains(out, "GOT:[later]") {
		t.Fatalf("out %q", out)
	}
}

func TestOverlappingProbesLeaveTheTerminalCooked(t *testing.T) {
	out := shell(t, report+" & "+report+"; wait; stty -a", "", "", "")
	if strings.Contains(out, "-icanon") || strings.Contains(out, "-echo ") {
		t.Fatalf("the terminal was left raw: %q", out)
	}
	if !strings.Contains(out, "icanon") {
		t.Fatalf("no stty output: %q", out)
	}
}

func TestAStepAndARenderInOneRunDrawTheSameSet(t *testing.T) {
	steps := `printf '%s\n' "$HELLO" '{"t":"start","title":"working"}' '{"t":"sub","text":"one"}' '{"t":"done","title":"worked"}' | RT_UI_BACKGROUND=auto RT_UI_BACKGROUND_RUN=run-1 "$BIN" steps`
	render := `printf '%s\n' "$HELLO" '{"t":"line","status":"done","title":"x"}' | RT_UI_BACKGROUND=auto RT_UI_BACKGROUND_RUN=run-1 "$BIN" render > "$HOME/render.out"`
	script := steps + " & sleep 0.02; " + render + `; wait; cat "$HOME/render.out"`
	out := shellAfter(t, script, "", "\x1b]11;rgb:1a1a/1b1b/2626\x1b\\\x1b[?62;22c", "", 120*time.Millisecond)
	if n := strings.Count(out, "\x1b]11;?"); n != 1 {
		t.Fatalf("the terminal was asked %d times: %q", n, out)
	}
	if strings.Contains(out, "18;171;86") || strings.Count(out, "98;230;168") < 2 {
		t.Fatalf("the step and the render disagree: %q", out)
	}
}

func TestAStepUnderNoColorNeverAsksTheTerminal(t *testing.T) {
	steps := `printf '%s\n' "$HELLO" '{"t":"start","title":"working"}' '{"t":"done","title":"worked"}' | NO_COLOR=1 RT_UI_BACKGROUND=auto "$BIN" steps`
	out := shell(t, steps, "", "\x1b]11;rgb:1a1a/1b1b/2626\x1b\\\x1b[?62;22c", "")
	if strings.Contains(out, "\x1b]11;?") {
		t.Fatalf("a NO_COLOR step asked the terminal: %q", out)
	}
	if !strings.Contains(out, "worked") {
		t.Fatalf("out %q", out)
	}
}

func TestCtrlCDuringTheProbeExits130AndLeavesTheTerminalCooked(t *testing.T) {
	out := shellAfter(t, "trap : INT; "+report+`; echo "EXIT:$?"; stty -a`, "", "\x03", "", 50*time.Millisecond)
	if !strings.Contains(out, "EXIT:130") {
		t.Fatalf("Ctrl-C did not end the probe with 130: %q", out)
	}
	if strings.Contains(out, "-icanon") || strings.Contains(out, "-echo ") || strings.Contains(out, "-isig") || !strings.Contains(out, "icanon") {
		t.Fatalf("the terminal was not left cooked: %q", out)
	}
}

func TestASlowReplyIsReadInsteadOfReachingTheShell(t *testing.T) {
	out := shellAfter(t, report+`; read line; echo "GOT:[$line]"`, "", "\x1b]11;rgb:1a1a/1b1b/2626\x1b\\\x1b[?62;22c", "done\n", 400*time.Millisecond)
	if !strings.Contains(out, "GOT:[done]") || strings.Contains(out, "^[]11") {
		t.Fatalf("the late reply reached the shell: %q", out)
	}
	if !strings.Contains(out, "background=dark") {
		t.Fatalf("the late reply was not used: %q", out)
	}
}

func TestAProbeLeavesNoLockFileBehind(t *testing.T) {
	out := shell(t, report+`; ls -a "$TMPDIR"; echo END`, "", "\x1b]11;rgb:1a1a/1b1b/2626\x1b\\\x1b[?62;22c", "")
	if !strings.Contains(out, "END") || strings.Contains(out, "rt-ui-background") {
		t.Fatalf("a lock file was left: %q", out)
	}
}

func TestADarkOrLightSettingNeverAsksTheTerminal(t *testing.T) {
	for _, word := range []string{"dark", "light"} {
		script := `printf '%s\n' "$HELLO" | RT_UI_BACKGROUND=` + word + ` "$BIN" render --report-background 2>&1 >/dev/null`
		out := shell(t, script, "", "\x1b]11;rgb:1a1a/1b1b/2626\x1b\\\x1b[?62;22c", "")
		if strings.Contains(out, "\x1b]11;?") || !strings.Contains(out, "background="+word) {
			t.Fatalf("%s: %q", word, out)
		}
	}
}
