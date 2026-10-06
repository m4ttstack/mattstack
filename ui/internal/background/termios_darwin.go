package background

import "golang.org/x/sys/unix"

const (
	getTermios = unix.TIOCGETA
	setTermios = unix.TIOCSETA
	// FIONREAD, _IOR('f', 127, int), which x/sys does not export on darwin.
	pendingInput = 0x4004667f
	// _POSIX_VDISABLE.
	vdisable = 0xff
)

var quietKeys = []int{unix.VQUIT, unix.VSUSP, unix.VDSUSP}
