import AppKit
import SwiftUI
import MattstackCore

/// Where a `SetupCoordinator`'s effects outside its own window land. The real
/// setup owns this launch's setup records (the updater's gates, Finish) and
/// the Mac's native effects; a test drive owns neither, so it runs beside
/// real setup without touching it.
struct SetupHost {
    /// Never writes `SetupSession`, relaunches the app, or refreshes Settings.
    var isTestDrive = false
    /// Whose setup-state.json says when the bar's run began and whether setup is finished.
    var home: String
    /// The row actions' native side; `reload` re-reads the screen's section, as coming back to the app does.
    var effects: (_ permissions: PermissionsService, _ reload: @escaping @MainActor @Sendable () async -> Void) -> FormEffects
    var openHome: @MainActor (URL) -> Void
    var pasteboard: PasteboardReading
    var joinPollInterval: TimeInterval = 15
    var windowTitle = "mattstack Setup"
    /// Extra height for what `decorate` adds above the screens.
    var chromeHeight: CGFloat = 0
    var decorate: @MainActor (AnyView) -> AnyView = { $0 }
    /// The window closed, on this screen.
    var windowClosed: @MainActor (FastSetupScreen) -> Void = { _ in }

    static var real: SetupHost {
        SetupHost(home: AppHome.current,
                  effects: { permissions, _ in AppFormEffects(permissions: permissions) },
                  openHome: { url in
                      if BundleFlavor.isStubActive {
                          TrayLog.info("open \(url.host ?? url.absoluteString) skipped (stub mode)")
                      } else {
                          NSWorkspace.shared.open(url)
                      }
                  },
                  pasteboard: SystemPasteboard())
    }
}

private struct SetupLinkOpenerKey: EnvironmentKey {
    static let defaultValue: @MainActor (URL) -> Void = { NSWorkspace.shared.open($0) }
}

extension EnvironmentValues {
    /// A row's own link (a create-token page), which a test drive shows instead of opening.
    var openSetupLink: @MainActor (URL) -> Void {
        get { self[SetupLinkOpenerKey.self] }
        set { self[SetupLinkOpenerKey.self] = newValue }
    }
}
