package render_test

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"rt-ui/internal/protocol"
	"rt-ui/internal/render"
)

const coral = "255;121;121"

func styled(bs ...protocol.Block) string {
	return render.Render(bs, render.Options{Width: 80})
}

func plain(bs ...protocol.Block) string {
	return ansi.Strip(styled(bs...))
}

func cmd(s string) protocol.Cell  { return protocol.Cell{{Text: s, Role: "command"}} }
func text(s string) protocol.Cell { return protocol.Cell{{Text: s}} }

func TestConsecutiveLinesAlignTheirHints(t *testing.T) {
	got := plain(
		protocol.Block{T: "line", Status: "done", Title: "pre-commit", Hint: "on"},
		protocol.Block{T: "line", Status: "off", Title: "pre-push", Hint: "off, you turned it off"},
	)
	want := "  ✓ pre-commit  on\n  ○ pre-push    off, you turned it off\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestLineWithoutHintIsNotPadded(t *testing.T) {
	got := plain(
		protocol.Block{T: "line", Status: "done", Title: "short"},
		protocol.Block{T: "line", Status: "done", Title: "a much longer title", Hint: "h"},
	)
	want := "  ✓ short\n  ✓ a much longer title  h\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestCalloutAttachesUnderALineAndKeepsTheRunAligned(t *testing.T) {
	got := plain(
		protocol.Block{T: "line", Status: "needs-you", Title: "Slack", Hint: "not connected"},
		protocol.Block{T: "callout", Label: "next", Body: []protocol.Cell{cmd("rt setup slack connect")}},
		protocol.Block{T: "line", Status: "pending", Title: "Linear", Hint: "not connected yet"},
	)
	want := "  ◆ Slack   not connected\n    ▌ next rt setup slack connect\n  ◌ Linear  not connected yet\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestCalloutContinuationLinesIndentPastTheLabel(t *testing.T) {
	got := plain(protocol.Block{T: "callout", Label: "tip", Body: []protocol.Cell{text("Saved on this Mac only."), text("second line")}})
	want := "    ▌ tip Saved on this Mac only.\n    ▌     second line\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestKvPrintsSourceOnItsOwnLineIndentedUnderTheKey(t *testing.T) {
	got := plain(protocol.Block{T: "kv", Key: "rt.worktreeApp", Value: "true", Source: "from team example"})
	want := "  rt.worktreeApp  true\n    from team example\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestKvWithoutAValuePrintsOnlyTheKey(t *testing.T) {
	if got := plain(protocol.Block{T: "kv", Key: "rt.notifications"}); got != "  rt.notifications\n" {
		t.Fatalf("got %q", got)
	}
}

func TestSummaryGetsABlankLineBeforeItUnlessFirst(t *testing.T) {
	sum := protocol.Block{T: "summary", Status: "needs-you", Title: "Setup needs you", Counts: []string{"5 ready", "1 needs you"}}
	if got := plain(sum); got != "  ◆ Setup needs you  5 ready · 1 needs you\n" {
		t.Fatalf("first: %q", got)
	}
	got := plain(protocol.Block{T: "line", Status: "done", Title: "a"}, sum)
	want := "  ✓ a\n\n  ◆ Setup needs you  5 ready · 1 needs you\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestBanner(t *testing.T) {
	got := plain(protocol.Block{T: "banner", Label: "PRODUCTION", Subject: "db-replica", Hint: "type the name to confirm"})
	if got != "  ▌ PRODUCTION db-replica  type the name to confirm\n" {
		t.Fatalf("got %q", got)
	}
}

func TestFailureShowsWhyNextAndDetails(t *testing.T) {
	got := plain(protocol.Block{
		T: "failure", Title: "This Mac cannot read the team's secrets yet",
		Why: "No key on this machine matches.", Next: cmd("rt setup status"), Details: "details are in the log",
	})
	want := "  ✗ This Mac cannot read the team's secrets yet\n" +
		"    ▌ why No key on this machine matches.\n" +
		"    ▌ next rt setup status\n" +
		"\n" +
		"  details are in the log\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestOnlyFailedUsesCoral(t *testing.T) {
	if !strings.Contains(styled(protocol.Block{T: "line", Status: "failed", Title: "x"}), coral) {
		t.Fatal("failed line is not coral")
	}
	for _, s := range []string{"done", "needs-you", "pending", "stale", "refused", "off", "skipped", "running", "warn"} {
		if strings.Contains(styled(protocol.Block{T: "line", Status: s, Title: "x", Hint: "h"}), coral) {
			t.Fatalf("status %q rendered coral", s)
		}
	}
	for _, label := range []string{"tip", "next", "fix", "why", "note"} {
		if strings.Contains(styled(protocol.Block{T: "callout", Label: label, Body: []protocol.Cell{text("x")}}), coral) {
			t.Fatalf("callout %q rendered coral", label)
		}
	}
}

