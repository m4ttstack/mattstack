package background

import (
	"errors"
	"image/color"
	"io"
	"io/fs"
	"testing"
	"time"
)

type world struct {
	env     map[string]string
	files   map[string]string
	answer  color.Color
	asked   int
	macOS   bool
	noQuery bool
}

func (w *world) inputs() Inputs {
	in := Inputs{
		Getenv: func(k string) string { return w.env[k] },
		ReadFile: func(p string) ([]byte, error) {
			if s, ok := w.files[p]; ok {
				return []byte(s), nil
			}
			return nil, fs.ErrNotExist
		},
		MacOS: w.macOS,
	}
	if !w.noQuery {
		in.Query = func() (color.Color, bool) {
			w.asked++
			return w.answer, w.answer != nil
		}
	}
	return in
}

var (
	darkColor  = color.RGBA{0x1a, 0x1b, 0x26, 0xff}
	lightColor = color.RGBA{0xfa, 0xfa, 0xfa, 0xff}
)

func TestTheSettingWinsAndNothingIsProbed(t *testing.T) {
	for value, want := range map[string]Background{"dark": Dark, "light": Light} {
		w := &world{env: map[string]string{"RT_UI_BACKGROUND": value, "COLORFGBG": "0;15", "TERM_PROGRAM": "ghostty", "HOME": "/h"}, answer: lightColor}
		if value == "light" {
			w.answer = darkColor
			w.env["COLORFGBG"] = "15;0"
		}
		if got := Resolve(w.inputs()); got != want {
			t.Errorf("%s: got %v", value, got)
		}
		if w.asked != 0 {
			t.Errorf("%s: the terminal was asked", value)
		}
	}
}

func TestAutoAsksTheTerminalOnlyWhenTheCheapStepsSayNothing(t *testing.T) {
	for name, c := range map[string]struct {
		answer color.Color
		want   Background
	}{"dark": {darkColor, Dark}, "light": {lightColor, Light}} {
		w := &world{env: map[string]string{"RT_UI_BACKGROUND": "auto"}, answer: c.answer}
		if got := Resolve(w.inputs()); got != c.want || w.asked != 1 {
			t.Errorf("%s: got %v, asked %d times", name, got, w.asked)
		}
	}
}

func TestColorfgbgOrGhosttyDecideBeforeTheTerminalIsAsked(t *testing.T) {
	w := &world{env: map[string]string{"RT_UI_BACKGROUND": "auto", "COLORFGBG": "0;15"}, answer: darkColor}
	if got := Resolve(w.inputs()); got != Light || w.asked != 0 {
		t.Fatalf("COLORFGBG: got %v, asked %d times", got, w.asked)
	}
	w = ghosttyWorld(map[string]string{"/h/.config/ghostty/config": "background = #000000\n"})
	w.noQuery = false
	w.answer = lightColor
	w.env["RT_UI_BACKGROUND"] = "auto"
	if got := Resolve(w.inputs()); got != Dark || w.asked != 0 {
		t.Fatalf("Ghostty: got %v, asked %d times", got, w.asked)
	}
}

func TestAGhosttyThatSaysNothingStillAsksTheTerminal(t *testing.T) {
	w := ghosttyWorld(map[string]string{"/h/.config/ghostty/config": "theme = light:Day,dark:Night\n"})
	w.noQuery = false
	w.answer = darkColor
	w.env["RT_UI_BACKGROUND"] = "auto"
	if got := Resolve(w.inputs()); got != Dark || w.asked != 1 {
		t.Fatalf("got %v, asked %d times", got, w.asked)
	}
}

func TestOnlyAnExplicitAutoAsksTheTerminal(t *testing.T) {
	w := &world{env: map[string]string{}, answer: darkColor}
	if got := Resolve(w.inputs()); got != Unknown || w.asked != 0 {
		t.Fatalf("got %v, asked %d times", got, w.asked)
	}
	w = &world{env: map[string]string{"RT_UI_BACKGROUND": "sepia"}, answer: darkColor}
	if got := Resolve(w.inputs()); got != Unknown || w.asked != 0 {
		t.Fatalf("an unknown word: got %v, asked %d times", got, w.asked)
	}
}

func TestATestRunNeverAsksTheTerminal(t *testing.T) {
	w := &world{env: map[string]string{"RT_UI_BACKGROUND": "auto", "RT_UI_NO_TERMINAL_QUERY": "1"}, answer: darkColor}
	if got := Resolve(w.inputs()); got != Unknown || w.asked != 0 {
		t.Fatalf("got %v, asked %d times", got, w.asked)
	}
}

