import Foundation
import MattstackCore

private let emDash = String(UnicodeScalar(0x2014)!)
private let enDash = String(UnicodeScalar(0x2013)!)
private func hasDash(_ text: String) -> Bool { text.contains(emDash) || text.contains(enDash) }

private func appDelegateSource() throws -> String {
    let sources = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../Sources").standardized
    return try String(contentsOf: sources.appendingPathComponent("AppDelegate.swift"), encoding: .utf8)
}

let daemonStatusLinesChecks: [Check] = [
    Check("a degraded daemon reads as one line with its cause in parens") { c in
        c.expectEqual(DaemonStatusLines.degraded("refresh: 1 enrich error"),
                      "Daemon: degraded (refresh: 1 enrich error)")
    },
    Check("a healthy daemon's line names pid and uptime, and is the quiet one") { c in
        let line = DaemonStatusLines.running(pid: 4242, uptime: "3h 12m")
        c.expectEqual(line, "Daemon: running · pid 4242 · 3h 12m")
        c.expect(DaemonStatusLines.isQuiet(line))
        c.expect(!DaemonStatusLines.isQuiet(DaemonStatusLines.degraded("memory: rss 900MB")))
        c.expect(!DaemonStatusLines.isQuiet("Daemon: not running"))
    },
    Check("status lines never carry an em or en dash, even from daemon-supplied text") { c in
        let degraded = DaemonStatusLines.degraded("refresh \(emDash) 2 repos \(enDash) failing")
        c.expect(!hasDash(degraded), degraded)
        c.expectEqual(degraded, "Daemon: degraded (refresh - 2 repos - failing)")
        let lines = DaemonStatusLines.diagnostics(status: "Daemon: running · pid 1 · 5s",
                                                  bootVerdict: "boot\(emDash)failed",
                                                  lastCrashReason: "port 7777 \(enDash) in use")
        for line in lines { c.expect(!hasDash(line), line) }
    },
    Check("a degraded status is never repeated by a diagnostic line") { c in
        let status = DaemonStatusLines.degraded("refresh: 1 enrich error")
        let lines = DaemonStatusLines.diagnostics(status: status, bootVerdict: nil, lastCrashReason: nil)
        c.expectEqual(lines, [])
    },
    Check("a verdict the status line already states is not listed again") { c in
        let lines = DaemonStatusLines.diagnostics(status: "Daemon: alive but not serving",
                                                  bootVerdict: "alive but not serving", lastCrashReason: nil)
        c.expectEqual(lines, [])
    },
    Check("a crash loop and its reason are listed under a running daemon") { c in
        let lines = DaemonStatusLines.diagnostics(status: "Daemon: running · pid 1 · 5s",
                                                  bootVerdict: "crash-looping",
                                                  lastCrashReason: "EADDRINUSE on rt.sock")
        c.expectEqual(lines, ["Status: crash-looping", "Last crash: EADDRINUSE on rt.sock"])
    },
    Check("the tray menu has no Restarts line and no separate Degraded line") { c in
        let text = try appDelegateSource()
        c.expect(!text.contains("\"Restarts:"), "AppDelegate.swift still builds a Restarts line")
        c.expect(!text.contains("\"Degraded:"), "AppDelegate.swift still builds a Degraded line")
        c.expect(text.contains("DaemonStatusLines.diagnostics("), "the menu no longer builds its diagnostics from DaemonStatusLines")
    },
    Check("every daemon status line the tray sets is free of em and en dashes") { c in
        let text = try appDelegateSource()
        let assignments = text.components(separatedBy: "\n").filter { $0.contains("statusText = ") }
        try c.require(assignments.count >= 5, "found only \(assignments.count) statusText assignments")
        for line in assignments where hasDash(line) {
            c.fail("dash in status line: \(line.trimmingCharacters(in: .whitespaces))")
        }
    },
]
