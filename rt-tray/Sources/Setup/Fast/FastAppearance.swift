import AppKit

/// Fast-setup colours resolve per appearance through `NSColor(name:)`: the
/// offscreen snapshots read SwiftUI's colorScheme as light even on dark pages.
enum FastAppearance {
    static func isDark(_ appearance: NSAppearance) -> Bool {
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    }
}
