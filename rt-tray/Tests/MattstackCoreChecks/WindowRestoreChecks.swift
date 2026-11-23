import Foundation
import MattstackCore

private func freshDefaults() -> UserDefaults {
    let name = "window-restore-checks-\(UUID().uuidString)"
    let d = UserDefaults(suiteName: name)!
    d.removePersistentDomain(forName: name)
    return d
}

let windowRestoreChecks: [Check] = [
    Check("WindowRestore: record then take returns the windows in order, and a second take is empty") { c in
        let r = WindowRestore(defaults: freshDefaults())
        r.record([.processPanel, .main, .settings])
        c.expectEqual(r.take(), [.main, .settings, .processPanel])
        c.expectEqual(r.take(), [])
    },
    Check("WindowRestore: clear empties what was recorded") { c in
        let r = WindowRestore(defaults: freshDefaults())
        r.record([.worktreePanel])
        r.clear()
        c.expectEqual(r.take(), [])
    },
    Check("WindowRestore: an unknown stored name is ignored") { c in
        let d = freshDefaults()
        d.set(["main", "somethingNew"], forKey: WindowRestore.defaultsKey)
        c.expectEqual(WindowRestore(defaults: d).take(), [.main])
    },
    Check("WindowRestore: nothing recorded gives nothing") { c in
        c.expectEqual(WindowRestore(defaults: freshDefaults()).take(), [])
    },
    Check("WindowRestore: the windows come back in front only when the app was in front") { c in
        let r = WindowRestore(defaults: freshDefaults())
        r.record([.main], appWasActive: false)
        c.expectEqual(r.takeWasActive(), false)
        r.record([.main], appWasActive: true)
        c.expectEqual(r.takeWasActive(), true)
        c.expectEqual(r.takeWasActive(), false, "taken once")
    },
]
