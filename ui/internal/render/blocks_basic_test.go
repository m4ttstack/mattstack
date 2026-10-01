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

func TestKvPrintsSourceOnItsOwnLine(t *testing.T) {
	got := plain(protocol.Block{T: "kv", Key: "rt.worktreeApp", Value: "true", Source: "from team example"})
	want := "  rt.worktreeApp  true\n  from team example\n"
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
