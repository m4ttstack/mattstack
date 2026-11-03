import Foundation
import Combine

/// The native side of a form row's action: what only the app can do.
public protocol FormEffects: Sendable {
    @MainActor func openURL(_ url: URL)
    @MainActor func openSettings(_ target: String)
    func requestPermission(_ which: String) async -> Bool
}

/// What a fast screen presents for a row whose action needs more than a press.
public enum FormSheet: Identifiable, Equatable, Sendable {
    /// rt's own steps for something only the person can do, such as a terminal command.
    case steps(FormRow, [String])
    /// A pick from more options than a segment holds.
    case choose(FormRow)

    public var id: String {
        switch self {
        case .steps(let row, _): return "steps:\(row.id)"
        case .choose(let row): return "choose:\(row.id)"
        }
    }
}

/// How the fast screens carry out a row's action.
public enum FormActionControl: Equatable, Sendable {
    /// The press itself does it: an rt verb, a page, a settings pane, a permission prompt.
    case press
    /// The press opens a `FormSheet`.
    case sheet
    /// The row draws its own control: fields, a folder panel, a repo placement.
    case inRow
    /// Nothing this app can do: a type from a newer rt, or an action missing what it needs.
    case none
}

/// Performs a fast-setup row's action and holds its wait or error until rt's
/// next read. Neither is a row state: `reconcile` drops both once rt says
/// the row is done.
@MainActor
public final class FormActionRunner: ObservableObject {
    @Published public private(set) var waiting: [String: String] = [:]
    @Published public private(set) var errors: [String: String] = [:]
    /// The sheet a fast screen is presenting for a row; the screen sets it back to nil when it closes.
    @Published public var sheet: FormSheet?

    public nonisolated static func control(for action: RowAction) -> FormActionControl {
        switch RowActionDispatcher.dispatch(action, fieldValues: nil, alternative: nil) {
        case .openURL, .openSettings, .requestPermission, .rtVerb: return .press
        case .showSteps, .chooseOption: return .sheet
        case .collectFields(let fields, _, _, _): return fields.isEmpty ? .none : .inRow
        case .chooseFolder, .placeRepo: return .inRow
        case .none: return .none
        }
    }

    /// rt holds a connect verb up to 10 s and `setup claude code` up to 30 s before it answers.
    public nonisolated static let signInTimeout: TimeInterval = 60
    /// An `oauth` verb (Connect Slack) listens for the browser's callback for 5 minutes, so it outlasts that.
    public nonisolated static let oauthTimeout: TimeInterval = 330

    /// Rows whose rt verb is still running. A second press waits on the first: a second
    /// `setup slack connect` would open a second Allow tab on a callback port already taken.
    @Published public private(set) var running: Set<String> = []

    private let rt: RtRunning
    private let needs: NeedBroker
    private let effects: FormEffects
    private let signInTimeoutSeconds: TimeInterval
    private let oauthTimeoutSeconds: TimeInterval
    private let reload: @MainActor () async -> Void

    public init(rt: RtRunning, needs: NeedBroker, effects: FormEffects,
                signInTimeout: TimeInterval = FormActionRunner.signInTimeout,
                oauthTimeout: TimeInterval = FormActionRunner.oauthTimeout,
                reload: @escaping @MainActor () async -> Void) {
        self.rt = rt; self.needs = needs; self.effects = effects
        self.signInTimeoutSeconds = signInTimeout; self.oauthTimeoutSeconds = oauthTimeout; self.reload = reload
    }

    public func perform(_ row: FormRow, values: [String: String]? = nil, alternative: String? = nil) async {
        let dispatched = row.action.map { RowActionDispatcher.dispatch($0, fieldValues: values, alternative: alternative) }
        if case .rtVerb = dispatched, running.contains(row.id) { return }
        errors[row.id] = nil
        if let action = row.action, let dispatched {
            switch dispatched {
            case .openURL(let url):
                effects.openURL(url)
                if let line = row.waiting { waiting[row.id] = line }
            case .openSettings(let target):
                effects.openSettings(target)
            case .requestPermission(let which):
                _ = await effects.requestPermission(which)
            case .rtVerb(let args, let stdin):
                running.insert(row.id)
                let placed = await runVerb(args, stdin: stdin, row: row)
                if placed, action.type == .placeRepo, let then = action.then, !then.isEmpty {
                    _ = await runVerb(then + ["--json"], stdin: nil, row: row)
                }
                running.remove(row.id)
            case .showSteps(let steps):
                sheet = .steps(row, steps)
                return
            case .chooseOption:
                sheet = .choose(row)
                return
            case .chooseFolder, .collectFields, .placeRepo, .none:
                break
            }
        }
        await reload()
    }