func TestUnknownStatusFallsBackToADot(t *testing.T) {
	if got := plain(protocol.Block{T: "line", Status: "mystery", Title: "x"}); got != "  • x\n" {
		t.Fatalf("got %q", got)
	}
}

func TestTextIsCleanedOfEscapesAndControls(t *testing.T) {
	out := styled(protocol.Block{T: "line", Status: "done", Title: "evil\x1b[2Jname\x07\u009b", Hint: "a\tb"})
	if strings.Contains(out, "\x1b[2J") || strings.Contains(out, "\x07") {
		t.Fatalf("control sequence survived: %q", out)
	}
	if got := ansi.Strip(out); got != "  ✓ evilname  a b\n" {
		t.Fatalf("got %q", got)
	}
}

func TestNewlinesInASingleLineFieldBecomeSpaces(t *testing.T) {
	if got := plain(protocol.Block{T: "line", Status: "done", Title: "a\nb\rc", Hint: "d\ne"}); got != "  ✓ a b c  d e\n" {
		t.Fatalf("got %q", got)
	}
}

func TestFailureDetailsKeepTheirLines(t *testing.T) {
	got := plain(protocol.Block{T: "failure", Title: "x", Details: "one\ntwo\r\nthree"})
	want := "  ✗ x\n\n  one\n  two\n  three\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestLinkSegmentEmitsAHyperlinkAndCleansItsURL(t *testing.T) {
	out := styled(protocol.Block{T: "callout", Label: "note", Body: []protocol.Cell{{{Text: "docs", Role: "link", URL: "https://example.com/\x1b[2Jdocs"}}}})
	if !strings.Contains(out, "\x1b]8;;https://example.com/docs") {
		t.Fatalf("no OSC 8 link: %q", out)
	}
	if strings.Contains(out, "\x1b[2J") {
		t.Fatalf("escape survived in the URL: %q", out)
	}
}

func TestBodyTextUsesTheTerminalDefaultForeground(t *testing.T) {
	if got := styled(protocol.Block{T: "paragraph", Text: "plain words"}); strings.Contains(got, "\x1b[38") {
		t.Fatalf("a paragraph set a foreground color: %q", got)
	}
	out := styled(
		protocol.Block{T: "line", Status: "done", Title: "Skills linked"},
		protocol.Block{T: "kv", Key: "k", Value: "v"},
		protocol.Block{T: "callout", Label: "next", Body: []protocol.Cell{cmd("rt setup status")}},
	)
	for _, fixed := range []string{"230;224;255", "210;205;235"} {
		if strings.Contains(out, fixed) {
			t.Fatalf("body text painted with a fixed light color %s: %q", fixed, out)
		}
	}
}

func TestNoLeadingOrTrailingBlankLines(t *testing.T) {
	out := plain(protocol.Block{T: "line", Status: "done", Title: "x"})
	if strings.HasPrefix(out, "\n") || strings.HasSuffix(out, "\n\n") {
		t.Fatalf("stray blank line: %q", out)
	}
	if styled() != "" {
		t.Fatalf("no blocks should render nothing")
	}
}

func plainAt(w int, bs ...protocol.Block) string {
	return ansi.Strip(render.Render(bs, render.Options{Width: w}))
}

func rows(s string) []string {
	return strings.Split(strings.TrimSuffix(s, "\n"), "\n")
}

func noSpace(s string) string { return strings.ReplaceAll(s, " ", "") }

func checkWidth(t *testing.T, out string, w int) {
	t.Helper()
	for _, r := range rows(out) {
		if n := ansi.StringWidth(r); n > w {
			t.Fatalf("row is %d cells, wider than %d: %q\n%s", n, w, r, out)
		}
	}
}

