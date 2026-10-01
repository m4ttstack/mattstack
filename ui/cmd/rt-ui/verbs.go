package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"strconv"
	"sync/atomic"
	"syscall"

	"github.com/charmbracelet/colorprofile"

	"rt-ui/internal/prompt"
	"rt-ui/internal/protocol"
	"rt-ui/internal/render"
	"rt-ui/internal/session"
	"rt-ui/internal/steps"
	"rt-ui/internal/tty"
	"rt-ui/internal/views/board"
	"rt-ui/internal/views/mission"
	"rt-ui/internal/views/picker"
)

const protocolVersion = protocol.Version

func runPrompt() int {
	line, err := protocol.ReadLine(bufio.NewReader(os.Stdin))
	if err != nil {
		fmt.Fprintln(os.Stderr, "rt-ui prompt: no spec on stdin")
		return ExitBadSpec
	}
	spec, err := protocol.DecodePrompt(line)
	if err != nil {
		fmt.Fprintln(os.Stderr, "rt-ui prompt:", err)
		return ExitBadSpec
	}
	term, closeTerm, err := tty.Open(tty.ReadWrite)
	if err != nil {
		fmt.Fprintln(os.Stderr, "rt-ui prompt:", err)
		return ExitInternal
	}
	defer closeTerm()

	// The parent closing stdin is the only EOF we can ever see. Cancelling the
	// context shuts Bubble Tea down on its own thread, which is the only path
	// that restores termios; os.Exit from this goroutine would skip it and
	// leave the shell in raw mode.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tty.WatchStdinEOF(cancel)

	// Bubble Tea's signal handler is off (see prompt.Run), so every signal is
	// ours: SIGHUP would otherwise take its default action and run no restore
	// at all. Signals take the same cancel path a dead parent does, and the
	// flag is what keeps a cancelled prompt's 130 apart from that parent's 70.
	var signalled atomic.Bool
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	defer signal.Stop(signals)
	go func() {
		<-signals
		signalled.Store(true)
		cancel()
	}()

	result, outcome, err := prompt.Run(ctx, spec, term)
	if err != nil {
		switch {
		case errors.Is(err, protocol.ErrBadSpec):
			fmt.Fprintln(os.Stderr, "rt-ui prompt:", err)
			return ExitBadSpec
		case signalled.Load():
			return ExitCancel
		}
		fmt.Fprintln(os.Stderr, "rt-ui prompt:", err)
		return ExitInternal
	}
	switch outcome {
	case prompt.Cancelled:
		return ExitCancel
	case prompt.Back:
		return ExitBack
	}
	if _, err := os.Stdout.Write(protocol.EncodeResult(result)); err != nil {
		// stdout gone: the parent died between our answer and our write.
		return ExitInternal
	}
	return ExitOK
}

// runPick mirrors runPrompt's spec-then-run shape: decode the opening
// request off stdin (same protocol-mismatch gate as DecodePrompt), then hand
// the rest of stdin and stdout to picker.Run, which owns /dev/tty itself.
func runPick() int {
	r := bufio.NewReader(os.Stdin)
	line, err := protocol.ReadLine(r)
	if err != nil {
		fmt.Fprintln(os.Stderr, "rt-ui pick: no request on stdin")
		return ExitBadSpec
	}
	kind, raw, err := protocol.DecodePickLine(line)
	if err != nil || kind != "pick" {
		fmt.Fprintln(os.Stderr, "rt-ui pick: bad request")
		return ExitBadSpec
	}
	var req protocol.PickRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		fmt.Fprintln(os.Stderr, "rt-ui pick:", err)
		return ExitBadSpec
	}
	if req.Protocol != protocol.Version {
		fmt.Fprintf(os.Stderr, "rt-ui pick: protocol %d, rt-ui speaks %d\n", req.Protocol, protocol.Version)
		return ExitBadSpec
	}

	// Bubble Tea's own signal handler is off (see picker.Run), so SIGHUP
	// would otherwise take its default action and skip the terminal
	// restore entirely -- same rationale as runPrompt. Cancelling ctx is
	// the one path that shuts Bubble Tea down through its own cleanup.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var signalled atomic.Bool
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	defer signal.Stop(signals)
	go func() {
		<-signals
		signalled.Store(true)
		cancel()
	}()

	if err := picker.Run(ctx, req, r, os.Stdout); err != nil {
		if signalled.Load() {
			return ExitCancel
		}
		fmt.Fprintln(os.Stderr, "rt-ui pick:", err)
		return ExitInternal
	}
	return ExitOK
}

