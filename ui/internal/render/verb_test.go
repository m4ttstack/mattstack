package render_test

import (
	"bytes"
	"errors"
	"os/exec"
	"strings"
	"testing"

	"rt-ui/internal/testutil"
)

const helloLine = `{"t":"hello","protocol":1}` + "\n"

func runVerb(t *testing.T, args []string, env []string, stdin string) (stdout, stderr string, exit int) {
	t.Helper()
	cmd := exec.Command(testutil.Binary(t), append([]string{"render"}, args...)...)
	cmd.Env = append([]string{"PATH=/usr/bin:/bin"}, env...)
	cmd.Stdin = strings.NewReader(stdin)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	err := cmd.Run()
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		exit = ee.ExitCode()
	} else if err != nil {
		t.Fatal(err)
	}
	return out.String(), errb.String(), exit
}

func TestRenderVerbPrintsBlocksPlainWithNoColor(t *testing.T) {
	stdin := helloLine + `{"t":"line","status":"done","title":"Skills linked","hint":"16 skills"}` + "\n"
	out, _, exit := runVerb(t, []string{"--no-color"}, nil, stdin)
	if exit != 0 || out != "  ✓ Skills linked  16 skills\n" {
		t.Fatalf("exit %d out %q", exit, out)
	}
}

func TestRenderVerbColorsFromTheEnvironmentEvenWhenPiped(t *testing.T) {
	stdin := helloLine + `{"t":"line","status":"failed","title":"x"}` + "\n"
	out, _, exit := runVerb(t, nil, []string{"COLORTERM=truecolor", "TERM=xterm-256color"}, stdin)
	if exit != 0 || !strings.Contains(out, "\x1b[") {
		t.Fatalf("exit %d, no color in %q", exit, out)
	}
}

func TestRenderVerbHonorsNoColorEnv(t *testing.T) {
	stdin := helloLine + `{"t":"line","status":"failed","title":"x"}` + "\n"
	out, _, _ := runVerb(t, nil, []string{"COLORTERM=truecolor", "TERM=xterm-256color", "NO_COLOR=1"}, stdin)
	if strings.Contains(out, "\x1b[38") {
		t.Fatalf("NO_COLOR ignored: %q", out)
	}
}

func TestRenderVerbPassesWidthToParagraphs(t *testing.T) {
	stdin := helloLine + `{"t":"paragraph","text":"one two three four five six seven eight nine ten"}` + "\n"
	out, _, _ := runVerb(t, []string{"--no-color", "--width", "30"}, nil, stdin)
	if out != "  one two three four five\n  six seven eight nine ten\n" {
		t.Fatalf("out %q", out)
	}
}

func TestHelloOnlyPrintsNothing(t *testing.T) {
	out, _, exit := runVerb(t, []string{"--no-color"}, nil, helloLine)
	if exit != 0 || out != "" {
		t.Fatalf("exit %d out %q", exit, out)
	}
}

func TestBadHelloExitsTwo(t *testing.T) {
	for _, stdin := range []string{"", `{"t":"hello","protocol":7}` + "\n", `{"t":"line","status":"done","title":"x"}` + "\n"} {
		out, _, exit := runVerb(t, []string{"--no-color"}, nil, stdin)
		if exit != 2 || out != "" {
			t.Fatalf("stdin %q: exit %d out %q", stdin, exit, out)
		}
	}
}

func TestUnknownBlockExitsTwoWithNoOutput(t *testing.T) {
	stdin := helloLine + `{"t":"line","status":"done","title":"first"}` + "\n" + `{"t":"sparkline"}` + "\n"
	out, stderr, exit := runVerb(t, []string{"--no-color"}, nil, stdin)
	if exit != 2 || out != "" {
		t.Fatalf("exit %d out %q", exit, out)
	}
	if !strings.Contains(stderr, "sparkline") {
		t.Fatalf("stderr does not name the block: %q", stderr)
	}
}

func TestLastBlockWithoutATrailingNewlineStillRenders(t *testing.T) {
	stdin := helloLine + `{"t":"line","status":"done","title":"x"}`
	out, _, exit := runVerb(t, []string{"--no-color"}, nil, stdin)
	if exit != 0 || out != "  ✓ x\n" {
		t.Fatalf("exit %d out %q", exit, out)
	}
}
