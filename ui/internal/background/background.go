// Package background decides whether the terminal behind static output is
// dark or light, so render and the steps verb pick the same accent set.
package background

import (
	"bytes"
	"image/color"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Background int

const (
	Unknown Background = iota
	Dark
	Light
)

func (b Background) String() string {
	switch b {
	case Dark:
		return "dark"
	case Light:
		return "light"
	}
	return "unknown"
}

// Inputs are everything Resolve reads. A nil Query never asks the terminal.
type Inputs struct {
	Getenv   func(string) string
	ReadFile func(string) ([]byte, error)
	Query    func() (color.Color, bool)
	MacOS    bool
}

// Resolve walks the chain: the setting rt hands over, the terminal's own
// answer, COLORFGBG, then Ghostty's configured background.
func Resolve(in Inputs) Background {
	switch in.Getenv("RT_UI_BACKGROUND") {
	case "dark":
		return Dark
	case "light":
		return Light
	case "auto":
		// rt sets the variable on every spawn and spawns the helper only for
		// a person at a terminal. Unset means a test or a script started it,
		// and that terminal belongs to someone who did not ask to be queried.
		if in.Query != nil {
			if c, ok := in.Query(); ok {
				return Of(c)
			}
		}
	}
	if b := FromColorfgbg(in.Getenv("COLORFGBG")); b != Unknown {
		return b
	}
	return ghostty(in)
}

var (
	detectOnce sync.Once
	detected   Background
)

// Detect resolves this process's background once, against the real
// environment, files and terminal.
func Detect() Background {
	detectOnce.Do(func() {
		detected = Resolve(Inputs{
			Getenv:   os.Getenv,
			ReadFile: os.ReadFile,
			Query:    QueryTerminal,
			MacOS:    runtime.GOOS == "darwin",
		})
	})
	return detected
}

// FromColorfgbg reads a COLORFGBG value ("fg;bg" or "fg;default;bg"): the
// colors 0 to 6 and 8 are dark, 7 and 9 to 15 light.
func FromColorfgbg(v string) Background {
	parts := strings.Split(v, ";")
	n, err := strconv.Atoi(strings.TrimSpace(parts[len(parts)-1]))
	switch {
	case err != nil || n < 0 || n > 15:
		return Unknown
	case n == 7 || n > 8:
		return Light
	}
	return Dark
}

// Of calls a color dark when white text would contrast with it more than
// black text, which is relative luminance under about 0.179.
func Of(c color.Color) Background {
	l := luminance(c)
	if (1.05)/(l+0.05) > (l+0.05)/0.05 {
		return Dark
	}
	return Light
}

func luminance(c color.Color) float64 {
	r, g, b, _ := c.RGBA()
	lin := func(v uint32) float64 {
		f := float64(v) / 65535
		if f <= 0.04045 {
			return f / 12.92
		}
		return math.Pow((f+0.055)/1.055, 2.4)
	}
	return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b)
}

func parseHex(s string) (color.Color, bool) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "#")
	if len(s) != 6 {
		return nil, false
	}
	v, err := strconv.ParseUint(s, 16, 32)
	if err != nil {
		return nil, false
	}
	return color.RGBA{uint8(v >> 16), uint8(v >> 8), uint8(v), 0xff}, true
}

func ghostty(in Inputs) Background {
	resources := in.Getenv("GHOSTTY_RESOURCES_DIR")
	if resources == "" && in.Getenv("TERM_PROGRAM") != "ghostty" {
		return Unknown
	}
	home := in.Getenv("HOME")
	xdg := in.Getenv("XDG_CONFIG_HOME")
	if xdg == "" {
		if home == "" {
			return Unknown
		}
		xdg = filepath.Join(home, ".config")
	}
	// Ghostty's documented load order; a later file overrides an earlier one.
	files := []string{filepath.Join(xdg, "ghostty", "config.ghostty"), filepath.Join(xdg, "ghostty", "config")}
	if in.MacOS && home != "" {
		mac := filepath.Join(home, "Library", "Application Support", "com.mitchellh.ghostty")
		files = append(files, filepath.Join(mac, "config.ghostty"), filepath.Join(mac, "config"))
	}
	var bg, theme string
	for _, f := range files {
		data, err := in.ReadFile(f)
		if err != nil {
			continue
		}
		if v, ok := configValue(data, "background"); ok {
			bg = v
		}
		if v, ok := configValue(data, "theme"); ok {
			theme = v
		}
	}
	if bg != "" {
		return ofHex(bg)
	}
	// A light:X,dark:Y pair follows the OS appearance, which a piped helper
	// cannot read.
	if theme == "" || strings.Contains(theme, ",") || strings.HasPrefix(theme, "light:") || strings.HasPrefix(theme, "dark:") {
		return Unknown
	}
	var themes []string
	switch {
	case filepath.IsAbs(theme):
		themes = []string{theme}
	case strings.ContainsRune(theme, filepath.Separator):
		return Unknown
	default:
		themes = []string{filepath.Join(xdg, "ghostty", "themes", theme)}
		if resources != "" {
			themes = append(themes, filepath.Join(resources, "themes", theme))
		}
	}
	for _, f := range themes {
		data, err := in.ReadFile(f)
		if err != nil {
			continue
		}
		v, _ := configValue(data, "background")
		return ofHex(v)
	}
	return Unknown
}