    /// The person closed a sheet: whatever it asked them to do may have landed by now.
    public func sheetClosed() async {
        sheet = nil
        await reload()
    }

    /// A choose sheet's pick. rt's refusal comes back for the sheet to show.
    public func choose(_ row: FormRow, id: String) async -> String? {
        await perform(row, values: ["id": id])
        return errors[row.id]
    }

    public func reconcile(with rows: [FormRow]) {
        for row in rows where row.state == .done {
            waiting[row.id] = nil
            errors[row.id] = nil
        }
    }

    /// True when rt answered without an error.
    private func runVerb(_ args: [String], stdin: Data?, row: FormRow) async -> Bool {
        if RowVerbRun.streamsApplyEvents(args) {
            let id = row.id, fallback = row.waiting
            waiting[id] = fallback
            let failure = await RowVerbRun.apply(args, rt: rt, needs: needs) { [weak self] copy in
                await self?.show(copy ?? fallback, on: id)
            }
            waiting[id] = nil
            if let failure { errors[id] = failure; return false }
            return true
        }

        waiting[row.id] = row.waiting
        let timeout = row.action?.type == .oauth ? oauthTimeoutSeconds : (Self.isSignIn(args) ? signInTimeoutSeconds : nil)
        let answer = await run(args, stdin: stdin, timeout: timeout)
        waiting[row.id] = nil
        switch answer {
        case .timedOut:
            return false
        case .failed(let error):
            errors[row.id] = (error as? RtClientError ?? .spawnFailed("")).copy
            return false
        case .answered(let result):
            // A token or code rides on stdin, and a misbehaving rt can echo it on stderr.
            let redact = stdin != nil
            if let userError = result.userError(redactStderr: redact) {
                errors[row.id] = userError.message
                return false
            }
            if let connect = try? result.decode(ConnectResult.self) {
                switch connect.status {
                case .invalid, .error:
                    errors[row.id] = connect.detail ?? result.failureCopy(verb: Self.verbName(args), redactStderr: redact)
                    return false
                case .needsYou:
                    if let line = connect.detail ?? row.waiting { waiting[row.id] = line }
                    if let page = connect.url.flatMap(URL.init(string:)) { effects.openURL(page) }
                    return true
                default:
                    return true
                }
            }
            if result.exitCode != 0 {
                errors[row.id] = result.failureCopy(verb: Self.verbName(args), redactStderr: redact)
                return false
            }
            return true
        }
    }

    private func show(_ line: String?, on id: String) { waiting[id] = line }

    private enum Answer: Sendable {
        case answered(RtResult)
        case failed(Error)
        case timedOut
    }

    /// `RtRunning.run` has no timeout and cannot be cancelled, so a late
    /// answer is dropped rather than awaited.
    private func run(_ args: [String], stdin: Data?, timeout: TimeInterval?) async -> Answer {
        let rt = self.rt
        return await withCheckedContinuation { (cont: CheckedContinuation<Answer, Never>) in
            let once = ResumeOnce(cont)
            Task {
                do { once.resume(.answered(try await rt.run(args, stdin: stdin))) } catch { once.resume(.failed(error)) }
            }
            if let timeout {
                Task {
                    try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                    once.resume(.timedOut)
                }
            }
        }
    }

    private nonisolated static func isSignIn(_ args: [String]) -> Bool {
        args.count >= 3 && args[0] == "setup" && ["connect", "code", "create-app", "sign-in"].contains(args[2])
    }

    private nonisolated static func verbName(_ args: [String]) -> String {
        args.filter { $0 != "--json" }.joined(separator: " ")
    }

    private final class ResumeOnce: @unchecked Sendable {
        private let lock = NSLock()
        private var cont: CheckedContinuation<Answer, Never>?
        init(_ cont: CheckedContinuation<Answer, Never>) { self.cont = cont }
        func resume(_ answer: Answer) {
            lock.lock(); let c = cont; cont = nil; lock.unlock()
            c?.resume(returning: answer)
        }
    }
}
