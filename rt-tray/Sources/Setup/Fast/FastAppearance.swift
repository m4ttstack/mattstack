import AppKit

/// The fast setup window is dark only: it draws in `window` whatever the
/// system appearance is, and snapshots render in it for both scheme files.
/// `isDark` is for colours built through `NSColor(name:)`, which resolve per
/// appearance because offscreen snapshots read SwiftUI's colorScheme as light.
enum FastAppearance {
    static let window = NSAppearance(named: .darkAqua)!

    static func isDark(_ appearance: NSAppearance) -> Bool {
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    }
}
