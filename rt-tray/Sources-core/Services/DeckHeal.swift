import Foundation

/// Why the tray will not restart deck right now, even though it is not answering.
public enum DeckHealHold: Equatable, Sendable {
    /// Launch's own settle-and-spawn-heal pass still owns the agents.
    case launchSettling
    case awaitingApproval
    case notRegistered
    /// The version-change sweep is already restarting deck's apps.
    case servedAppsRestarting
    /// A restart (menu, splash or an earlier heal) has not finished.
    case restartInFlight
}

public enum DeckHealDecision: Equatable, Sendable {
    case healthy
    case waiting
    case heal
    case held(DeckHealHold)
    case gaveUp
}

/// Decides, one status poll at a time, when the tray kickstarts its own
/// flavor's deck job. launchd cannot do it alone: the job's KeepAlive is
/// `SuccessfulExit: false`, so a deck that exits 0 stays down, and the
/// window cannot open past deck.
///
/// Gave-up is not latched: it is what a heal turns into while the window
/// still holds `maxAttempts` restarts, so a deck that flaps up and down
/// between restarts hits the same cap as one that never comes back.
public struct DeckHealPolicy: Sendable {
    public static let missesBeforeHeal = 2
    public static let maxAttempts = 3
    public static let window: TimeInterval = 600

    private var misses = 0
    private var attempts: [TimeInterval] = []

    public init() {}

    public mutating func observe(healthy: Bool, hold: DeckHealHold?, now: TimeInterval) -> DeckHealDecision {
        guard !healthy else {
            misses = 0
            return .healthy
        }
        misses += 1
        if let hold { return .held(hold) }
        guard misses >= Self.missesBeforeHeal else { return .waiting }
        prune(now: now)
        guard attempts.count < Self.maxAttempts else { return .gaveUp }
        attempts.append(now)
        misses = 0
        return .heal
    }

    /// Someone asked for a restart by hand: that is a fresh start for the cap.
    public mutating func manualRestart() {
        misses = 0
        attempts = []
    }

    /// Deck gets a fresh two polls to answer after any restart finishes, so a
    /// slow boot is never restarted again the moment the restart's hold lifts.
    public mutating func restartFinished() {
        misses = 0
    }

    public mutating func attemptCount(now: TimeInterval) -> Int {
        prune(now: now)
        return attempts.count
    }

    private mutating func prune(now: TimeInterval) {
        attempts.removeAll { now - $0 >= Self.window }
    }
}

/// The tray menu's deck line, under the daemon's.
public enum DeckStatusLines {
    public static func status(for decision: DeckHealDecision, pid: String?, runMode: String?) -> String {
        switch decision {
        case .healthy:
            var line = "Deck: running"
            if let pid { line += " · pid \(pid)" }
            if let runMode { line += " · \(runMode)" }
            return line
        case .waiting: return "Deck: not responding"
        case .heal: return "Deck: not responding, restarting"
        case .gaveUp: return "Deck: down, stopped restarting it automatically"
        case .held(.launchSettling): return "Deck: starting"
        case .held(.awaitingApproval): return "Deck: waiting for Login Items approval"
        case .held(.notRegistered): return "Deck: not registered"
        case .held(.servedAppsRestarting): return "Deck: restarting apps"
        case .held(.restartInFlight): return "Deck: restarting"
        }
    }

    public static func isQuiet(_ status: String) -> Bool {
        status.hasPrefix("Deck: running")
    }

    /// `runMode` in deck's api.json says whether the dev shim is serving
    /// source or fell back to the pinned build.
    public static func runMode(apiJSON: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: apiJSON) as? [String: Any] else { return nil }
        return object["runMode"] as? String
    }
}
