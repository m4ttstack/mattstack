package background

import "golang.org/x/sys/unix"

const (
	getTermios   = unix.TCGETS
	setTermios   = unix.TCSETS
	pendingInput = unix.TIOCINQ
	// _POSIX_VDISABLE.
	vdisable = 0
)

var quietKeys = []int{unix.VQUIT, unix.VSUSP}