func TestUnknownFromRtIsFinal(t *testing.T) {
	w := ghosttyWorld(map[string]string{"/h/.config/ghostty/config": "background = #000000\n"})
	w.noQuery = false
	w.answer = darkColor
	w.env["RT_UI_BACKGROUND"] = "unknown"
	w.env["COLORFGBG"] = "15;0"
	if got := Resolve(w.inputs()); got != Unknown || w.asked != 0 {
		t.Fatalf("got %v, asked %d times", got, w.asked)
	}
}

func TestATerminalWithNoAnswerFallsThroughToUnknown(t *testing.T) {
	w := &world{env: map[string]string{"RT_UI_BACKGROUND": "auto"}}
	if got := Resolve(w.inputs()); got != Unknown || w.asked != 1 {
		t.Fatalf("got %v, asked %d times", got, w.asked)
	}
}

func TestColorfgbg(t *testing.T) {
	for value, want := range map[string]Background{
		"": Unknown, "15;0": Dark, "0;15": Light, "0;default;15": Light, "7;8": Dark,
		"junk": Unknown, "0;16": Unknown, "0;7": Light, "12;default": Unknown,
	} {
		if got := FromColorfgbg(value); got != want {
			t.Errorf("COLORFGBG=%q: got %v want %v", value, got, want)
		}
		w := &world{env: map[string]string{"COLORFGBG": value}, noQuery: true}
		if got := Resolve(w.inputs()); got != want {
			t.Errorf("Resolve with COLORFGBG=%q: got %v want %v", value, got, want)
		}
	}
}

const resources = "/Applications/Ghostty.app/Contents/Resources/ghostty"

func ghosttyWorld(files map[string]string) *world {
	return &world{env: map[string]string{"HOME": "/h", "GHOSTTY_RESOURCES_DIR": resources, "TERM_PROGRAM": "herdr"}, files: files, noQuery: true, macOS: true}
}

func TestGhosttyExplicitBackgroundWins(t *testing.T) {
	w := ghosttyWorld(map[string]string{
		"/h/.config/ghostty/config":                     "theme = tokyo-night-default\nbackground = #fdf6e3\n",
		"/h/.config/ghostty/themes/tokyo-night-default": "background = #1a1b26\n",
	})
	if got := Resolve(w.inputs()); got != Light {
		t.Fatalf("got %v", got)
	}
}

func TestGhosttyThemeFromTheUserDirectory(t *testing.T) {
	w := ghosttyWorld(map[string]string{
		"/h/.config/ghostty/config":                     "# a comment\nfont-size = 13\ntheme = tokyo-night-default\n",
		"/h/.config/ghostty/themes/tokyo-night-default": "palette = 0=#15161e\nbackground = #1a1b26\nforeground = #c0caf5\n",
		resources + "/themes/tokyo-night-default":       "background = #ffffff\n",
	})
	if got := Resolve(w.inputs()); got != Dark {
		t.Fatalf("got %v", got)
	}
}

func TestGhosttyThemeFromTheResourcesDirectory(t *testing.T) {
	w := ghosttyWorld(map[string]string{
		"/h/.config/ghostty/config":                   `theme = "Builtin Solarized Light"` + "\n",
		resources + "/themes/Builtin Solarized Light": "background = fdf6e3\n",
	})
	if got := Resolve(w.inputs()); got != Light {
		t.Fatalf("got %v", got)
	}
}

func TestGhosttyLaterFilesWin(t *testing.T) {
	w := ghosttyWorld(map[string]string{
		"/h/.config/ghostty/config.ghostty":                                   "background = #ffffff\n",
		"/h/.config/ghostty/config":                                           "background = #000000\n",
		"/h/Library/Application Support/com.mitchellh.ghostty/config.ghostty": "background = #fafafa\n",
	})
	if got := Resolve(w.inputs()); got != Light {
		t.Fatalf("the macOS file loads last: got %v", got)
	}
	w.macOS = false
	if got := Resolve(w.inputs()); got != Dark {
		t.Fatalf("off macOS the XDG config wins: got %v", got)
	}
}

func TestGhosttyHonoursXdgConfigHome(t *testing.T) {
	w := ghosttyWorld(map[string]string{"/x/ghostty/config": "background = #000000\n"})
	w.env["XDG_CONFIG_HOME"] = "/x"
	if got := Resolve(w.inputs()); got != Dark {
		t.Fatalf("got %v", got)
	}
}

func TestGhosttyALightDarkThemePairIsUnknown(t *testing.T) {
	w := ghosttyWorld(map[string]string{
		"/h/.config/ghostty/config":       "theme = light:Day,dark:Night\n",
		"/h/.config/ghostty/themes/Day":   "background = #ffffff\n",
		"/h/.config/ghostty/themes/Night": "background = #000000\n",
	})
	if got := Resolve(w.inputs()); got != Unknown {
		t.Fatalf("got %v", got)
	}
}

