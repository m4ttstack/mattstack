import AppKit
import SwiftUI

/// The window shell's chrome palette, spelled once. The tab bar renders in
/// SwiftUI and the find bar in AppKit, so every role is published in both
/// currencies from one set of components rather than as two drifting copies
/// of the same hex.
enum ShellChrome {
    struct Role {
        let r: Int, g: Int, b: Int

        var color: Color {
            Color(red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255)
        }
        var nsColor: NSColor {
            NSColor(srgbRed: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1)
        }
    }

    static let bar = Role(r: 0x0f, g: 0x0f, b: 0x15)
    static let separator = Role(r: 0x31, g: 0x38, b: 0x53)
    static let activeTab = Role(r: 0x1c, g: 0x21, b: 0x36)
    static let inactiveTab = Role(r: 0x16, g: 0x16, b: 0x1e)
    static let activeLabel = Role(r: 0xe3, g: 0xe7, b: 0xf6)
    static let inactiveLabel = Role(r: 0x7e, g: 0x86, b: 0xad)
    static let accent = Role(r: 0x7a, g: 0xa2, b: 0xf7)
    static let ok = Role(r: 0x3e, g: 0xb9, b: 0x53)
    static let warn = Role(r: 0xf7, g: 0x76, b: 0x8e)
    static let badgeFill = warn
    static let badgeText = bar
}

/// An app's own colour, read from its icon's tile: every mark is a glyph on a
/// tile in a light step of the app's hue (@mattstack/app-icons), so the
/// viewer takes the colour from the icon deck serves rather than keeping a
/// second copy of each hue here.
enum IconTint {
    private static var cache: [ObjectIdentifier: Color] = [:]

    static func of(_ image: NSImage?) -> Color? {
        guard let image else { return nil }
        let key = ObjectIdentifier(image)
        if let hit = cache[key] { return hit }
        guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
              let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        var pixel = [UInt8](repeating: 0, count: 4)
        let drawn: Bool = pixel.withUnsafeMutableBytes { buffer in
            guard let ctx = CGContext(
                data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8,
                bytesPerRow: 4, space: space,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            // The tile's left edge at mid height: clear of the rounded
            // corners and of every glyph, which starts past an eighth in.
            let w = CGFloat(cg.width), h = CGFloat(cg.height)
            ctx.draw(cg, in: CGRect(x: -w * 0.08, y: -h * 0.5, width: w, height: h))
            return true
        }
        guard drawn, pixel[3] > 200 else { return nil }
        let tint = Color(red: Double(pixel[0]) / 255, green: Double(pixel[1]) / 255,
                         blue: Double(pixel[2]) / 255)
        cache[key] = tint
        return tint
    }
}
