import Combine
import Foundation

/// Which of herdr's servers are older than the installed herdr, as rt finds them, and the restart that moves them on.
/// Nothing here restarts without a press: an older server keeps working, and a restart ends its panes.
@MainActor
public final class HerdrRestartModel: ObservableObject {
    public enum Found: Equatable, Sendable {
        case current
        case stale([String])
        case failed(String)
    }

    public static let recheckSeconds: TimeInterval = 600

    @Published public private(set) var stale: [String] = []
    @Published public private(set) var isRestarting = false
    public var needsRestart: Bool { !stale.isEmpty }

    private struct CheckAnswer: Decodable { let stale: [String] }

    private let rt: RtRunning
    private let now: @Sendable () -> Date
    private var checkedAt: Date?
    private var checks = LatestOnly()

    public init(rt: RtRunning, now: @escaping @Sendable () -> Date = { Date() }) {
        self.rt = rt
        self.now = now
    }

    public func refreshIfDue() async {
        if let checkedAt, now().timeIntervalSince(checkedAt) < Self.recheckSeconds { return }
        await refresh()
    }

    /// A check that failed offers no restart: rt could not say a server is older.
    @discardableResult
    public func refresh() async -> Found {
        checkedAt = now()
        let ticket = checks.start()
        let found = await check()
        if checks.isLatest(ticket) {
            if case .stale(let names) = found { stale = names } else { stale = [] }
        }
        return found
    }

    /// Nil once every older server stopped, else why not.
    public func restart() async -> String? {
        guard !isRestarting else { return nil }
        isRestarting = true
        defer { isRestarting = false }
        let error = await runRestart()
        await refresh()
        return error
    }

    private func runRestart() async -> String? {
        do {
            let r = try await rt.run(["tools", "restart", "herdr", "--json"], stdin: nil)
            guard r.exitCode != 0 else { return nil }
            return r.userError?.message ?? r.failureCopy(verb: "tools restart")
        } catch {
            return Self.spawnCopy(error, verb: "tools restart")
        }
    }

    private func check() async -> Found {
        do {
            let r = try await rt.run(["tools", "stale", "herdr", "--json"], stdin: nil)
            guard r.exitCode == 0, let answer = try? r.decode(CheckAnswer.self) else {
                return .failed(r.userError?.message ?? r.failureCopy(verb: "tools stale"))
            }
            return answer.stale.isEmpty ? .current : .stale(answer.stale)
        } catch {
            return .failed(Self.spawnCopy(error, verb: "tools stale"))
        }
    }

    private static func spawnCopy(_ error: Error, verb: String) -> String {
        (error as? RtClientError)?.copy ?? "rt \(verb) failed to start."
    }
}

public enum HerdrRestartCopy {
    public static let statusLine = "herdr: running an older version"
    public static let menuItem = "Restart herdr…"
    public static let confirmTitle = "Restart herdr?"
    public static let confirmButton = "Restart herdr"
    public static let cancelButton = "Cancel"
    public static let nothingTitle = "herdr does not need a restart"
    public static let nothingBody = "Every herdr server runs the installed version."
    public static let checkFailedTitle = "Couldn't check herdr's servers"
    public static let failedTitle = "Couldn't restart herdr"

    public static func confirmBody(_ stale: [String]) -> String {
        let one = stale.count == 1
        let servers = one ? "1 herdr server still runs" : "\(stale.count) herdr servers still run"
        return "\(servers) the older version: \(stale.joined(separator: ", ")). "
            + "Restarting ends every pane in \(one ? "it" : "them"), and any agent still working there stops. "
            + "Open herdr again to start on the new version."
    }
}
