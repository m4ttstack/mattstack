import Foundation
import MattstackCore

private func installMainMenuBody() throws -> String {
    let sources = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../Sources").standardized
    let text = try String(contentsOf: sources.appendingPathComponent("AppDelegate.swift"), encoding: .utf8)
    guard let start = text.range(of: "private func installMainMenu()"),
          let end = text.range(of: "\n    }\n", range: start.upperBound..<text.endIndex) else { return "" }
    return String(text[start.lowerBound..<end.upperBound])
}

let appMenuChecks: [Check] = [
    Check("mattstack Help opens the rt.cool docs site") { c in
        c.expectEqual(DocsSite.home.absoluteString, "https://rt.cool/")
    },
    Check("the app menu lists About, updates, Settings, Setup status and Quit, in that order") { c in
        let body = try installMainMenuBody()
        try c.require(!body.isEmpty, "installMainMenu not found in AppDelegate.swift")
        let titles = ["\"About mattstack\"", "\"Check for Updates…\"", "\"Settings…\"", "\"Setup status…\"", "\"Quit mattstack\""]
        let positions = titles.compactMap { body.range(of: $0)?.lowerBound }
        try c.requireEqual(positions.count, titles.count)
        c.expect(positions == positions.sorted(), "app menu items are out of order")
    },
    Check("the app and Help menus reuse the tray menu's selectors") { c in
        let body = try installMainMenuBody()
        for selector in ["#selector(checkForUpdates)", "#selector(showSettings)", "#selector(showSetupStatus)",
                         "#selector(viewDaemonLogs)", "#selector(openCrashLog)",
                         "#selector(NSApplication.orderFrontStandardAboutPanel(_:))"] {
            c.expect(body.contains(selector), "installMainMenu does not use \(selector)")
        }
        c.expect(body.contains("NSApp.helpMenu = help"), "the Help menu is not registered as NSApp.helpMenu")
    },
]
