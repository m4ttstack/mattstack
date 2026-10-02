//go:build darwin || linux

package background

import (
	"fmt"
	"image/color"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// QueryTerminal asks the controlling terminal for its background color.
// It never writes unless /dev/tty is a terminal this process group owns the
// foreground of: a background job that changed the tty mode would be
// stopped by SIGTTOU. Helpers given one run id share one answer.
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
		return query(device(fd), queryCap, time.Now)
	})
}

// shared runs probe under an exclusive lock on path, so two probes never
// touch the terminal at once (the second would save the first one's raw
// mode as the mode to restore). The holder records its answer, a missing
// one included, under run; a later probe with the same run, or one that
// waited out the holder, takes that answer instead of asking again, so a
// step and a render of one rt command always agree. A probe that cannot
// get the lock within wait gives no answer.
func shared(path, run string, wait time.Duration, probe func() (color.Color, bool)) (color.Color, bool) {
	fd, err := unix.Open(path, unix.O_RDWR|unix.O_CREAT|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0o600)
	if err != nil {
		return nil, false
	}
	defer unix.Close(fd)
	deadline := time.Now().Add(wait)
	for unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB) != nil {
		if time.Now().After(deadline) {
			return nil, false
		}
		time.Sleep(5 * time.Millisecond)
	}
	buf := make([]byte, 256)
	n, _ := unix.Pread(fd, buf, 0)
	if run != "" {
		if rest, ok := strings.CutPrefix(string(buf[:max(n, 0)]), run+" "); ok {
			if c, ok := parseHex(strings.TrimSpace(rest)); ok {
				return c, true
			}
			return nil, false
		}
	}
	_ = unix.Ftruncate(fd, 0)
	c, ok := probe()
	if run != "" {
		answer := "none"
		if ok {
			r, g, b, _ := c.RGBA()
			answer = fmt.Sprintf("#%02x%02x%02x", r>>8, g>>8, b>>8)
		}
		_, _ = unix.Pwrite(fd, []byte(run+" "+answer+"\n"), 0)
	}
	return c, ok
}

type device int

func (d device) Pending() (int, error) { return unix.IoctlGetInt(int(d), pendingInput) }

func (d device) Raw() (func(), error) {
	orig, err := unix.IoctlGetTermios(int(d), getTermios)
	if err != nil {
		return nil, err
	}
	raw := *orig
	raw.Lflag &^= unix.ICANON | unix.ECHO | unix.ISIG | unix.IEXTEN
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