func runSteps() int {
	r := bufio.NewReader(os.Stdin)
	first, err := protocol.ReadLine(r)
	if err != nil {
		fmt.Fprintln(os.Stderr, "rt-ui steps: no hello on stdin")
		return ExitBadSpec
	}
	hello, err := protocol.DecodeStep(first)
	if err != nil || hello.T != "hello" || hello.Protocol != protocol.Version {
		fmt.Fprintf(os.Stderr, "rt-ui steps: bad hello %s\n", first)
		return ExitBadSpec
	}
	term, closeTerm, err := tty.Open(tty.WriteOnly)
	if err != nil {
		fmt.Fprintln(os.Stderr, "rt-ui steps:", err)
		return ExitInternal
	}
	defer closeTerm()

	events := make(chan protocol.StepEvent, 16)
	go func() {
		defer close(events)
		for {
			line, err := protocol.ReadLine(r)
			if err != nil {
				return
			}
			ev, err := protocol.DecodeStep(line)
			if err != nil {
				continue
			}
			events <- ev
		}
	}()
	// Cooked tty: ^C is a signal here, delivered to the whole group. Finalize
	// the line ourselves so the cursor never dies mid-spinner.
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	defer signal.Stop(signals)
	if steps.Run(events, signals, term) == steps.Signalled {
		return ExitCancel
	}
	return ExitOK
}

func runSession(args []string) int {
	viewName := ""
	for i := 0; i < len(args); i++ {
		if args[i] == "--view" && i+1 < len(args) {
			viewName = args[i+1]
			i++
		}
	}
	if viewName == "" {
		fmt.Fprintln(os.Stderr, "rt-ui session: --view <kind> is required")
		return ExitBadSpec
	}
	term, closeTerm, err := tty.Open(tty.ReadWrite)
	if err != nil {
		fmt.Fprintln(os.Stderr, "rt-ui session:", err)
		return ExitInternal
	}
	defer closeTerm()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	defer signal.Stop(signals)
	go func() {
		<-signals
		cancel()
	}()

	reason, _, err := session.Run(ctx, viewName, advertisedViews(), viewFor(viewName), os.Stdin, os.Stdout, term, version, session.Options{Mouse: viewName == "mission" || viewName == "board"})
	code := session.ExitCode(reason, err)
	if code == ExitBadSpec || code == ExitInternal {
		if err != nil {
			fmt.Fprintln(os.Stderr, "rt-ui session:", err)
		}
	}
	return code
}

// advertisedViews is what the hello line offers; the echo view is a test
// fixture and only appears when the env asks for it.
func advertisedViews() []string {
	views := []string{"board", "mission"}
	if os.Getenv("RT_UI_TEST_VIEWS") == "1" {
		views = append(views, "echo")
	}
	return views
}

// viewFor maps a view name to its constructor; nil means unknown. The echo
// view only exists for the session tests and is hidden without the env.
func viewFor(name string) func(*session.Emitter) session.View {
	switch name {
	case "board":
		return func(em *session.Emitter) session.View { return board.New(em) }
	case "mission":
		return func(em *session.Emitter) session.View { return mission.New(em) }
	case "echo":
		if os.Getenv("RT_UI_TEST_VIEWS") != "1" {
			return func(*session.Emitter) session.View { return nil }
		}
		return func(em *session.Emitter) session.View { return session.NewEcho(em) }
	}
	return func(*session.Emitter) session.View { return nil }
}

// runRender prints static blocks to stdout and exits. The color depth comes
// from the environment, not from stdout, because rt pipes this output and
// writes it to the terminal itself.
func runRender(args []string) int {
	width, noColor := 80, false
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--width":
			if i+1 < len(args) {
				if n, err := strconv.Atoi(args[i+1]); err == nil {
					width = n
				}
				i++
			}
		case "--no-color":
			noColor = true
		}
	}

	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	if !sc.Scan() {
		fmt.Fprintln(os.Stderr, "rt-ui render: no hello on stdin")
		return ExitBadSpec
	}
	var hello struct {
		T        string `json:"t"`
		Protocol int    `json:"protocol"`
	}
	if err := json.Unmarshal(sc.Bytes(), &hello); err != nil || hello.T != "hello" {
		fmt.Fprintln(os.Stderr, "rt-ui render: first line is not a hello")
		return ExitBadSpec
	}
	if hello.Protocol != protocol.Version {
		fmt.Fprintf(os.Stderr, "rt-ui render: protocol %d, rt-ui speaks %d\n", hello.Protocol, protocol.Version)
		return ExitBadSpec
	}

	var blocks []protocol.Block
	for sc.Scan() {
		if len(sc.Bytes()) == 0 {
			continue
		}
		b, err := protocol.DecodeBlock(sc.Bytes())
		if err != nil {
			fmt.Fprintln(os.Stderr, "rt-ui render:", err)
			return ExitBadSpec
		}
		blocks = append(blocks, b)
	}
	if err := sc.Err(); err != nil {
		fmt.Fprintln(os.Stderr, "rt-ui render:", err)
		return ExitBadSpec
	}

	profile := colorprofile.Env(os.Environ())
	if noColor {
		profile = colorprofile.NoTTY
	}
	w := &colorprofile.Writer{Forward: os.Stdout, Profile: profile}
	if _, err := w.WriteString(render.Render(blocks, render.Options{Width: width})); err != nil {
		return ExitInternal
	}
	return ExitOK
}
