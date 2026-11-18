package termimage

import (
	"encoding/base64"
	"image"
	"os"
	"strings"
	"testing"
)

func TestKittyPlaceholderEncodesIDRowAndColumn(t *testing.T) {
	got := KittyPlaceholder(0x0A0B0C, 2, 2)
	want := []string{
		"\x1b[38;2;10;11;12m" + "\U0010EEEE̅̅" + "\U0010EEEE̅̍" + "\x1b[39m",
		"\x1b[38;2;10;11;12m" + "\U0010EEEE̍̅" + "\U0010EEEE̍̍" + "\x1b[39m",
	}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %q\nwant %q", got, want)
	}
}

func TestKittyPlaceholderCoversAFaceBox(t *testing.T) {
	if got := KittyPlaceholder(7, faceBoxCols, faceBoxRows); len(got) != faceBoxRows {
		t.Fatalf("got %d lines", len(got))
	}
}

func TestKittyTransmitChunksTheFile(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 64, 64))
	seed := uint32(1)
	for i := range img.Pix {
		seed = seed*1664525 + 1013904223
		img.Pix[i] = byte(seed >> 24)
	}
	path := writePNG(t, img)
	raw, _ := os.ReadFile(path)
	if base64.StdEncoding.EncodedLen(len(raw)) <= 2*4096 {
		t.Fatalf("fixture too small to need three chunks: %d bytes", len(raw))
	}
	got, err := KittyTransmit(42, path, 16, 8)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(got, "\x1b_Ga=T,U=1,f=100,t=d,i=42,c=16,r=8,q=2,m=") {
		t.Fatalf("bad first chunk header: %q", got[:60])
	}
	var payload strings.Builder
	chunks := strings.Split(strings.TrimSuffix(got, "\x1b\\"), "\x1b\\")
	for i, c := range chunks {
		_, data, ok := strings.Cut(c, ";")
		if !ok || len(data) > 4096 {
			t.Fatalf("chunk %d malformed or too long (%d)", i, len(data))
		}
		last := i == len(chunks)-1
		if strings.Contains(c, "m=0") != last {
			t.Fatalf("chunk %d: m flag wrong: %q", i, c[:20])
		}
		payload.WriteString(data)
	}
	decoded, err := base64.StdEncoding.DecodeString(payload.String())
	if err != nil || string(decoded) != string(raw) {
		t.Fatalf("payload does not round-trip: err=%v", err)
	}
}

func TestKittyReplyOK(t *testing.T) {
	cases := map[string]bool{
		"\x1b_Gi=31;OK\x1b\\\x1b[?62;22c":            true,
		"\x1b[?62;22c":                               false,
		"\x1b_Gi=31;ENOTSUPPORTED:x\x1b\\\x1b[?62c": false,
	}
	for reply, want := range cases {
		if got := kittyReplyOK([]byte(reply)); got != want {
			t.Fatalf("%q: got %v want %v", reply, got, want)
		}
	}
}
