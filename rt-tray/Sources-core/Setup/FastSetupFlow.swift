import Foundation
import Combine

public enum FastSetupScreen: String, CaseIterable, Sendable {
    case loading, macos, path, invite
    case createTeam = "create-team"
    case restore, waiting, connect
    case thisMac = "this-mac"
    case running, paused, ready
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

    /// The invite read holds Join until it is good, then rt's rows do.
    public nonisolated static func joinEnabled(verdictOK: Bool, rows: [FormRow]) -> Bool {
        verdictOK && allDone(rows)
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
