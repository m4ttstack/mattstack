// Package steps renders one step: a spinner line while the parent works,
// then a final line in the status the step ended with. The tty is write-only
// and cooked, so Ctrl-C stays a signal to the whole group and the parent's
// own SIGINT handling runs.
package steps

import (
	"fmt"
	"os"
	"time"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	xterm "github.com/charmbracelet/x/term"

	"rt-ui/internal/protocol"
	"rt-ui/internal/render"
	"rt-ui/internal/theme"
	"rt-ui/internal/tty"
)

type Outcome int

const (
	Done Outcome = iota
	Failed
	Interrupted // parent went away (stdin EOF)
	Signalled   // SIGINT/SIGTERM/SIGHUP reached us
)

const frameEvery = theme.SpinnerInterval

// maxSubs caps the transient lines under a running step: more would scroll
// past the top of the screen, where the erase on success cannot reach.
const maxSubs = 5

var (
	spinStyle = lipgloss.NewStyle().Foreground(theme.Mint)
	textStyle = lipgloss.NewStyle()
	hintStyle = lipgloss.NewStyle().Foreground(theme.Faint)
	subStyle  = lipgloss.NewStyle().Foreground(theme.Dimmer)
	railGlyph = lipgloss.NewStyle().Foreground(theme.Panel).Render("│")
	okGlyph   = render.Glyph("done")
	badGlyph  = render.Glyph("failed")
	infoGlyph = lipgloss.NewStyle().Foreground(theme.Faint).Render("•")
)

func logGlyph(level string) string {
	switch level {
	case "warn":
		return render.Glyph("warn")
	case "error":
		return badGlyph
	case "success":
		return okGlyph
	}
	return infoGlyph
}

// Run consumes events until done/fail, the channel closes (parent gone), or
// a signal arrives. The spinner line is only ever painted once the first
// frame tick fires, so a step that finishes inside 80 ms paints its final
// line and nothing else.
func Run(events <-chan protocol.StepEvent, signals <-chan os.Signal, term *os.File) Outcome {
	var title string
	painted := false
	frame := 0
	ticker := time.NewTicker(frameEvery)
	defer ticker.Stop()

	// A row that wraps takes two lines and breaks the cursor arithmetic, so
	// the title row and every sub-line are cut to fit the terminal while the
	// block is live.
	// The block also needs the title row and the row the cursor rests on to
	// fit the pane, so a short pane keeps fewer sub-lines, or none.
	subWidth, titleWidth, subCap := 72, 67, maxSubs
	if w, h, err := xterm.GetSize(term.Fd()); err == nil {
		if w > 16 {
			subWidth, titleWidth = w-8, w-5
		}
		if h > 0 {
			subCap = max(0, min(maxSubs, h-2))
		}
	}
	// subs are rendered rows without a newline. While any exist the live
	// block is the title row then the subs, and the cursor rests at column 0
	// of the row under the last one; with none, it rests at the end of the
	// title row, as a plain spinner leaves it.
	var subs []string

	spinner := func() string {
		f := theme.SpinnerFrames[frame%len(theme.SpinnerFrames)]
		return "  " + spinStyle.Render(f) + " " + textStyle.Render(ansi.Truncate(title, titleWidth, "…"))
	}
	toTop := func() {
		if len(subs) > 0 {
			fmt.Fprintf(term, "\x1b[%dA", len(subs)+1)
		}
		fmt.Fprint(term, "\r")
	}
	clearActive := func() {
		if len(subs) > 0 {
			toTop()
			fmt.Fprint(term, "\x1b[J")
		} else if painted {
			fmt.Fprint(term, "\r\x1b[2K")
		}
		painted = false
	}
	line := func(glyph, t, hint string) string {
		l := "  " + glyph + " " + textStyle.Render(t)
		if hint != "" {
			l += "  " + hintStyle.Render(hint)
		}
		return l + "\n"
	}
	final := func(glyph, t, hint string) {
		clearActive()
		subs = nil
		fmt.Fprint(term, line(glyph, t, hint))
	}
	// finalKeep ends the step on its own row and leaves its sub-lines
	// beneath it as evidence.
	finalKeep := func(glyph, t, hint string) {
		kept := subs
		final(glyph, t, hint)
		for _, l := range kept {
			fmt.Fprint(term, l+"\n")
		}
	}

	for {
		select {
		case <-ticker.C:
			if title == "" {
				continue
			}
			if !painted {
				tty.FirstPaint()
			}
			painted = true
			if len(subs) > 0 {
				fmt.Fprintf(term, "\x1b[%dA\r\x1b[2K%s\x1b[%dB\r", len(subs)+1, spinner(), len(subs)+1)
			} else {
				fmt.Fprint(term, "\r\x1b[2K"+spinner())
			}
			frame++
		case <-signals:
			if title != "" {
				finalKeep(badGlyph, title, "interrupted")
			}
			return Signalled
		case ev, ok := <-events:
			if !ok {
				if title != "" {
					finalKeep(badGlyph, title, "interrupted")
				}
				return Interrupted
			}
			switch ev.T {
			case "start":
				title = ev.Title
			case "log":
				kept := subs
				clearActive()
				subs = nil
				for _, l := range kept {
					fmt.Fprint(term, l+"\n")
				}
				fmt.Fprint(term, "  "+logGlyph(ev.Level)+" "+textStyle.Render(ev.Text)+"\n")
			case "sub":
				if title == "" || subCap == 0 {
					continue
				}
				if len(subs) == 0 {
					fmt.Fprint(term, "\r\x1b[2K")
				} else {
					toTop()
					fmt.Fprint(term, "\x1b[J")
				}
				subs = append(subs, "    "+railGlyph+" "+subStyle.Render(ansi.Truncate(render.Clean(ev.Text), subWidth, "…")))
				if len(subs) > subCap {
					subs = subs[len(subs)-subCap:]
				}
				if !painted {
					tty.FirstPaint()
					painted = true
				}
				fmt.Fprint(term, spinner()+"\n")
				for _, l := range subs {
					fmt.Fprint(term, l+"\n")
				}
			case "done":
				if ev.Clear {
					clearActive()
					return Done
				}
				t := ev.Title
				if t == "" {
					t = title
				}
				// fail is the only coral ending, so "failed" on done gets the
				// dot an unknown status gets.
				g := okGlyph
				switch ev.Status {
				case "":
				case "failed":
					g = render.Glyph("")
				default:
					g = render.Glyph(ev.Status)
				}
				final(g, t, ev.Hint)
				return Done
			case "fail":
				t := ev.Title
				if t == "" {
					t = title
				}
				finalKeep(badGlyph, t, ev.Hint)
				return Failed
			}
		}
	}
}
