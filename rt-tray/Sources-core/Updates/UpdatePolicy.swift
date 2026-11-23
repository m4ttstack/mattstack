import Foundation

public enum UpdatePolicy {
    public static let placeholderKey = "REPLACE_WITH_RELEASE_PUBLIC_ED_KEY"
    public static let overrideEnv = "MATTSTACK_APPCAST_URL"
    public static let overrideFlag = "--allow-appcast-override"

    /// The clean-room VM points the app at a loopback appcast. Only the dev
    /// flavor, or a launch that opted in on the command line, may be redirected.
    public static func feedOverride(environment: [String: String], arguments: [String], isDevBuild: Bool) -> String? {
        guard let url = environment[overrideEnv], !url.isEmpty else { return nil }
        return (isDevBuild || arguments.contains(overrideFlag)) ? url : nil
    }

    /// Dev flavor never checks unless a feed override is in force; a build
    /// without a real EdDSA key must not talk to any feed it cannot verify.
    public static func shouldStartUpdater(isDevBuild: Bool, publicEDKey: String?, feedURL: String?, feedOverride: String?) -> Bool {
        guard let key = publicEDKey, !key.isEmpty, key != placeholderKey else { return false }
        if let o = feedOverride, !o.isEmpty { return true }
        guard !isDevBuild, let feed = feedURL, !feed.isEmpty else { return false }
        return true
    }

    /// A background prepare outlives the Setup window, and an update relaunch would kill it mid-install.
    public static func setupBusy(windowRunning: Bool, runInFlight: Bool) -> Bool {
        windowRunning || runInFlight
    }

    /// A minimized window reports isVisible false but is still open. The
    /// status bar window is always visible and never key, so it never holds.
    public static func windowHoldsUpdate(isVisible: Bool, isMiniaturized: Bool, canBecomeKey: Bool) -> Bool {
        (isVisible || isMiniaturized) && canBecomeKey
    }

    /// Not silent, a scheduled update opens Sparkle's window in front, except
    /// while setup runs: the menu item stands in then, and the next scheduled
    /// check asks again. Silent, the install needs no window.
    public static func opensUpdateWindow(silent: Bool, handledBySparkle: Bool, userInitiated: Bool, setupRunning: Bool) -> Bool {
        !silent && !handledBySparkle && !userInitiated && !setupRunning
    }

    /// `silent` is the org's automatic-update setting. Silent, a setup run and
    /// then a busy daemon hold the install, and open windows do not, since the
    /// app reopens them. Not silent, setup and then open windows hold, and the
    /// daemon is not asked.
    public static func hold(silent: Bool, setupRunning: Bool, windowsOpen: Int, daemonBusy: Bool) -> UpdateHold? {
        if setupRunning { return .setupRunning }
        if silent { return daemonBusy ? .daemonBusy : nil }
        return windowsOpen > 0 ? .windowsOpen : nil
    }

    public static let checkInterval: TimeInterval = 3600
}

public enum UpdateHold: Equatable, Sendable {
    case setupRunning
    case windowsOpen
    case daemonBusy
}
