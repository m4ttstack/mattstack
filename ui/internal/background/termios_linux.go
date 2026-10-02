package background

import "golang.org/x/sys/unix"

const (
	getTermios      = unix.TCGETS
	setTermios      = unix.TCSETS
	setTermiosFlush = unix.TCSETSF
)
