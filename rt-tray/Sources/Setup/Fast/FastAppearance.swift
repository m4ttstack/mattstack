import AppKit

/// The fast setup window is dark only: it draws in `window` whatever the
/// system appearance is, and snapshots render in it for both scheme files.
enum FastAppearance {
    static let window = NSAppearance(named: .darkAqua)!
}
