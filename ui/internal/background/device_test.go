//go:build darwin || linux

package background

import (
	"image/color"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
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

func TestEveryProbeThatFinishesRemovesTheLockFile(t *testing.T) {
	lock := filepath.Join(t.TempDir(), "bg.lock")
	p := &probeCount{answer: color.RGBA{0x1a, 0x1b, 0x26, 0xff}}
	for i, run := range []string{"run-1", "run-1", ""} {
		c, ok := shared(lock, run, 50*time.Millisecond, p.probe)
		if !ok || Of(c) != Dark {
			t.Fatalf("call %d: %v %v", i, c, ok)
		}
		if _, err := os.Lstat(lock); !os.IsNotExist(err) {
			t.Fatalf("call %d left the lock file: %v", i, err)
		}
	}
	if p.n != 3 {
		t.Fatalf("a probe that started after the last one finished asked %d times, want 3", p.n)
	}
}

func TestProbesNeverOverlapWhileTheLockFileComesAndGoes(t *testing.T) {
	lock := filepath.Join(t.TempDir(), "bg.lock")
	var active, overlaps, asked atomic.Int32
	probe := func() (color.Color, bool) {
		if active.Add(1) > 1 {
			overlaps.Add(1)
		}
		asked.Add(1)
		time.Sleep(2 * time.Millisecond)
		active.Add(-1)
		return nil, false
	}
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 15; i++ {
				shared(lock, "", 5*time.Second, probe)
			}
		}()
	}
	wg.Wait()
	if overlaps.Load() != 0 || asked.Load() != 120 {
		t.Fatalf("%d of %d probes overlapped another", overlaps.Load(), asked.Load())
	}
	if _, err := os.Lstat(lock); !os.IsNotExist(err) {
		t.Fatalf("the lock file was left: %v", err)
	}
}

func TestNoAnswerIsSharedToo(t *testing.T) {
	lock := filepath.Join(t.TempDir(), "bg.lock")
	holding := make(chan struct{})
	silent := func() (color.Color, bool) {
		close(holding)
		time.Sleep(80 * time.Millisecond)
		return nil, false
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		shared(lock, "run-1", 200*time.Millisecond, silent)
	}()
	<-holding
	waiter := &probeCount{answer: color.White}
	_, ok := shared(lock, "run-1", 200*time.Millisecond, waiter.probe)
	<-done
	if ok || waiter.n != 0 {
		t.Fatalf("the run's silence did not stick: ok %v, waiter asked %d", ok, waiter.n)
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
	if _, err := os.Lstat(lock); !os.IsNotExist(err) {
		t.Fatalf("the lock file was left: %v", err)
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