func TestGhosttyMissingFilesAreUnknown(t *testing.T) {
	if got := Resolve(ghosttyWorld(nil).inputs()); got != Unknown {
		t.Fatalf("no config: got %v", got)
	}
	w := ghosttyWorld(map[string]string{"/h/.config/ghostty/config": "theme = gone\n"})
	if got := Resolve(w.inputs()); got != Unknown {
		t.Fatalf("missing theme file: got %v", got)
	}
}

func TestGhosttyIsSkippedOutsideGhostty(t *testing.T) {
	w := ghosttyWorld(map[string]string{"/h/.config/ghostty/config": "background = #000000\n"})
	delete(w.env, "GHOSTTY_RESOURCES_DIR")
	if got := Resolve(w.inputs()); got != Unknown {
		t.Fatalf("got %v", got)
	}
	w.env["TERM_PROGRAM"] = "ghostty"
	if got := Resolve(w.inputs()); got != Dark {
		t.Fatalf("TERM_PROGRAM=ghostty: got %v", got)
	}
}

func TestColorfgbgOutranksGhostty(t *testing.T) {
	w := ghosttyWorld(map[string]string{"/h/.config/ghostty/config": "background = #000000\n"})
	w.env["COLORFGBG"] = "0;15"
	if got := Resolve(w.inputs()); got != Light {
		t.Fatalf("got %v", got)
	}
}

func TestOfSplitsAtEqualContrastWithWhiteAndBlack(t *testing.T) {
	for hex, want := range map[string]Background{
		"#000000": Dark, "#161224": Dark, "#1a1b26": Dark, "#757575": Dark,
		"#777777": Light, "#fdf6e3": Light, "#ffffff": Light,
	} {
		c, ok := parseHex(hex)
		if !ok {
			t.Fatalf("%s did not parse", hex)
		}
		if got := Of(c); got != want {
			t.Errorf("%s: got %v want %v", hex, got, want)
		}
	}
}

func TestParseReply(t *testing.T) {
	for name, c := range map[string]struct {
		in   string
		want Background
		done bool
		ok   bool
	}{
		"dark ST, 4 digits":   {"\x1b]11;rgb:1a1a/1b1b/2626\x1b\\\x1b[?62;22c", Dark, true, true},
		"light BEL, 4 digits": {"\x1b]11;rgb:fafa/fafa/fafa\x07\x1b[?1;2c", Light, true, true},
		"light 2 digits":      {"\x1b]11;rgb:ff/ff/ff\x1b\\\x1b[?6c", Light, true, true},
		"dark 1 digit":        {"\x1b]11;rgb:1/1/2\x07\x1b[?6c", Dark, true, true},
		"DA1 alone":           {"\x1b[?62;22c", Unknown, true, false},
		"garbled":             {"\x1b]11;rgb:zz/qq\x07\x1b[?62c", Unknown, true, false},
		"too many digits":     {"\x1b]11;rgb:fffff/0/0\x07\x1b[?62c", Unknown, true, false},
		"half a reply":        {"\x1b]11;rgb:1a1a/1b", Unknown, false, false},
		"OSC without DA1":     {"\x1b]11;rgb:ffff/ffff/ffff\x07", Light, false, true},
		"nothing":             {"", Unknown, false, false},
	} {
		col, ok, done := parseReply([]byte(c.in))
		if done != c.done || ok != c.ok {
			t.Errorf("%s: ok %v done %v, want ok %v done %v", name, ok, done, c.ok, c.done)
			continue
		}
		if ok && Of(col) != c.want {
			t.Errorf("%s: %v, want %v", name, Of(col), c.want)
		}
	}
}

type fakeTTY struct {
	rawErr        error
	writeErr      error
	short         bool
	pendingBefore int
	pendingRaw    int
	input         string
	arrivals      []string
	readErr       error
	wrote         string
	raw           bool
	restored      int
	clock         time.Time
	waits         []time.Duration
}

func (f *fakeTTY) Pending() (int, error) {
	if f.raw {
		return f.pendingRaw, nil
	}
	return f.pendingBefore, nil
}

func (f *fakeTTY) Raw() (func(), error) {
	if f.rawErr != nil {
		return nil, f.rawErr
	}
	f.raw = true
	return func() { f.raw = false; f.restored++ }, nil
}

func (f *fakeTTY) Write(p []byte) (int, error) {
	if f.writeErr != nil {
		return 0, f.writeErr
	}
	if f.short {
		p = p[:len(p)/2]
	}
	f.wrote += string(p)
	return len(p), nil
}

