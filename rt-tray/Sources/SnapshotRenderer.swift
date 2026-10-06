#if DEBUG
import AppKit
import SwiftUI

enum SnapshotRenderer {
    /// AppKit-backed controls only draw through a real view hierarchy.
    @MainActor
    static func render<V: View>(_ view: V, appearance: NSAppearance.Name, to url: URL) {
        let host = NSHostingView(rootView: view)
        host.appearance = NSAppearance(named: appearance)
        let size = host.fittingSize
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: appearance)
        window.contentView = host
        host.frame = NSRect(origin: .zero, size: size)
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { fatalError("no bitmap for \(url.lastPathComponent)") }
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
