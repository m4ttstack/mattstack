//go:build !darwin && !linux

package background

import (
	"image/color"
	"time"
)

// QueryTerminal never asks on a platform rt-ui does not ship for.
func QueryTerminal(string) (color.Color, bool) { return nil, false }

// Ask never asks on a platform rt-ui does not ship for.
func Ask(string, time.Duration) ([]byte, bool) { return nil, false }