// ReadTimeout hands out what has arrived; each later arrival lands when the
// input runs dry, a millisecond on.
func (f *fakeTTY) ReadTimeout(p []byte, d time.Duration) (int, error) {
	f.waits = append(f.waits, d)
	if f.input == "" && len(f.arrivals) > 0 {
		f.input, f.arrivals = f.arrivals[0], f.arrivals[1:]
		f.clock = f.clock.Add(time.Millisecond)
	}
	if f.input == "" {
		if f.readErr != nil {
			return 0, f.readErr
		}
		f.clock = f.clock.Add(d)
		return 0, nil
	}
	n := copy(p, f.input)
	f.input = f.input[n:]
	return n, nil
}

func (f *fakeTTY) now() time.Time { return f.clock }

func TestQueryReadsTheColorAndRestoresTheTerminal(t *testing.T) {
	f := &fakeTTY{arrivals: []string{"\x1b]11;rgb:1a1a/", "1b1b/2626\x1b\\\x1b[?6", "2;22c"}}
	c, ok := query(f, queryCap, f.now)
	if !ok || Of(c) != Dark {
		t.Fatalf("got %v %v", c, ok)
	}
	if f.wrote != "\x1b]11;?\x1b\\\x1b[c" {
		t.Fatalf("wrote %q", f.wrote)
	}
	if f.raw || f.restored != 1 {
		t.Fatalf("raw %v restored %d", f.raw, f.restored)
	}
}

func TestQueryLeavesInputAfterTheRepliesUnread(t *testing.T) {
	f := &fakeTTY{arrivals: []string{"\x1b]11;rgb:ffff/ffff/ffff\x07\x1b[?62;22clater\n"}}
	if c, ok := query(f, queryCap, f.now); !ok || Of(c) != Light {
		t.Fatalf("got %v %v", c, ok)
	}
	if f.input != "later\n" {
		t.Fatalf("left %q unread, want the keys typed after the replies", f.input)
	}
}

func TestQueryStopsAtDA1(t *testing.T) {
	f := &fakeTTY{arrivals: []string{"\x1b[?62;22c", "\x1b]11;rgb:ffff/ffff/ffff\x07"}}
	if _, ok := query(f, queryCap, f.now); ok {
		t.Fatal("an OSC 11 reply after DA1 was taken")
	}
	if len(f.arrivals) != 1 || f.restored != 1 || f.raw {
		t.Fatalf("arrivals left %d restored %d raw %v", len(f.arrivals), f.restored, f.raw)
	}
}

func TestQueryGivesUpAtTheCap(t *testing.T) {
	f := &fakeTTY{}
	if _, ok := query(f, queryCap, f.now); ok {
		t.Fatal("silence gave a color")
	}
	var total time.Duration
	for _, d := range f.waits {
		total += d
	}
	if total != queryCap || f.restored != 1 || f.raw {
		t.Fatalf("waited %v restored %d raw %v", total, f.restored, f.raw)
	}
}

func TestQuerySkipsWhenInputIsPending(t *testing.T) {
	f := &fakeTTY{pendingBefore: 10}
	if _, ok := query(f, queryCap, f.now); ok || f.wrote != "" || f.restored != 0 || f.raw {
		t.Fatalf("a whole typed line: wrote %q restored %d raw %v", f.wrote, f.restored, f.raw)
	}
	f = &fakeTTY{pendingRaw: 4}
	if _, ok := query(f, queryCap, f.now); ok || f.wrote != "" || f.restored != 1 || f.raw {
		t.Fatalf("a partial line: wrote %q restored %d raw %v", f.wrote, f.restored, f.raw)
	}
}

func TestQueryRestoresOnEveryFailure(t *testing.T) {
	boom := errors.New("boom")
	for name, f := range map[string]*fakeTTY{
		"write":         {writeErr: boom},
		"partial write": {short: true},
		"read":          {readErr: boom},
		"hangup":        {readErr: io.EOF},
		"garbled":       {arrivals: []string{"\x1b]11;nonsense\x07\x1b[?6c"}},
	} {
		if _, ok := query(f, queryCap, f.now); ok {
			t.Errorf("%s: gave a color", name)
		}
		if f.raw || f.restored != 1 {
			t.Errorf("%s: raw %v restored %d", name, f.raw, f.restored)
		}
		if f.readErr != nil && len(f.waits) != 1 {
			t.Errorf("%s: kept reading after the error: %d waits", name, len(f.waits))
		}
	}
	f := &fakeTTY{rawErr: boom}
	if _, ok := query(f, queryCap, f.now); ok || f.wrote != "" {
		t.Fatalf("raw mode failed but the query went out: %q", f.wrote)
	}
}
