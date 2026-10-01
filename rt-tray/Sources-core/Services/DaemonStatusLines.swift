import Foundation

/// The tray menu's daemon block: one status line, then only the diagnostics
/// that state a fact the status line does not already carry.
public enum DaemonStatusLines {
    public static func running(pid: Int, uptime: String) -> String {
        "Daemon: running · pid \(pid) · \(uptime)"
    }

    public static func degraded(_ cause: String) -> String {
        "Daemon: degraded (\(plain(cause)))"
    }

    /// A healthy daemon's line can sit back; anything else must read at full contrast.
    public static func isQuiet(_ status: String) -> Bool {
        status.hasPrefix("Daemon: running")
    }

    public static func diagnostics(status: String, bootVerdict: String?, lastCrashReason: String?) -> [String] {
        var lines: [String] = []
        if let verdict = bootVerdict.map(plain), !status.contains(verdict) {
            lines.append("Status: \(verdict)")
        }
        if let reason = lastCrashReason.map(plain), !status.contains(reason) {
            lines.append("Last crash: \(reason)")
        }
        return lines
    }

    /// Daemon-supplied text (health reasons, crash reasons) can carry em or
    /// en dashes; the menu never shows either.
    public static func plain(_ text: String) -> String {
        text.unicodeScalars.reduce(into: "") { out, scalar in
            out.unicodeScalars.append(dashes.contains(scalar.value) ? "-" : scalar)
        }
    }

    private static let dashes: Set<UInt32> = [0x2013, 0x2014]
}
