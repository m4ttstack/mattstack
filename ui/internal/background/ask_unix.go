//go:build darwin || linux

package background

import (
	"time"

	"golang.org/x/sys/unix"
)

// Ask writes q (which must end with the DA1 request, ESC [ c) to the
// controlling terminal in raw mode and returns everything it answers up to
// and including the DA1 reply. It asks only from the terminal's foreground
// process group, since a background job changing the tty mode is stopped
// by SIGTTOU.
func Ask(q string, limit time.Duration) ([]byte, bool) {
	fd, err := unix.Open("/dev/tty", unix.O_RDWR|unix.O_NOCTTY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, false
	}
	defer unix.Close(fd)
	pgrp, err := unix.IoctlGetInt(fd, unix.TIOCGPGRP)
	if err != nil || pgrp != unix.Getpgrp() {
		return nil, false
	}
	got, answered, _ := ask(device(fd), q, limit, time.Now)
	return got, answered
}
