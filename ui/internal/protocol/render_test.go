package protocol

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestRenderFixtureDecodesAndReencodes(t *testing.T) {
	var raws []json.RawMessage
	if err := json.Unmarshal(fixture(t, "render-document.json"), &raws); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, raw := range raws {
		b, err := DecodeBlock(raw)
		if err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
		seen[b.T] = true
		back, err := json.Marshal(b)
		if err != nil {
			t.Fatal(err)
		}
		if canonical(t, back) != canonical(t, raw) {
			t.Fatalf("re-encode drift\n got %s\nwant %s", back, raw)
		}
	}
	for _, name := range []string{"line", "callout", "kv", "table", "tree", "section", "summary", "paragraph", "copy", "verbatim", "changes", "diff", "banner", "failure"} {
		if !seen[name] {
			t.Fatalf("fixture has no %q block", name)
		}
	}
}

func TestDecodeBlockRejectsUnknownTypesAtAnyDepth(t *testing.T) {
	for _, line := range []string{
		`{"t":"sparkline"}`,
		`{"t":"section","title":"x","blocks":[{"t":"sparkline"}]}`,
		`not json`,
	} {
		if _, err := DecodeBlock([]byte(line)); !errors.Is(err, ErrBadSpec) {
			t.Fatalf("%s: err %v, want ErrBadSpec", line, err)
		}
	}
}