func TestLongFailureTitleWrapsUnderItsText(t *testing.T) {
	title := "reidentify takes two identities, got 1; usage: rt repos reidentify <old-identity> <new-identity> [--dry-run] [--json]"
	out := plainAt(40, protocol.Block{T: "failure", Title: title})
	checkWidth(t, out, 40)
	rs := rows(out)
	if len(rs) < 3 || !strings.HasPrefix(rs[0], "  ✗ ") {
		t.Fatalf("title did not wrap:\n%s", out)
	}
	words := []string{strings.TrimPrefix(rs[0], "  ✗ ")}
	for _, r := range rs[1:] {
		if !strings.HasPrefix(r, "    ") || r[4] == ' ' {
			t.Fatalf("continuation row is not under the title text: %q", r)
		}
		words = append(words, r[4:])
	}
	if noSpace(strings.Join(words, "")) != noSpace(title) {
		t.Fatalf("wrapped title lost text: %q", words)
	}
}

func TestFailureHintDropsBelowWhenItDoesNotFit(t *testing.T) {
	b := protocol.Block{T: "failure", Title: "rt hit an unexpected error", Hint: "kaboom from the seam test"}
	if got, want := plainAt(80, b), "  ✗ rt hit an unexpected error  kaboom from the seam test\n"; got != want {
		t.Fatalf("a hint that fits left the title row:\ngot  %q\nwant %q", got, want)
	}
	if got, want := plainAt(40, b), "  ✗ rt hit an unexpected error\n    kaboom from the seam test\n"; got != want {
		t.Fatalf("got  %q\nwant %q", got, want)
	}
	long := protocol.Block{T: "failure", Title: strings.Repeat("title ", 10), Hint: "short"}
	rs := rows(plainAt(40, long))
	if last := rs[len(rs)-1]; last != "    short" {
		t.Fatalf("a hint under a wrapped title should sit on its own row, got %q", last)
	}
}

const teamSecretsWhy = "No age key on this Mac matches the team's recipients. The team owner adds your key, then you pull the team again."

func TestCalloutBodyWrapsAndKeepsTheBarOnEveryRow(t *testing.T) {
	for _, w := range []int{100, 60} {
		out := plainAt(w, protocol.Block{
			T: "failure", Title: "This Mac cannot read the team's secrets yet",
			Why: teamSecretsWhy, Next: cmd("rt team pull"),
		})
		checkWidth(t, out, w)
		rs := rows(out)
		body := min(w-10, 76)
		var why []string
		for _, r := range rs[1 : len(rs)-1] {
			switch {
			case strings.HasPrefix(r, "    ▌ why "):
				why = append(why, strings.TrimPrefix(r, "    ▌ why "))
			case strings.HasPrefix(r, "    ▌     ") && !strings.HasPrefix(r, "    ▌      "):
				why = append(why, strings.TrimPrefix(r, "    ▌     "))
			default:
				t.Fatalf("width %d: a why row lost its bar or indent: %q\n%s", w, r, out)
			}
			if n := ansi.StringWidth(why[len(why)-1]); n > body {
				t.Fatalf("width %d: why row is %d cells, over %d", w, n, body)
			}
		}
		if len(why) < 2 || strings.Join(why, " ") != teamSecretsWhy {
			t.Fatalf("width %d: why did not wrap whole:\n%s", w, out)
		}
		if rs[len(rs)-1] != "    ▌ next rt team pull" {
			t.Fatalf("width %d: next row %q", w, rs[len(rs)-1])
		}
	}
}

func TestCalloutKeepsASegmentStyleAcrossTheBreak(t *testing.T) {
	body := protocol.Cell{{Text: "Click + under Full Disk Access and "}, {Text: "add the app at its install path", Role: "strong"}}
	out := render.Render([]protocol.Block{{T: "callout", Label: "note", Body: []protocol.Cell{body}}}, render.Options{Width: 40})
	checkWidth(t, ansi.Strip(out), 40)
	rs := rows(out)
	last := rs[len(rs)-1]
	if len(rs) < 2 || !strings.Contains(ansi.Strip(last), "path") || !strings.Contains(last, "\x1b[1m") {
		t.Fatalf("the strong run lost its style on the next row:\n%q", out)
	}
}

