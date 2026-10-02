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
/// `grace` matches LaunchSettle's deck budget, so a cold boot is never
/// restarted sooner than launch itself would give up on it. Gave-up is not
/// latched: it is what a heal turns into while the window still holds
/// `maxAttempts` restarts, so a deck that flaps up and down between restarts
/// hits the same cap as one that never comes back.
public struct DeckHealPolicy: Sendable {
    public static let grace: TimeInterval = 30
    public static let maxAttempts = 3
    public static let window: TimeInterval = 600

    private var downSince: TimeInterval?
    private var attempts: [TimeInterval] = []

    public init() {}

    public mutating func observe(healthy: Bool, hold: DeckHealHold?, now: TimeInterval) -> DeckHealDecision {
        guard !healthy else {
            downSince = nil
            return .healthy
        }
        if let hold {
            downSince = nil
            return .held(hold)
        }
        let since = downSince ?? now
        downSince = since
        guard now - since >= Self.grace else { return .waiting }
        prune(now: now)
        guard attempts.count < Self.maxAttempts else { return .gaveUp }
        attempts.append(now)
        downSince = nil
        return .heal
    }

    /// Someone asked for a restart by hand: that is a fresh start for the cap.
    public mutating func manualRestart() {
        downSince = nil
        attempts = []
    }

    public mutating func restartFinished() {
        downSince = nil
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

    /// deck.mattstack goes through the local proxy and its TLS trust, so it
    /// can fail while deck itself answers on loopback; restarting deck would
    /// not fix that.
    public static func proxyDown(pid: String) -> String {
        "Deck: up (pid \(pid)), but deck.mattstack is not answering"
    }

    public static func isQuiet(_ status: String) -> Bool {
        status.hasPrefix("Deck: running")
    }

    /// `runMode` in deck's api.json says whether the dev shim is serving
    /// source or fell back to the pinned build.
    public static func runMode(apiJSON: Data) -> String? {
        apiObject(apiJSON)?["runMode"] as? String
    }

    public static func loopbackHealthURL(apiJSON: Data) -> String? {
        guard let port = apiObject(apiJSON)?["port"] as? Int else { return nil }
        return "http://127.0.0.1:\(port)/healthz"
    }

    private static func apiObject(_ data: Data) -> [String: Any]? {
        try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}
