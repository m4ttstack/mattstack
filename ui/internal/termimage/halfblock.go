// Package termimage draws a PNG into a box of terminal cells: kitty graphics
// where the terminal answers the kitty query, half-blocks everywhere else.
package termimage

import (
	"fmt"
	"image"
	"image/color"
	_ "image/png"
	"os"
	"strings"
)

func decode(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	return img, err
}

// boxAverage is the mean color of the source pixels that fall in target
// pixel (tx, ty) of a tw x th grid laid over the image.
func boxAverage(img image.Image, tx, ty, tw, th int) color.RGBA {
	b := img.Bounds()
	x0 := b.Min.X + tx*b.Dx()/tw
	x1 := b.Min.X + (tx+1)*b.Dx()/tw
	y0 := b.Min.Y + ty*b.Dy()/th
	y1 := b.Min.Y + (ty+1)*b.Dy()/th
	if x1 <= x0 {
		x1 = x0 + 1
	}
	if y1 <= y0 {
		y1 = y0 + 1
	}
	var r, g, bl, n uint64
	for y := y0; y < y1; y++ {
		for x := x0; x < x1; x++ {
			cr, cg, cb, _ := img.At(x, y).RGBA()
			r += uint64(cr >> 8)
			g += uint64(cg >> 8)
			bl += uint64(cb >> 8)
			n++
		}
	}
	return color.RGBA{uint8(r / n), uint8(g / n), uint8(bl / n), 255}
}

// HalfBlock draws the PNG at path as rows lines of cols cells, each cell an
// upper half block whose foreground is the top pixel and background the
// bottom one, so the image is box-filtered to cols x 2*rows pixels.
func HalfBlock(path string, cols, rows int) (string, error) {
	img, err := decode(path)
	if err != nil {
		return "", err
	}
	lines := make([]string, rows)
	for row := 0; row < rows; row++ {
		var sb strings.Builder
		for col := 0; col < cols; col++ {
			top := boxAverage(img, col, 2*row, cols, 2*rows)
			bot := boxAverage(img, col, 2*row+1, cols, 2*rows)
			fmt.Fprintf(&sb, "\x1b[38;2;%d;%d;%dm\x1b[48;2;%d;%d;%dm▀", top.R, top.G, top.B, bot.R, bot.G, bot.B)
		}
		sb.WriteString("\x1b[0m")
		lines[row] = sb.String()
	}
	return strings.Join(lines, "\n"), nil
}
