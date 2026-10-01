package render

import (
	"strings"

	"rt-ui/internal/protocol"
)

type Options struct {
	// Width is the terminal's column count; values under 20 fall back to 80.
	Width int
}

type renderer struct {
	width int
	out   strings.Builder
}

// Render returns the styled text for blocks: every line newline-terminated,
// no leading or trailing blank line.
func Render(blocks []protocol.Block, opts Options) string {
	w := opts.Width
	if w < 20 {
		w = 80
	}
	r := &renderer{width: w}
	r.blocks(blocks)
	return r.out.String()
}

func (r *renderer) emit(s string) {
	r.out.WriteString(s)
	r.out.WriteByte('\n')
}

// gap writes one blank line, never at the top and never two in a row.
func (r *renderer) gap() {
	s := r.out.String()
	if s == "" || strings.HasSuffix(s, "\n\n") {
		return
	}
	r.out.WriteByte('\n')
}

func (r *renderer) blocks(bs []protocol.Block) {
	for i := 0; i < len(bs); i++ {
		if bs[i].T != "line" {
			r.block(bs[i])
			continue
		}
		j := i
		for j < len(bs) && (bs[j].T == "line" || bs[j].T == "callout") {
			j++
		}
		r.lineRun(bs[i:j])
		i = j - 1
	}
}

func (r *renderer) block(b protocol.Block) {
	switch b.T {
	case "callout":
		r.callout(b)
	case "kv":
		r.kv(b)
	case "summary":
		r.summary(b)
	case "banner":
		r.banner(b)
	case "failure":
		r.failure(b)
	}
}
