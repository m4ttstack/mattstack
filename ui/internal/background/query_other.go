//go:build !darwin && !linux

package background

import "image/color"

// QueryTerminal never asks on a platform rt-ui does not ship for.
func QueryTerminal() (color.Color, bool) { return nil, false }
