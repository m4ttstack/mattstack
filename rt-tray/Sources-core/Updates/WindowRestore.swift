import Foundation

public enum RestorableWindow: String, CaseIterable, Sendable {
    case main, settings, worktreePanel, processPanel
}

/// The windows open when Sparkle quit the app for an install, so the
/// relaunched app can put them back.
public struct WindowRestore {
    public static let defaultsKey = "MSUpdateReopenWindows"
    private let defaults: UserDefaults

    public init(defaults: UserDefaults) {
        self.defaults = defaults
    }

    public func record(_ open: Set<RestorableWindow>) {
        defaults.set(open.map(\.rawValue).sorted(), forKey: Self.defaultsKey)
    }

    public func take() -> [RestorableWindow] {
        let stored = Set(defaults.stringArray(forKey: Self.defaultsKey) ?? [])
        defaults.removeObject(forKey: Self.defaultsKey)
        return RestorableWindow.allCases.filter { stored.contains($0.rawValue) }
    }

    /// An install that did not happen must not reopen windows at some later launch.
    public func clear() {
        defaults.removeObject(forKey: Self.defaultsKey)
    }
}
