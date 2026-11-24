import AppKit
import MattstackCore

/// The tray menu's herdr block: hidden unless a herdr server is older than the installed herdr.
@MainActor
enum HerdrRestartMenu {
    static func items(_ model: HerdrRestartModel, onRestart: @escaping () -> Void) -> [NSMenuItem] {
        let line = AppDelegate.infoMenuItem(HerdrRestartCopy.statusLine, quiet: false)
        line.setAccessibilityIdentifier(AXID.trayHerdrStatus)
        let restart = ActionMenuItem(HerdrRestartCopy.menuItem, axid: AXID.trayRestartHerdr, handler: onRestart)
        let items = [line, restart]
        apply(model, to: items)
        return items
    }

    static func apply(_ model: HerdrRestartModel, to items: [NSMenuItem]) {
        items.forEach { $0.isHidden = !model.needsRestart }
        items.last?.isEnabled = !model.isRestarting
    }
}

@MainActor
enum HerdrRestartAlert {
    /// Cancel is the default and answers Escape too, so only a click on the other button ends a pane.
    static func confirmation(_ stale: [String]) -> NSAlert {
        let alert = NSAlert()
        alert.messageText = HerdrRestartCopy.confirmTitle
        alert.informativeText = HerdrRestartCopy.confirmBody(stale)
        let restart = alert.addButton(withTitle: HerdrRestartCopy.confirmButton)
        restart.hasDestructiveAction = true
        restart.keyEquivalent = ""
        alert.addButton(withTitle: HerdrRestartCopy.cancelButton).keyEquivalent = "\r"
        return alert
    }

    static func confirm(_ stale: [String]) -> Bool {
        let alert = confirmation(stale)
        // Return on Cancel takes the place of the Escape AppKit gives it.
        let escape = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            guard event.keyCode == escapeKeyCode, event.window === alert.window else { return event }
            alert.buttons.last?.performClick(nil)
            return nil
        }
        defer { escape.map(NSEvent.removeMonitor) }
        NSApp.activate(ignoringOtherApps: true)
        return alert.runModal() == .alertFirstButtonReturn
    }

    private static let escapeKeyCode: UInt16 = 53

    static func inform(_ title: String, _ body: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = body
        alert.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }
}
