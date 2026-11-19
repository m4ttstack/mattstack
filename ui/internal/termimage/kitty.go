package termimage

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"rt-ui/internal/background"
)

// faceBoxCols and faceBoxRows are the cell box a chat face fills.
const (
	faceBoxCols = 16
	faceBoxRows = 8
)

// kittyQuery asks for a 1x1 image and follows it with DA1, so a terminal
// that ignores the graphics query still answers something and the wait ends.
const kittyQuery = "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\\x1b[c"

func kittyReplyOK(reply []byte) bool {
	return bytes.Contains(reply, []byte("\x1b_Gi=31;OK"))
}

var (
	kittyOnce sync.Once
	kittyOK   bool
)

// KittySupported reports whether the terminal answers the kitty graphics
// query, asking at most once per process.
func KittySupported(timeout time.Duration) bool {
	kittyOnce.Do(func() {
		reply, answered := background.Ask(kittyQuery, timeout)
		kittyOK = answered && kittyReplyOK(reply)
	})
	return kittyOK
}

// placeholderDiacritics are the first entries of kitty's row/column
// diacritics table; the nth one encodes row or column n.
var placeholderDiacritics = []rune{
	0x0305, 0x030D, 0x030E, 0x0310, 0x0312, 0x033D, 0x033E, 0x033F,
	0x0346, 0x034A, 0x034B, 0x034C, 0x0350, 0x0351, 0x0352, 0x0357,
	0x035B, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
}

const placeholder = '\U0010EEEE'

// KittyPlaceholder is the text that shows image id's virtual placement in a
// cols x rows box: one placeholder cell per position, its row and column in
// diacritics and the image id in the foreground color.
func KittyPlaceholder(id uint32, cols, rows int) []string {
	color := fmt.Sprintf("\x1b[38;2;%d;%d;%dm", (id>>16)&0xff, (id>>8)&0xff, id&0xff)
	lines := make([]string, rows)
	for r := 0; r < rows; r++ {
		var sb strings.Builder
		sb.WriteString(color)
		for c := 0; c < cols; c++ {
			sb.WriteRune(placeholder)
			sb.WriteRune(placeholderDiacritics[r])
			sb.WriteRune(placeholderDiacritics[c])
		}
		sb.WriteString("\x1b[39m")
		lines[r] = sb.String()
	}
	return lines
}

const kittyChunk = 4096

// KittyTransmit is the escape sequence that sends the PNG at path as image
// id and gives it a virtual placement of cols x rows cells, for
// KittyPlaceholder to show. Replies are suppressed (q=2).
func KittyTransmit(id uint32, path string, cols, rows int) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	enc := base64.StdEncoding.EncodeToString(data)
	var sb strings.Builder
	for i := 0; i < len(enc); i += kittyChunk {
		end := min(i+kittyChunk, len(enc))
		more := 0
		if end < len(enc) {
			more = 1
		}
		if i == 0 {
			fmt.Fprintf(&sb, "\x1b_Ga=T,U=1,f=100,t=d,i=%d,c=%d,r=%d,q=2,m=%d;", id, cols, rows, more)
		} else {
			fmt.Fprintf(&sb, "\x1b_Gm=%d;", more)
		}
		sb.WriteString(enc[i:end])
		sb.WriteString("\x1b\\")
	}
	return sb.String(), nil
}
