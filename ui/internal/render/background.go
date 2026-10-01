package render

import (
	"strconv"
	"strings"
)

// LightBackground reads a COLORFGBG value ("fg;bg" or "fg;default;bg"), the
// one thing a piped process is told about the terminal's background. The
// colors 0 to 6 and 8 are dark; anything else that parses is light. A value
// that is absent or unreadable is not light.
func LightBackground(colorfgbg string) bool {
	parts := strings.Split(colorfgbg, ";")
	n, err := strconv.Atoi(strings.TrimSpace(parts[len(parts)-1]))
	if err != nil || n < 0 || n > 15 {
		return false
	}
	return n == 7 || n > 8
}
