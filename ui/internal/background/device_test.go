//go:build darwin || linux

package background

import (
	"testing"
	"time"

	"github.com/creack/pty"
)

func TestAHungUpTerminalEndsTheReadAtOnce(t *testing.T) {
	ptmx, pts, err := pty.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer pts.Close()
	ptmx.Close()
	start := time.Now()
	n, err := device(pts.Fd()).ReadTimeout(make([]byte, 8), time.Second)
	if err == nil || n != 0 {
		t.Fatalf("got %d, %v from a hung-up terminal", n, err)
	}
	if d := time.Since(start); d > 100*time.Millisecond {
		t.Fatalf("waited %v", d)
	}
}
