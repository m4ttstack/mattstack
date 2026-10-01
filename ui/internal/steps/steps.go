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

	// A sub-line that wraps takes two rows and breaks the erase count, so
	// each one is cut to fit the terminal.
	subWidth := 72
	if w, _, err := xterm.GetSize(term.Fd()); err == nil && w > 16 {
		subWidth = w - 8
	}
	var subs []string

	clearActive := func() {
		if painted {
			fmt.Fprint(term, "\r\x1b[2K")
		}
		painted = false
	}
	// eraseSubs leaves the cursor where the first sub-line was. It is only
	// valid with the cursor at column 0 of the row under the last one.
	eraseSubs := func() {
		if len(subs) > 0 {
			fmt.Fprintf(term, "\x1b[%dA\x1b[J", len(subs))
		}
	}
	final := func(glyph, t, hint string) {
		clearActive()
		line := "  " + glyph + " " + textStyle.Render(t)
		if hint != "" {
			line += "  " + hintStyle.Render(hint)
		}
		fmt.Fprint(term, line+"\n")
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
			f := theme.SpinnerFrames[frame%len(theme.SpinnerFrames)]
			frame++
			fmt.Fprint(term, "\r\x1b[2K  "+spinStyle.Render(f)+" "+textStyle.Render(title))
		case <-signals:
			if title != "" {
				final(badGlyph, title, "interrupted")
			}
			return Signalled
		case ev, ok := <-events:
			if !ok {
				if title != "" {
					final(badGlyph, title, "interrupted")
				}
				return Interrupted
			}
			switch ev.T {
			case "start":
				title = ev.Title
			case "log":
				clearActive()
				subs = nil
				fmt.Fprint(term, "  "+logGlyph(ev.Level)+" "+textStyle.Render(ev.Text)+"\n")
			case "sub":
				clearActive()
				eraseSubs()
				subs = append(subs, "    "+railGlyph+" "+subStyle.Render(ansi.Truncate(render.Clean(ev.Text), subWidth, "…"))+"\n")
				if len(subs) > maxSubs {
					subs = subs[len(subs)-maxSubs:]
				}
				for _, l := range subs {
					fmt.Fprint(term, l)
				}
			case "done":
				t := ev.Title
				if t == "" {
					t = title
				}
				clearActive()
				eraseSubs()
				g := okGlyph
				if ev.Status != "" {
					g = render.Glyph(ev.Status)
				}
				final(g, t, ev.Hint)
				return Done
			case "fail":
				t := ev.Title
				if t == "" {
					t = title
				}
				final(badGlyph, t, ev.Hint)
				return Failed
			}
		}
	}
}
