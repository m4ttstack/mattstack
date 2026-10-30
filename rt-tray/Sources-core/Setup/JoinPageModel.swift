import Foundation
import Combine

/// `rt setup join-status --json`.
public struct JoinStatus: Decodable, Equatable, Sendable {
    public struct Team: Decodable, Equatable, Sendable {
        public var slug: String
        public var name: String
    }
    public struct Uses: Decodable, Equatable, Sendable {
        public var repos: Int
        public var accounts: Int
        public var packs: Int
        public init(repos: Int, accounts: Int, packs: Int) { self.repos = repos; self.accounts = accounts; self.packs = packs }
    }
    public struct Pull: Decodable, Equatable, Sendable {
        public var outcome: String
        public var detail: String
    }
    public var team: Team
    /// not-joined | waiting | approved | unreadable
    public var state: String
    public var since: String?
    public var uses: Uses
    public var pull: Pull
}

/// The joiner's own setup step: connect the team repo's token, run
/// `team.join`, then hold until the admin approves this Mac.
@MainActor
public final class JoinPageModel: ObservableObject {
    public enum Phase: Equatable {
        case needsToken, ready, joining
        case failed(detail: String, remedy: String?)
        case waiting(JoinStatus)
        /// rt cannot tell whether the admin approved, so the page lets the person on.
        case unreadable(JoinStatus)
        case approved(team: String)
    }

    @Published public private(set) var phase: Phase = .needsToken
    /// Outlives the wait, so the approved page still names the team and what it uses.
    @Published public private(set) var lastStatus: JoinStatus?
    /// The last check rt could not answer; the phase it had stays on screen.
    @Published public private(set) var checkError: String?
    @Published public private(set) var logLines: [String] = []
    @Published public private(set) var needWaiting: String?
    @Published public private(set) var isChecking = false
    /// The redeem is done: a failure from here on is the check's, so the page offers Check again, never a second redeem.
    @Published public private(set) var joinLanded = false

    public nonisolated static let joinVerb = ["setup", "apply", "--only", "team.join", "--json"]
    public nonisolated static let statusVerb = ["setup", "join-status", "--json"]
    static let notJoinedRemedy = "Go back and join with your invite again"

    private let rt: RtRunning
    private let needs: NeedBroker
    private let clock: @Sendable () -> Date
    private var pollTask: Task<Void, Never>?
    /// Bumped by reset and join: a check answered under an older value is dropped.
    private var generation = 0
    private var checksInFlight = 0

    public init(rt: RtRunning, needs: NeedBroker, clock: @escaping @Sendable () -> Date = Date.init) {
        self.rt = rt; self.needs = needs; self.clock = clock
    }

    public var continueEnabled: Bool {
        switch phase {
        case .approved, .unreadable: return true
        default: return false
        }
    }

    public var isAwaitingApproval: Bool {
        switch phase {
        case .waiting, .unreadable: return true
        default: return false
        }
    }

    /// "5 minutes ago" for the waiting line; nil when rt has no join time.
    public var waitingSince: String? {
        guard case .waiting(let status) = phase, let since = status.since, let date = Self.parseDate(since) else { return nil }
        return Self.sinceText(date, now: clock())
    }

    /// Only moves the page between its two pre-join states.
    public func update(teamRepoRow row: PlanRow?) {
        guard phase == .needsToken || phase == .ready else { return }
        phase = row?.status == .ready ? .ready : .needsToken
    }

    /// Another pass through Your team is another invite, which replaces the pending join.
    public func reset() {
        generation += 1
        phase = .needsToken
        lastStatus = nil
        checkError = nil
        logLines = []
        needWaiting = nil
        joinLanded = false
    }

    /// A Mac found waiting at launch arrives here already joined.
    public func adopt(_ status: JoinStatus) {
        joinLanded = true
        checkError = nil
        apply(status)
    }

