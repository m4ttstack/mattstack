package render_test

import (
	"bytes"
	"errors"
	"os/exec"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

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

func TestRenderVerbFitsAFailureToANarrowPane(t *testing.T) {
	stdin := helloLine + `{"t":"failure","title":"reidentify takes two identities, got 1; usage: rt repos reidentify <old> <new>","hint":"from the seam test","why":"No age key on this Mac matches the team's recipients. The team owner adds your key, then you pull the team again.","next":[{"text":"Open Privacy & Security, then Full Disk Access, yourself"}],"details":"details are in the log at a path that is longer than the pane"}` + "\n" +
		`{"t":"verbatim","lines":["    at run (/Users/sample/.mattstack/user/plugins/seam-fixture/boom.ts:1:41)"]}` + "\n"
	out, _, exit := runVerb(t, []string{"--no-color", "--width", "40"}, nil, stdin)
	if exit != 0 {
		t.Fatalf("exit %d", exit)
	}
	for _, l := range strings.Split(strings.TrimSuffix(out, "\n"), "\n") {
		if n := ansi.StringWidth(l); n > 40 {
			t.Fatalf("line is %d cells: %q\n%s", n, l, out)
		}
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

func TestRenderVerbTakesALightBackgroundFromColorfgbg(t *testing.T) {
	stdin := helloLine + `{"t":"diff","hunks":[{"header":"@@ -1 +1 @@","lines":[{"kind":"add","text":"next();"}]}]}` + "\n"
	env := []string{"COLORTERM=truecolor", "TERM=xterm-256color"}
	out, _, exit := runVerb(t, nil, append([]string{"COLORFGBG=0;15"}, env...), stdin)
	if exit != 0 || !strings.Contains(out, "48;2;229;251;241") {
		t.Fatalf("exit %d, no light tint in %q", exit, out)
	}
	out, _, _ = runVerb(t, nil, env, stdin)
	if !strings.Contains(out, "48;2;34;51;57") {
		t.Fatalf("a terminal that says nothing should keep the dark tint: %q", out)
	}
}
