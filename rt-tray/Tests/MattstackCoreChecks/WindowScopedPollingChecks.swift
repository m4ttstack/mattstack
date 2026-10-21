import Foundation
@testable import MattstackCore

private let closing = Notification.Name("WindowScopedPollingChecks.closing")
private let visibility = Notification.Name("WindowScopedPollingChecks.visibility")

@MainActor private final class Probe {
    var events: [String] = []
}

@MainActor private func bound(_ window: AnyObject, _ center: NotificationCenter, _ probe: Probe) -> WindowScopedPolling {
    WindowScopedPolling(window: window, closing: closing, center: center,
                        start: { probe.events.append("start") }, stop: { probe.events.append("stop") })
}

let windowScopedPollingChecks: [Check] = [
    Check("window-scoped polling: closing the window stops polling") { c in
        let events = await MainActor.run { () -> [String] in
            let center = NotificationCenter(), window = NSObject(), probe = Probe()
            let polling = bound(window, center, probe)
            polling.show()
            center.post(name: closing, object: window)
            return withExtendedLifetime(polling) { probe.events }
        }
        c.expectEqual(events, ["start", "stop"])
    },
    Check("window-scoped polling: another window closing leaves polling running") { c in
        let events = await MainActor.run { () -> [String] in
            let center = NotificationCenter(), window = NSObject(), probe = Probe()
            let polling = bound(window, center, probe)
            polling.show()
            center.post(name: closing, object: NSObject())
            return withExtendedLifetime(polling) { probe.events }
        }
        c.expectEqual(events, ["start"])
    },
    Check("window-scoped polling: reopening a closed window starts polling again") { c in
        let events = await MainActor.run { () -> [String] in
            let center = NotificationCenter(), window = NSObject(), probe = Probe()
            let polling = bound(window, center, probe)
            polling.show()
            center.post(name: closing, object: window)
            polling.show()
            return withExtendedLifetime(polling) { probe.events }
        }
        c.expectEqual(events, ["start", "stop", "start"])
    },
    Check("window-scoped polling: a hidden window stops polling and resumes when it shows again") { c in
        let events = await MainActor.run { () -> [String] in
            let center = NotificationCenter(), window = NSObject(), probe = Probe()
            var visible = true
            let polling = WindowScopedPolling(window: window, closing: closing, visibilityChanged: visibility,
                                              isVisible: { visible }, center: center,
                                              start: { probe.events.append("start") }, stop: { probe.events.append("stop") })
            polling.show()
            visible = false
            center.post(name: visibility, object: window)
            visible = true
            center.post(name: visibility, object: window)
            return withExtendedLifetime(polling) { probe.events }
        }
        c.expectEqual(events, ["start", "stop", "start"])
    },
    Check("window-scoped polling: a window shown while hidden waits until it is visible") { c in
        let events = await MainActor.run { () -> [String] in
            let center = NotificationCenter(), window = NSObject(), probe = Probe()
            var visible = false
            let polling = WindowScopedPolling(window: window, closing: closing, visibilityChanged: visibility,
                                              isVisible: { visible }, center: center,
                                              start: { probe.events.append("start") }, stop: { probe.events.append("stop") })
            polling.show()
            visible = true
            center.post(name: visibility, object: window)
            return withExtendedLifetime(polling) { probe.events }
        }
        c.expectEqual(events, ["start"])
    },
    Check("window-scoped polling: a closed window stays stopped when its visibility changes") { c in
        let events = await MainActor.run { () -> [String] in
            let center = NotificationCenter(), window = NSObject(), probe = Probe()
            let polling = WindowScopedPolling(window: window, closing: closing, visibilityChanged: visibility,
                                              center: center,
                                              start: { probe.events.append("start") }, stop: { probe.events.append("stop") })
            polling.show()
            center.post(name: closing, object: window)
            center.post(name: visibility, object: window)
            return withExtendedLifetime(polling) { probe.events }
        }
        c.expectEqual(events, ["start", "stop"])
    },
]
