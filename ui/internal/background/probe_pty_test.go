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
	ptmx, pts, err := pty.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer ptmx.Close()
	cmd := exec.Command("/bin/sh", "-c", script)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=" + t.TempDir(), "TERM=xterm-256color", "COLORTERM=truecolor", "BIN=" + testutil.Binary(t), "HELLO=" + hello}
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
				io.WriteString(ptmx, reply)
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
