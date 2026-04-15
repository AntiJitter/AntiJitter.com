// Package ui provides system tray icons for the AntiJitter Windows app.
//
// Icons are generated at init time as ICO-format bytes (PNG payload inside
// ICO container). No external image files needed — everything is embedded
// in the binary.
//
// Colors match the AntiJitter design system:
//
//	Gray   (#808080) = Game Mode OFF
//	Green  (#30d158) = Game Mode ON, bonding active
//	Orange (#ff9f0a) = 4G data limit approaching
package ui

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
)

// Pre-generated ICO-format icon bytes, ready for systray.SetIcon().
var (
	IconGray   = mustGenerateIcon(color.RGBA{R: 128, G: 128, B: 128, A: 255})
	IconGreen  = mustGenerateIcon(color.RGBA{R: 48, G: 209, B: 88, A: 255})
	IconOrange = mustGenerateIcon(color.RGBA{R: 255, G: 159, B: 10, A: 255})
)

const iconSize = 32 // 32x32 pixels — standard system tray size

// mustGenerateIcon creates a filled-circle ICO icon with the given color.
// Panics on error (only called at init time with known-good inputs).
func mustGenerateIcon(c color.RGBA) []byte {
	data, err := generateICO(c)
	if err != nil {
		panic("icon generation failed: " + err.Error())
	}
	return data
}

// generateICO creates a 32x32 ICO file with a PNG payload.
// ICO with embedded PNG is supported on Windows Vista+ (all relevant versions).
func generateICO(c color.RGBA) ([]byte, error) {
	// Render a filled circle on transparent background
	img := image.NewRGBA(image.Rect(0, 0, iconSize, iconSize))

	cx, cy := iconSize/2, iconSize/2
	r := iconSize/2 - 2 // 1px margin for antialiasing room

	for y := 0; y < iconSize; y++ {
		for x := 0; x < iconSize; x++ {
			dx, dy := x-cx, y-cy
			distSq := dx*dx + dy*dy
			rSq := r * r

			if distSq <= rSq-r {
				// Fully inside — solid color
				img.SetRGBA(x, y, c)
			} else if distSq <= rSq+r {
				// Edge — simple antialiasing via alpha blend
				alpha := uint8(float64(c.A) * (1.0 - float64(distSq-rSq+r)/float64(2*r)))
				img.SetRGBA(x, y, color.RGBA{R: c.R, G: c.G, B: c.B, A: alpha})
			}
			// Outside — stays transparent
		}
	}

	// Encode as PNG
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img); err != nil {
		return nil, err
	}
	pngData := pngBuf.Bytes()

	// Wrap PNG in ICO container
	var ico bytes.Buffer

	// ICONDIR header (6 bytes)
	binary.Write(&ico, binary.LittleEndian, uint16(0)) // Reserved
	binary.Write(&ico, binary.LittleEndian, uint16(1)) // Type: 1 = ICO
	binary.Write(&ico, binary.LittleEndian, uint16(1)) // Count: 1 image

	// ICONDIRENTRY (16 bytes)
	ico.WriteByte(iconSize) // Width
	ico.WriteByte(iconSize) // Height
	ico.WriteByte(0)        // Color count (0 = no palette)
	ico.WriteByte(0)        // Reserved
	binary.Write(&ico, binary.LittleEndian, uint16(1))              // Color planes
	binary.Write(&ico, binary.LittleEndian, uint16(32))             // Bits per pixel
	binary.Write(&ico, binary.LittleEndian, uint32(len(pngData)))   // Image data size
	binary.Write(&ico, binary.LittleEndian, uint32(6+16))           // Offset to image data

	// PNG payload
	ico.Write(pngData)

	return ico.Bytes(), nil
}
