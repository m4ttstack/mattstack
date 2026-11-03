#if DEBUG
import AppKit
import SwiftUI

enum SnapshotRenderer {
    /// AppKit-backed controls only draw through a real view hierarchy. With
    /// `colorSpace`, translucent fills blend in that space (CSS mocks blend in
    /// sRGB) and the PNG is tagged with it; `scale` sets pixels per point.
    @MainActor
    static func render<V: View>(_ view: V, appearance: NSAppearance.Name, to url: URL,
                                scale: CGFloat = 1, colorSpace: NSColorSpace? = nil) {
        let host = NSHostingView(rootView: view)
        host.appearance = NSAppearance(named: appearance)
        let size = host.fittingSize
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: appearance)
        if let colorSpace { window.colorSpace = colorSpace }
        window.contentView = host
        host.frame = NSRect(origin: .zero, size: size)
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        let rep: NSBitmapImageRep
        if scale == 1, colorSpace == nil {
            guard let cached = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { fatalError("no bitmap for \(url.lastPathComponent)") }
            rep = cached
        } else {
            guard let blank = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int((size.width * scale).rounded()),
                                               pixelsHigh: Int((size.height * scale).rounded()), bitsPerSample: 8, samplesPerPixel: 4,
                                               hasAlpha: true, isPlanar: false, colorSpaceName: .calibratedRGB, bytesPerRow: 0, bitsPerPixel: 0),
                  let tagged = blank.retagging(with: colorSpace ?? .sRGB) else { fatalError("no bitmap for \(url.lastPathComponent)") }
            tagged.size = size
            rep = tagged
        }
        host.cacheDisplay(in: host.bounds, to: rep)
        try! rep.representation(using: .png, properties: [:])!.write(to: url)
    }

    /// `Color(nsColor:)` resolves against the drawing appearance.
    @MainActor
    static func renderImage<V: View>(_ view: V, appearance: NSAppearance.Name, to url: URL) {
        NSAppearance(named: appearance)!.performAsCurrentDrawingAppearance {
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            guard let cg = renderer.cgImage else { fatalError("render failed: \(url.lastPathComponent)") }
            let rep = NSBitmapImageRep(cgImage: cg)
            try! rep.representation(using: .png, properties: [:])!.write(to: url)
        }
    }
}
#endif
