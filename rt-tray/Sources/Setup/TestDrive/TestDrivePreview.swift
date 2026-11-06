#if DEBUG
import AppKit
import MattstackCore
import SwiftUI

/// `rt-tray --setup-test-drive`: the dev app's Test drive setup… from a raw debug
/// build, so setup screen work can be clicked through without rebuilding the
/// installed dev app. Under the window preview's gate: unbundled, scratch HOME,
/// and none of the tray boots. Set RT_STUB_BUN when bun is not in a usual place.
@MainActor
enum TestDrivePreview {
    private static var controller: TestDriveController!

    static func run() -> Never {
        let account = getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) } ?? NSHomeDirectory()
        if let refusal = WindowPreviewGate.refusal(bundleIdentifier: Bundle.main.bundleIdentifier,
                                                   home: ProcessInfo.processInfo.environment["HOME"], accountHome: account) {
            FileHandle.standardError.write(Data((refusal.replacingOccurrences(of: "--window-preview", with: "--setup-test-drive") + "\n").utf8))
            exit(2)
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = main

        controller = TestDriveController(
            permissions: PermissionsService(bundleId: "com.mattstack.test-drive-preview", agentStatuses: { [] }, runner: SystemCommandRunner()),
            updater: UpdaterController(isDevBuild: true, isBusy: { false }))
        controller.showPicker()
        NSApp.activate(ignoringOtherApps: true)
        app.run()
        exit(0)
    }
}
#endif
