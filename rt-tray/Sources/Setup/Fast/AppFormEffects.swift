import AppKit
import MattstackCore

/// What a form row's action does that only the app can: a link in the
/// member's own browser, a System Settings pane, a macOS permission prompt.
struct AppFormEffects: FormEffects {
    let permissions: PermissionsService

    /// Stub mode never opens a real browser tab.
    @MainActor func openURL(_ url: URL) {
        guard !BundleFlavor.isStubActive else {
            TrayLog.info("open \(url.host ?? "link") skipped (stub mode)")
            return
        }
        NSWorkspace.shared.open(url)
    }

    @MainActor func openSettings(_ target: String) { permissions.openSettings(target) }

    func requestPermission(_ which: String) async -> Bool { await permissions.request(which) }
}
