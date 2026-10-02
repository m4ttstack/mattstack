//go:build darwin || linux

package background

import (
	"fmt"
	"image/color"
	"io"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sys/unix"
)

// QueryTerminal asks the controlling terminal for its background color.
// It never writes unless /dev/tty is a terminal this process group owns the
// foreground of: a background job that changed the tty mode would be
// stopped by SIGTTOU.
func QueryTerminal() (color.Color, bool) {
	fd, err := unix.Open("/dev/tty", unix.O_RDWR|unix.O_NOCTTY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, false
	}
	defer unix.Close(fd)
	pgrp, err := unix.IoctlGetInt(fd, unix.TIOCGPGRP)
	if err != nil || pgrp != unix.Getpgrp() {
		return nil, false
	}
	unlock, ok := lockTerminal()
	if !ok {
		return nil, false
	}
	defer unlock()
	return query(device(fd), queryCap, time.Now)
}

// lockTerminal keeps two probes off one terminal at once: the second would
// save the first one's raw mode as the mode to restore. The terminal is
// named by this session's id, because /dev/tty's own stat identity is the
// alias, never the device, and a session has exactly one controlling
// terminal.
func lockTerminal() (func(), bool) {
	sid, err := unix.Getsid(0)
	if err != nil {
		return nil, false
	}
	name := filepath.Join(os.TempDir(), fmt.Sprintf("rt-ui-background-%d-%d.lock", os.Getuid(), sid))
	fd, err := unix.Open(name, unix.O_RDWR|unix.O_CREAT|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0o600)
	if err != nil {
		return nil, false
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		unix.Close(fd)
		return nil, false
	}
	return func() { unix.Close(fd) }, true
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