func ofHex(s string) Background {
	if c, ok := parseHex(s); ok {
		return Of(c)
	}
	return Unknown
}

// configValue returns the last value given for key in a Ghostty config.
func configValue(data []byte, key string) (string, bool) {
	var val string
	found := false
	for _, line := range bytes.Split(data, []byte("\n")) {
		k, v, ok := strings.Cut(strings.TrimSpace(string(line)), "=")
		if !ok || strings.TrimSpace(k) != key {
			continue
		}
		val, found = strings.Trim(strings.TrimSpace(v), `"`), true
	}
	return val, found
}

// TTY is the terminal the query runs on.
type TTY interface {
	// Raw turns off echo and line buffering; the restore it returns also
	// discards any input still pending.
	Raw() (restore func(), err error)
	Write(p []byte) (int, error)
	// ReadTimeout waits at most d for input; (0, nil) means it timed out.
	ReadTimeout(p []byte, d time.Duration) (int, error)
}

// queryCap only matters for a terminal that answers neither query: every
// terminal answers DA1, and the reply to it is what ends the wait.
const queryCap = 150 * time.Millisecond

const queryBytes = "\x1b]11;?\x1b\\\x1b[c"

func query(t TTY, limit time.Duration, now func() time.Time) (color.Color, bool) {
	restore, err := t.Raw()
	if err != nil {
		return nil, false
	}
	defer restore()
	if _, err := t.Write([]byte(queryBytes)); err != nil {
		return nil, false
	}
	deadline := now().Add(limit)
	var got []byte
	buf := make([]byte, 256)
	for {
		left := deadline.Sub(now())
		if left <= 0 {
			c, ok, _ := parseReply(got)
			return c, ok
		}
		n, err := t.ReadTimeout(buf, left)
		got = append(got, buf[:n]...)
		if c, ok, done := parseReply(got); done {
			return c, ok
		}
		if err != nil {
			return nil, false
		}
	}
}

// parseReply reads an OSC 11 reply that comes before the DA1 reply. done
// says the DA1 reply has arrived, so nothing more is coming.
func parseReply(b []byte) (c color.Color, ok, done bool) {
	da1 := bytes.Index(b, []byte("\x1b[?"))
	head := b
	if da1 >= 0 {
		end := bytes.IndexByte(b[da1:], 'c')
		if end < 0 {
			da1 = -1
		} else {
			done = true
			head = b[:da1]
		}
	}
	const prefix = "\x1b]11;rgb:"
	i := bytes.Index(head, []byte(prefix))
	if i < 0 {
		return nil, false, done
	}
	body := head[i+len(prefix):]
	end := bytes.IndexAny(body, "\x07\x1b")
	if end < 0 {
		return nil, false, done
	}
	parts := strings.Split(string(body[:end]), "/")
	if len(parts) != 3 {
		return nil, false, done
	}
	var rgb [3]uint8
	for k, p := range parts {
		if len(p) < 1 || len(p) > 4 {
			return nil, false, done
		}
		v, err := strconv.ParseUint(p, 16, 16)
		if err != nil {
			return nil, false, done
		}
		rgb[k] = uint8(math.Round(float64(v) / float64(uint64(1)<<(4*len(p))-1) * 255))
	}
	return color.RGBA{rgb[0], rgb[1], rgb[2], 0xff}, true, done
}