func TestACommandIsNeverWrapped(t *testing.T) {
	long := "rt repos reidentify gitlab.example.com/acme/widgets gitlab.example.com/acme/gadgets"
	out := plainAt(40, protocol.Block{T: "failure", Title: "x", Next: cmd(long)})
	if !strings.Contains(out, "    ▌ next "+long+"\n") {
		t.Fatalf("the command was wrapped:\n%s", out)
	}
}

func TestFailureDetailsWrap(t *testing.T) {
	details := strings.TrimSpace(strings.Repeat("details ", 12))
	out := plainAt(40, protocol.Block{T: "failure", Title: "x", Details: details})
	checkWidth(t, out, 40)
	rs := rows(out)
	if len(rs) < 4 || rs[1] != "" {
		t.Fatalf("details did not wrap under a gap:\n%s", out)
	}
	var got []string
	for _, r := range rs[2:] {
		if !strings.HasPrefix(r, "  ") || r[2] == ' ' {
			t.Fatalf("a details row lost its indent: %q", r)
		}
		got = append(got, r[2:])
	}
	if strings.Join(got, " ") != details {
		t.Fatalf("details lost text: %q", strings.Join(got, " "))
	}
}

func TestWrappedTextNeverBreaksAFlagAtItsHyphens(t *testing.T) {
	got := plainAt(40, protocol.Block{T: "callout", Label: "note", Body: []protocol.Cell{text("Pushing again needs --force-with-lease so nothing is lost")}})
	want := "    ▌ note Pushing again needs\n" +
		"    ▌      --force-with-lease so nothing\n" +
		"    ▌      is lost\n"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}

func TestLineHintWrapsInsideItsOwnColumn(t *testing.T) {
	got := plainAt(40,
		protocol.Block{T: "line", Status: "done", Title: "pre-commit", Hint: "on"},
		protocol.Block{T: "line", Status: "off", Title: "pre-push", Hint: "you turned this one off last week and it stays off"},
	)
	want := "  ✓ pre-commit  on\n" +
		"  ○ pre-push    you turned this one off\n" +
		"                last week and it stays\n" +
		"                off\n"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	checkWidth(t, got, 40)
}

func TestATitleTooWideForAHintColumnTakesItsHintBelow(t *testing.T) {
	got := plainAt(40,
		protocol.Block{T: "line", Status: "done", Title: "short", Hint: "h"},
		protocol.Block{T: "line", Status: "warn", Title: "a title that is far too long to leave a hint column", Hint: "the hint goes below"},
		protocol.Block{T: "line", Status: "done", Title: "a title of exactly some width", Hint: "x"},
		protocol.Block{T: "line", Status: "done", Title: "a hintless title that is far too long to fit on one row of the pane"},
	)
	want := "  ✓ short  h\n" +
		"  ! a title that is far too long to\n" +
		"    leave a hint column\n" +
		"    the hint goes below\n" +
		"  ✓ a title of exactly some width  x\n" +
		"  ✓ a hintless title that is far too\n" +
		"    long to fit on one row of the pane\n"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	checkWidth(t, got, 40)
}

func TestAWrappedHintKeepsItsFaintToneOnEveryRow(t *testing.T) {
	out := render.Render([]protocol.Block{{T: "line", Status: "off", Title: "pre-push", Hint: "you turned this one off last week and it stays off"}}, render.Options{Width: 40})
	const faint = "38;2;127;120;160"
	for i, row := range rows(out) {
		if !strings.Contains(row, faint) {
			t.Fatalf("row %d lost the hint tone: %q", i, row)
		}
	}
}

func TestAVeryNarrowPaneLosesNoText(t *testing.T) {
	for _, w := range []int{20, 24, 30} {
		got := plainAt(w,
			protocol.Block{T: "line", Status: "done", Title: "pre-commit", Hint: "turned on for this repo"},
			protocol.Block{T: "line", Status: "off", Title: "pre-push"},
		)
		for _, want := range []string{"pre-commit", "turned", "on", "for", "this", "repo", "pre-push"} {
			if !strings.Contains(got, want) {
				t.Fatalf("width %d lost %q:\n%s", w, want, got)
			}
		}
		// At 20 the text column (16) is under minWrap: rows are emitted whole
		// and the terminal wraps them.
		if w >= 24 {
			checkWidth(t, got, w)
		}
	}
}
