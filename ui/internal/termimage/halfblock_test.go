package termimage

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writePNG(t *testing.T, img image.Image) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "face.png")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestHalfBlockTwoByTwo(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{255, 0, 0, 255})
	img.Set(1, 0, color.RGBA{0, 255, 0, 255})
	img.Set(0, 1, color.RGBA{0, 0, 255, 255})
	img.Set(1, 1, color.RGBA{255, 255, 255, 255})
	got, err := HalfBlock(writePNG(t, img), 2, 1)
	if err != nil {
		t.Fatal(err)
	}
	want := "\x1b[38;2;255;0;0m\x1b[48;2;0;0;255m▀" + "\x1b[38;2;0;255;0m\x1b[48;2;255;255;255m▀" + "\x1b[0m"
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
}

func TestHalfBlockBoxFilters(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			if (x+y)%2 == 0 {
				img.Set(x, y, color.RGBA{200, 0, 0, 255})
			} else {
				img.Set(x, y, color.RGBA{0, 0, 100, 255})
			}
		}
	}
	got, err := HalfBlock(writePNG(t, img), 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	want := "\x1b[38;2;100;0;50m\x1b[48;2;100;0;50m▀\x1b[0m"
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
}

func TestHalfBlockRowsAreNewlineSeparated(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	got, err := HalfBlock(writePNG(t, img), 2, 2)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(strings.Split(got, "\n")); n != 2 {
		t.Fatalf("got %d lines, want 2: %q", n, got)
	}
}

func TestHalfBlockMissingFile(t *testing.T) {
	if _, err := HalfBlock(filepath.Join(t.TempDir(), "nope.png"), 2, 1); err == nil {
		t.Fatal("missing file accepted")
	}
}
