//go:build darwin || linux

package background

import (
	"image/color"
	"path/filepath"
	"testing"
	"time"

	"github.com/creack/pty"
	"golang.org/x/sys/unix"
)

func TestAHungUpTerminalEndsTheReadAtOnce(t *testing.T) {
	ptmx, pts, err := pty.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer pts.Close()
	ptmx.Close()
	start := time.Now()
	n, err := device(pts.Fd()).ReadTimeout(make([]byte, 8), time.Second)
	if err == nil || n != 0 {
		t.Fatalf("got %d, %v from a hung-up terminal", n, err)
	}
	if d := time.Since(start); d > 100*time.Millisecond {
		t.Fatalf("waited %v", d)
	}
}

type probeCount struct {
	n      int
	answer color.Color
}

func (p *probeCount) probe() (color.Color, bool) {
	p.n++
	return p.answer, p.answer != nil
}

func TestOneRunAsksTheTerminalOnce(t *testing.T) {
	lock := filepath.Join(t.TempDir(), "bg.lock")
	p := &probeCount{answer: color.RGBA{0x1a, 0x1b, 0x26, 0xff}}
	for i := 0; i < 3; i++ {
		c, ok := shared(lock, "run-1", 50*time.Millisecond, p.probe)
		if !ok || Of(c) != Dark {
			t.Fatalf("call %d: %v %v", i, c, ok)
		}
	}
	if p.n != 1 {
		t.Fatalf("asked %d times in one run", p.n)
	}
	if _, ok := shared(lock, "run-2", 50*time.Millisecond, p.probe); !ok || p.n != 2 {
		t.Fatalf("a new run did not ask: %d", p.n)
	}
	shared(lock, "", 50*time.Millisecond, p.probe)
	shared(lock, "", 50*time.Millisecond, p.probe)
	if p.n != 4 {
		t.Fatalf("no run id should ask every time: %d", p.n)
	}
}

func TestNoAnswerIsSharedToo(t *testing.T) {
	lock := filepath.Join(t.TempDir(), "bg.lock")
	p := &probeCount{}
	for i := 0; i < 2; i++ {
		if _, ok := shared(lock, "run-1", 50*time.Millisecond, p.probe); ok {
			t.Fatal("silence gave a color")
		}
	}
	p.answer = color.White
	if _, ok := shared(lock, "run-1", 50*time.Millisecond, p.probe); ok || p.n != 1 {
		t.Fatalf("the run's first answer did not stick: asked %d", p.n)
	}
}

func TestAProbeWaitsForTheOneInFlightAndTakesItsAnswer(t *testing.T) {
	lock := filepath.Join(t.TempDir(), "bg.lock")
	holder := &probeCount{answer: color.RGBA{0x1a, 0x1b, 0x26, 0xff}}
	holding := make(chan struct{})
	slow := func() (color.Color, bool) {
		close(holding)
		time.Sleep(80 * time.Millisecond)
		return holder.probe()
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		shared(lock, "run-1", 200*time.Millisecond, slow)
	}()
	<-holding
	waiter := &probeCount{answer: color.White}
	c, ok := shared(lock, "run-1", 200*time.Millisecond, waiter.probe)
	<-done
	if !ok || Of(c) != Dark || waiter.n != 0 || holder.n != 1 {
		t.Fatalf("got %v %v, waiter asked %d, holder asked %d", c, ok, waiter.n, holder.n)
	}
}

func TestAProbeGivesUpWaitingAtItsBound(t *testing.T) {
	lock := filepath.Join(t.TempDir(), "bg.lock")
	fd, err := unix.Open(lock, unix.O_RDWR|unix.O_CREAT, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer unix.Close(fd)
	if err := unix.Flock(fd, unix.LOCK_EX); err != nil {
		t.Fatal(err)
	}
	p := &probeCount{answer: color.White}
	start := time.Now()
	if _, ok := shared(lock, "run-1", 60*time.Millisecond, p.probe); ok || p.n != 0 {
		t.Fatalf("ok %v, asked %d", ok, p.n)
	}
	if d := time.Since(start); d < 60*time.Millisecond || d > 300*time.Millisecond {
		t.Fatalf("waited %v", d)
	}
}
