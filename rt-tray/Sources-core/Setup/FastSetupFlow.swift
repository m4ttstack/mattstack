import Foundation
import Combine

public enum FastSetupScreen: String, CaseIterable, Sendable {
    case loading, macos, path, invite
    case createTeam = "create-team"
    case restore, waiting, connect
    case thisMac = "this-mac"
    case running, paused, ready

    /// The `rt setup form --section` this screen draws; nil for a screen with no rows.
    public var section: String? {
        switch self {
        case .macos: return "macos"
        case .invite: return "invite"
        case .createTeam: return "create"
        case .restore: return "restore"
        case .connect: return "connect"
        case .thisMac: return "this-mac"
        case .loading, .path, .waiting, .running, .paused, .ready: return nil
        }
    }
}

public struct SetupNotice: Equatable, Sendable {
    public var title: String
    public var body: String
    public init(title: String, body: String) { self.title = title; self.body = body }
}

/// Where the app picks setup up: whether it opens, as what, and whether the bar starts.
public enum FastSetupLaunch {
    /// rt holds the run record, so this app only attaches to or resumes it, and never starts a second over a live one.
    public static func startsRun(stage: FormStage, runLive: Bool) -> Bool {
        stage == .running && !runLive
    }

    /// `attended` is asked at each spawn: true when a person's Retry, not a launch or a relaunch, started it.
    public static func installStream(rt: RtRunning, attended: @escaping @Sendable () -> Bool = { false }) -> ApplyStreamFactory {
        { from in rt.stream(FastSetupRun.arguments(retryFrom: from, attended: attended()), stdin: nil) }
    }

    /// Setup status on a Mac that never finished is the first run, which still offers Just me; a finished Mac opens as status.
    public static func entry(_ requested: SetupEntry, finished: Bool) -> SetupEntry {
        switch requested {
        case .status, .firstRun: return finished ? .status : .firstRun
        case .upgrade: return .upgrade
        }
    }

    /// The banner for a run that ended while the window was not in front.
    public static func runEndNotice(stage: FormStage, paused: FormPaused?) -> SetupNotice? {
        switch stage {
        case .ready: return SetupNotice(title: "This Mac is ready", body: "Go make something cool")
        case .paused: return SetupNotice(title: "Setup paused", body: paused?.title ?? "")
        default: return nil
        }
    }

    public static let approvedNotice = SetupNotice(title: "You're in", body: "A few questions, then it runs by itself")

    /// When the run rt still holds began, from `run.startedAt` in setup-state.json, so a relaunch keeps the bar's time left honest.
    public static func runStartedAt(stateJSON: Data?) -> Date? {
        guard let stateJSON,
              let state = (try? JSONSerialization.jsonObject(with: stateJSON)) as? [String: Any],
              let run = state["run"] as? [String: Any], run["endedAt"] == nil,
              let startedAt = run["startedAt"] as? String else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: startedAt) ?? ISO8601DateFormatter().date(from: startedAt)
    }
}

/// Which fast-setup screen is up. rt's stage decides where setup resumes:
/// `land(on:)` always wins, and the other moves only cover the steps between
/// two whole-form reads.
@MainActor
public final class FastSetupFlow: ObservableObject {
    @Published public private(set) var screen: FastSetupScreen = .loading
    @Published public var entry: SetupEntry
    /// An upgrade's Join or Create, from Settings.
    public var requested: TeamChoice?
    /// Set only by a card picked in this window: a relaunch onto accounts has no cards behind it.
    private var chosen: TeamChoice?

    public init(entry: SetupEntry = .firstRun) { self.entry = entry }

    public nonisolated static func screen(for stage: FormStage) -> FastSetupScreen {
        switch stage {
        case .macos: return .macos
        case .path: return .path
        case .invite: return .invite
        case .waiting: return .waiting
        case .connect: return .connect
        case .thisMac: return .thisMac
        case .running: return .running
        case .paused: return .paused
        case .ready: return .ready
        }
    }

    /// An empty list is done, so a section with nothing to wait on never holds a button.
    public nonisolated static func allDone(_ rows: [FormRow]) -> Bool {
        rows.allSatisfy { $0.optional || $0.state == .done }
    }

    /// The invite read holds Join until it is good, then rt's rows do. Before
    /// rt's invite section arrives (nil) nothing says whether a token row is coming.
    public nonisolated static func joinEnabled(verdictOK: Bool, rows: [FormRow]?) -> Bool {
        guard verdictOK, let rows else { return false }
        return allDone(rows)
    }