    public func join() async {
        guard phase != .joining else { return }
        generation += 1
        let mine = generation
        phase = .joining
        logLines = []
        checkError = nil
        let failure = await RowVerbRun.apply(Self.joinVerb, rt: rt, needs: needs,
                                             waiting: { [weak self] copy in await self?.setNeedWaiting(copy) },
                                             log: { [weak self] line in await self?.appendLog(line) })
        guard mine == generation else { return }
        needWaiting = nil
        if let failure {
            phase = .failed(detail: failure, remedy: nil)
            return
        }
        joinLanded = true
        // Never skipped for a poll in flight: that poll's answer is dropped, and only this one can leave Joining.
        await runCheck()
        if mine == generation, phase == .joining, let checkError {
            phase = .failed(detail: checkError, remedy: nil)
        }
    }

    public func check() async {
        guard !isChecking else { return }
        await runCheck()
    }

    private func runCheck() async {
        let mine = generation
        checksInFlight += 1
        isChecking = true
        defer {
            checksInFlight -= 1
            isChecking = checksInFlight > 0
        }
        let verb = "setup join-status"
        let result: RtResult
        do {
            result = try await rt.run(Self.statusVerb, stdin: nil)
        } catch {
            guard mine == generation else { return }
            checkError = (error as? RtClientError)?.copy ?? "rt \(verb) failed to start."
            return
        }
        guard mine == generation else { return }
        if let e = result.userError, e.code != nil {
            if e.code == "no-join" {
                checkError = nil
                phase = .failed(detail: e.message, remedy: Self.notJoinedRemedy)
            } else {
                checkError = e.message
            }
            return
        }
        guard result.exitCode == 0, let status = try? result.decode(JoinStatus.self) else {
            checkError = result.failureCopy(verb: verb)
            return
        }
        checkError = nil
        if status.state == "not-joined" {
            phase = .failed(detail: result.failureCopy(verb: verb), remedy: Self.notJoinedRemedy)
            return
        }
        apply(status)
    }

    public enum LaunchJoin: Equatable, Sendable {
        case joined(JoinStatus)
        /// The invite is on disk but the join never landed: the Join page is still to do.
        case unredeemed
    }

    /// A first-run window that opens on the checklist asks this first. Any
    /// other refusal or failure reads as not joining, so the checklist opens as before.
    public nonisolated static func launchStatus(rt: RtRunning) async -> LaunchJoin? {
        guard let r = try? await rt.run(statusVerb, stdin: nil) else { return nil }
        if r.userError?.code == "join-unredeemed" { return .unredeemed }
        guard r.exitCode == 0, let status = try? r.decode(JoinStatus.self) else { return nil }
        return .joined(status)
    }

    public func startPolling(every seconds: TimeInterval = 15) {
        stopPolling()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                guard !Task.isCancelled, let self else { return }
                if self.isAwaitingApproval { await self.check() }
                if case .approved = self.phase { self.pollTask = nil; return }
            }
        }
    }

    public var isPolling: Bool { pollTask != nil }

    public func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    private func apply(_ status: JoinStatus) {
        lastStatus = status
        switch status.state {
        case "approved": phase = .approved(team: status.team.name)
        case "waiting": phase = .waiting(status)
        default: phase = .unreadable(status)
        }
    }

    private func setNeedWaiting(_ copy: String?) { needWaiting = copy }
    private func appendLog(_ line: String) { logLines.append(line) }

    public nonisolated static func usesText(_ uses: JoinStatus.Uses) -> String {
        [(uses.repos, "repo"), (uses.accounts, "account"), (uses.packs, "pack")]
            .filter { $0.0 > 0 }
            .map { "\($0.0) \($0.1)\($0.0 == 1 ? "" : "s")" }
            .joined(separator: ", ")
    }

    public nonisolated static func sinceText(_ since: Date, now: Date) -> String {
        let seconds = Int(now.timeIntervalSince(since))
        func ago(_ n: Int, _ unit: String) -> String { "\(n) \(unit)\(n == 1 ? "" : "s") ago" }
        if seconds < 60 { return "just now" }
        if seconds < 3600 { return ago(seconds / 60, "minute") }
        if seconds < 86400 { return ago(seconds / 3600, "hour") }
        return ago(seconds / 86400, "day")
    }

    nonisolated static func parseDate(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }
}
