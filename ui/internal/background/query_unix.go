//go:build darwin || linux

package background

import (
	"fmt"
	"image/color"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

// QueryTerminal asks the controlling terminal for its background color.
// It never writes unless /dev/tty is a terminal this process group owns the
// foreground of: a background job that changed the tty mode would be
// stopped by SIGTTOU. Overlapping helpers given one run id share one answer.
func QueryTerminal(run string) (color.Color, bool) {
	fd, err := unix.Open("/dev/tty", unix.O_RDWR|unix.O_NOCTTY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, false
	}
	defer unix.Close(fd)
	pgrp, err := unix.IoctlGetInt(fd, unix.TIOCGPGRP)
	if err != nil || pgrp != unix.Getpgrp() {
		return nil, false
	}
	sid, err := unix.Getsid(0)
	if err != nil {
		return nil, false
	}
	// The terminal is named by this session's id: /dev/tty's own stat
	// identity is the alias, never the device, and a session has exactly
	// one controlling terminal.
	lock := filepath.Join(os.TempDir(), fmt.Sprintf("rt-ui-background-%d-%d.lock", os.Getuid(), sid))
	return shared(lock, run, queryCap+100*time.Millisecond, func() (color.Color, bool) {
		return interruptible(device(fd), func() { _ = unix.Unlink(lock) })
	})
}

// interruptible runs the query with the terminal's own signal keys live. A
// signal while it runs restores the mode, gives up the lock file and ends
// the helper with 130; one that lands as the query finishes does the same
// once the mode is back.
func interruptible(d device, unlock func()) (color.Color, bool) {
	g := &guarded{TTY: d}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	done := make(chan struct{})
	watched := make(chan struct{})
	go func() {
		defer close(watched)
		select {
		case <-signals:
			g.abandon()
			unlock()
			os.Exit(exitCancel)
		case <-done:
		}
	}()
	c, ok := query(g, queryCap, time.Now)
	signal.Stop(signals)
	close(done)
	<-watched
	select {
	case <-signals:
		unlock()
		os.Exit(exitCancel)
	default:
	}
	return c, ok
}

// exitCancel is rt-ui's cancelled exit code.
const exitCancel = 130

// guarded lets a signal handler restore the mode the query set, exactly
// once, while the query itself may be mid-read.
type guarded struct {
	TTY
	mu      sync.Mutex
	restore func()
}

func (g *guarded) Raw() (func(), error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	restore, err := g.TTY.Raw()
	if err != nil {
		return nil, err
	}
	g.restore = restore
	return func() {
		g.mu.Lock()
		defer g.mu.Unlock()
		if g.restore != nil {
			g.restore()
			g.restore = nil
		}
	}, nil
}

// abandon restores the mode and keeps the guard held, so the query can
// never set it again on the way out.
func (g *guarded) abandon() {
	g.mu.Lock()
	if g.restore != nil {
		g.restore()
		g.restore = nil
	}
}

// shared runs probe under an exclusive lock on path, so two probes never
// touch the terminal at once (the second would save the first one's raw
// mode as the mode to restore). The holder records its answer, a missing
// one included, under run, then removes path before it lets go. A probe
// that waited on the same file takes a recorded answer for its run instead
// of asking again, so overlapping helpers of one rt command always agree.
// Without one it must ask, and asks only under a lock on the file path
// names now: a file already removed is no longer the lock a newcomer
// takes. A probe that cannot get the lock within wait gives no answer.
func shared(path, run string, wait time.Duration, probe func() (color.Color, bool)) (color.Color, bool) {
	deadline := time.Now().Add(wait)
	for {
		fd, err := unix.Open(path, unix.O_RDWR|unix.O_CREAT|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0o600)
		if err != nil {
			return nil, false
		}
		c, ok, retry := holding(fd, path, run, deadline, probe)
		unix.Close(fd)
		if !retry {
			return c, ok
		}
	}
}

func holding(fd int, path, run string, deadline time.Time, probe func() (color.Color, bool)) (c color.Color, ok, retry bool) {
	for unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB) != nil {
		if time.Now().After(deadline) {
			return nil, false, false
		}
		time.Sleep(5 * time.Millisecond)
	}
	buf := make([]byte, 256)
	n, _ := unix.Pread(fd, buf, 0)
	if run != "" {
		if rest, found := strings.CutPrefix(string(buf[:max(n, 0)]), run+" "); found {
			c, ok := parseHex(strings.TrimSpace(rest))
			return c, ok, false
		}
	}
	var held, named unix.Stat_t
	if unix.Fstat(fd, &held) != nil {
		return nil, false, false
	}
	if err := unix.Lstat(path, &named); err != nil || named.Dev != held.Dev || named.Ino != held.Ino {
		return nil, false, true
	}
	_ = unix.Ftruncate(fd, 0)
	c, ok = probe()
	if run != "" {
		answer := "none"
		if ok {
			r, g, b, _ := c.RGBA()
			answer = fmt.Sprintf("#%02x%02x%02x", r>>8, g>>8, b>>8)
		}
		_, _ = unix.Pwrite(fd, []byte(run+" "+answer+"\n"), 0)
	}
	_ = unix.Unlink(path)
	return c, ok, false
}

type device int

func (d device) Pending() (int, error) { return unix.IoctlGetInt(int(d), pendingInput) }

func (d device) Raw() (func(), error) {
	orig, err := unix.IoctlGetTermios(int(d), getTermios)
	if err != nil {
		return nil, err
	}
	raw := *orig
	// ISIG stays on so Ctrl-C still interrupts; the other signal keys are
	// switched off, since a stop or a core dump would skip the restore.
	raw.Lflag &^= unix.ICANON | unix.ECHO | unix.IEXTEN
	for _, k := range quietKeys {
		raw.Cc[k] = vdisable
	}
	raw.Iflag &^= unix.ICRNL | unix.IXON
	raw.Cc[unix.VMIN], raw.Cc[unix.VTIME] = 1, 0
	if err := unix.IoctlSetTermios(int(d), setTermios, &raw); err != nil {
		return nil, err
	}
	return func() { _ = unix.IoctlSetTermios(int(d), setTermios, orig) }, nil
}

func (d device) Write(p []byte) (int, error) { return unix.Write(int(d), p) }

// ReadTimeout waits with select, which works on a tty on macOS where poll
// does not. A readable terminal that reads nothing has hung up.
func (d device) ReadTimeout(p []byte, wait time.Duration) (int, error) {
	var set unix.FdSet
	set.Set(int(d))
	tv := unix.NsecToTimeval(wait.Nanoseconds())
	n, err := unix.Select(int(d)+1, &set, nil, nil, &tv)
	switch {
	case err == unix.EINTR:
		return 0, nil
	case err != nil:
		return 0, err
	case n == 0:
		return 0, nil
	}
	n, err = unix.Read(int(d), p)
	if err == nil && n == 0 {
		return 0, io.EOF
	}
	return n, err
}
