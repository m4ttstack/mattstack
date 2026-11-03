import Foundation

/// Owns Sparkle's install handler for a downloaded update. Sparkle offers it
/// once; declining leaves the install to a quit, which a login item almost
/// never sees, and pushes Sparkle's next look a week out. Holding it lets the
/// app install the moment it goes idle. Main thread only, as Sparkle is.
public final class HeldUpdateInstaller: @unchecked Sendable {
    public private(set) var heldVersion: String?
    private var install: (() -> Void)?
    private var installing = false
    private let setupRunning: () -> Bool
    private let windowsOpen: () -> Int

    public init(setupRunning: @escaping () -> Bool, windowsOpen: @escaping () -> Int) {
        self.setupRunning = setupRunning
        self.windowsOpen = windowsOpen
    }

    /// Returns what holds the update, or nil when it is installing now.
    public func offer(version: String, install: @escaping () -> Void) -> UpdateHold? {
        self.install = install
        installing = false
        if let hold = UpdatePolicy.hold(setupRunning: setupRunning(), windowsOpen: windowsOpen()) {
            heldVersion = version
            return hold
        }
        heldVersion = nil
        start()
        return nil
    }

    /// Installs a held update once the app is idle; true when it started one.
    public func retry() -> Bool {
        guard heldVersion != nil, !installing,
              UpdatePolicy.hold(setupRunning: setupRunning(), windowsOpen: windowsOpen()) == nil else { return false }
        start()
        return true
    }

    /// The person asked for it, so open windows do not hold it; setup still
    /// does, since a relaunch would kill an install mid-run. Sparkle accepts
    /// the handler again after a cancelled quit, so this may repeat.
    public func installNow() -> Bool {
        guard heldVersion != nil, !setupRunning() else { return false }
        start()
        return true
    }

    private func start() {
        installing = true
        install?()
    }
}
