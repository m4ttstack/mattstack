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
    Check("mattstack Help opens the mattstack docs site") { c in
        c.expectEqual(DocsSite.home.absoluteString, "https://docs.mattstack.dev/")
    },
    Check("the app menu lists About, updates, Settings, Setup status, the hide items and Quit, in that order") { c in
        let body = try installMainMenuBody()
        try c.require(!body.isEmpty, "installMainMenu not found in AppDelegate.swift")
        let titles = ["\"About mattstack\"", "\"Check for Updates…\"", "\"Settings…\"", "\"Setup status…\"",
                      "\"Hide mattstack\"", "\"Hide Others\"", "\"Show All\"", "\"Quit mattstack\""]
        let positions = titles.compactMap { body.range(of: $0)?.lowerBound }
        try c.requireEqual(positions.count, titles.count)
        c.expect(positions == positions.sorted(), "app menu items are out of order")
    },
    Check("⌘H hides the app and ⌥⌘H hides the others") { c in
        let body = try installMainMenuBody()
        c.expectEqual(body.components(separatedBy: "keyEquivalent: \"h\"").count - 1, 2)
        for code in ["#selector(NSApplication.hide(_:))", "#selector(NSApplication.hideOtherApplications(_:))",
                     "hideOthers.keyEquivalentModifierMask = [.command, .option]",
                     "#selector(NSApplication.unhideAllApplications(_:))"] {
            c.expect(body.contains(code), "installMainMenu does not use \(code)")
        }
    },
    /// A hidden app's windows report isVisible false, so these would take a
    /// hidden window for a closed one: quit for real, or update and not reopen it.
    Check("open-window checks count the windows of a hidden app") { c in
        let sources = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../Sources").standardized
        for (file, code) in [("AppDelegate.swift", "(window?.isVisibleOrAppHidden ?? false) || (window?.isMiniaturized"),
                             ("AppDelegate.swift", "$0.isVisibleOrAppHidden || $0.isMiniaturized"),
                             ("Setup/SetupCoordinator.swift", "w.isVisibleOrAppHidden || w.isMiniaturized"),
                             ("Updates/UpdaterController.swift", "isVisible: $0.isVisibleOrAppHidden"),
                             ("AppDelegate.swift", "HiddenAppWindows.shared.start()")] {
            let text = try String(contentsOf: sources.appendingPathComponent(file), encoding: .utf8)
            c.expect(text.contains(code), "\(file) does not use \(code)")
        }
    },
    Check("Ask Maude… sits first in the Help menu, and only the menu bar's own menu is rebuilt when one opens") { c in
        let body = try installMainMenuBody()
        let ask = try c.requireSome(body.range(of: "#selector(showHelpRequest)"), "the Help menu does not offer Ask Maude…")
        let docs = try c.requireSome(body.range(of: "\"mattstack Help\""))
        c.expect(ask.lowerBound < docs.lowerBound, "Ask Maude… is not first")
        let sources = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../Sources").standardized
        let text = try String(contentsOf: sources.appendingPathComponent("AppDelegate.swift"), encoding: .utf8)
        c.expect(text.contains("if menu === NSApp.helpMenu { refreshHelpAvailability() } else { rebuildTrayMenu(menu) }"),
                 "opening the Help menu would rebuild it as the tray menu")
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