    /// Create team waits on the screen's name and group, then on rt's create rows.
    /// Before rt's create section arrives (nil) nothing says whether git or a token is still missing.
    public nonisolated static func createEnabled(nameAndGroup: Bool, rows: [FormRow]?) -> Bool {
        guard nameAndGroup, let rows else { return false }
        return allDone(rows)
    }

    /// Restore waits on the backup repo and the recovery key, then on rt's restore rows.
    /// Before rt's restore section arrives (nil) nothing says whether git is still missing.
    public nonisolated static func restoreEnabled(repo: String, key: String, rows: [FormRow]?) -> Bool {
        guard !repo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let rows else { return false }
        return allDone(rows)
    }

    /// What moves P1 on. Before the first read, or with nothing to show, P1 stays put.
    public nonisolated static func macosReady(_ rows: [FormRow]?) -> Bool {
        guard let rows, !rows.isEmpty else { return false }
        return allDone(rows)
    }

    /// `stage` comes from a whole-form read only: a section read carries none.
    /// A finished Mac whose Join or Create from Settings has not started yet
    /// still reads `ready`; once the join is in flight rt says so itself.
    public func land(on stage: FormStage) {
        if let c = chosen, stage != .path, Self.screen(for: stage) != Self.start(of: c) { chosen = nil }
        if stage == .ready, let target = requestedScreen {
            screen = target
        } else {
            screen = Self.screen(for: stage)
        }
    }

    /// Off a first run, only rt knows where a Mac that already got past the cards resumes:
    /// `.loading` asks the coordinator for a whole-form read.
    public func macosDone() {
        screen = requestedScreen ?? (entry == .firstRun ? .path : .loading)
    }

    public func choose(_ c: TeamChoice) {
        chosen = c
        screen = Self.start(of: c)
    }

    public func joined() { requested = nil; screen = .waiting }
    public func approved() { chosen = nil; screen = .connect }

    /// The team admin approved. A join approved at once never reached the wait, so the invite moves on
    /// too; a Mac already past both stays where it is.
    @discardableResult
    public func joinApproved() -> Bool {
        guard screen == .invite || screen == .waiting else { return false }
        requested = nil
        approved()
        return true
    }
    public func created() { requested = nil; chosen = nil; screen = .connect }
    public func restored() { screen = .running }
    public func continueToThisMac() { screen = .thisMac }
    public func startRun() { screen = .running }
    public func retry() { screen = .running }

    /// Unlike `land(on:)`, never reopens an upgrade's requested screen: the run it asked for is over.
    public func runEnded(stage: FormStage) {
        requested = nil
        chosen = nil
        screen = Self.screen(for: stage)
    }

    /// Reads the whole form and lands on rt's stage. A read rt could not answer, or one with no stage, moves nothing.
    @discardableResult
    public func land(reading form: SetupFormModel) async -> SetupForm? {
        guard let read = await form.load(section: nil), let stage = read.stage else { return nil }
        land(on: stage)
        return read
    }

    /// A run ended: rt's whole read says where it stopped.
    @discardableResult
    public func landAfterRun(reading form: SetupFormModel) async -> SetupForm? {
        guard let read = await form.load(section: nil), let stage = read.stage else { return nil }
        runEnded(stage: stage)
        return read
    }

    public var canGoBack: Bool {
        switch screen {
        case .invite, .createTeam, .restore: return entry == .firstRun
        case .thisMac: return true
        case .connect: return entry == .firstRun && chosen == .solo
        default: return false
        }
    }

    public func back() {
        guard canGoBack else { return }
        switch screen {
        case .thisMac: screen = .connect
        default: chosen = nil; screen = .path
        }
    }

    /// The primary button on these closes the window; setup carries on behind it.
    public var hidesOnPrimary: Bool { screen == .waiting || screen == .running }

    private var requestedScreen: FastSetupScreen? {
        guard entry == .upgrade, let requested, requested == .join || requested == .create else { return nil }
        return Self.start(of: requested)
    }

    private nonisolated static func start(of choice: TeamChoice) -> FastSetupScreen {
        switch choice {
        case .join: return .invite
        case .create: return .createTeam
        case .restore: return .restore
        case .solo: return .connect
        }
    }
}
