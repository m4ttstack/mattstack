package background

import "golang.org/x/sys/unix"

const (
	getTermios      = unix.TIOCGETA
	setTermios      = unix.TIOCSETA
	setTermiosFlush = unix.TIOCSETAF
)
