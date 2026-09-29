import Foundation

public extension NeedRequest {
    /// What a row says while the app answers this request, since most of them wait on the person at the keyboard.
    var waitingCopy: String {
        switch type {
        case "app-privileged": return "Waiting for your admin password in the macOS dialog…"
        case "app-register-services", "app-unregister-services": return "Waiting for macOS to update mattstack's background items…"
        default: return "Waiting for mattstack to finish this step…"
        }
    }
}

/// A checklist row whose verb is `setup apply --only <step>` runs the same
/// NDJSON stream Install does, and its step can ask the app for work
/// (`proxy.install` raises the admin prompt). rt waits on the tray for that
/// outcome, so the row must perform the step's `need` events through
/// NeedPump; a buffered `run` leaves them unread until rt's own timeout.
public enum RowVerbRun {
    public static func streamsApplyEvents(_ args: [String]) -> Bool {
        args.starts(with: ["setup", "apply"])
    }

    private static let queue = SerialQueue()

    /// nil when the run succeeded, otherwise the copy to show under the row.
    /// `waiting` receives a need's `waitingCopy` while it is outstanding and
    /// nil once rt reports progress again. Runs one at a time: two rows'
    /// steps can touch the same files (path.link from PATH and shell rows).
    public static func apply(_ args: [String], rt: RtRunning, needs: NeedBroker,
                             waiting: @escaping @Sendable (String?) async -> Void) async -> String? {
        await queue.run { await applyNow(args, rt: rt, needs: needs, waiting: waiting) }
    }

    private static func onlyStep(_ args: [String]) -> String? {
        guard let i = args.firstIndex(of: "--only"), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    private static func applyNow(_ args: [String], rt: RtRunning, needs: NeedBroker,
                                 waiting: @escaping @Sendable (String?) async -> Void) async -> String? {
        let only = onlyStep(args)
        var onlyEnded: (state: StepState, detail: String?)?
        var stepFailure: String?
        var envelope: String?
        var succeeded: Bool?
        var thrown: Error?
        do {
            for try await line in NeedPump.performing(rt.stream(args, stdin: nil), needs: needs, forgetting: .ids(only.map { [$0] } ?? [])) {
                guard let event = try? ApplyEvent.decode(line) else {
                    if let e = try? JSONDecoder().decode(ErrorEnvelope.self, from: Data(line.utf8)) { envelope = e.error.message }
                    continue
                }
                switch event {
                case .need(_, let request):
                    await waiting(request.waitingCopy)
                case .step(let id, let state, let detail, let remedy):
                    await waiting(nil)
                    if id == only, state != .running { onlyEnded = (state, detail) }
                    if state == .failed {
                        stepFailure = [detail, remedy].compactMap { $0 }.filter { !$0.isEmpty }
                            .map { $0.hasSuffix(".") ? String($0.dropLast()) : $0 }.joined(separator: ". ")
                    }
                case .done(let ok, _):
                    succeeded = ok
                default:
                    break
                }
                // rt is finished at `done`; a need still being answered (an
                // admin dialog left open past rt's timeout) must not hold the row.
                if succeeded != nil { break }
            }
        } catch {
            thrown = error
        }
        await waiting(nil)
        if succeeded == true {
            // A row's button promises its step ran; `--only` exits clean when the step does not apply or skips.
            guard let only else { return nil }
            guard let ended = onlyEnded else { return "\(only) does not apply on this Mac right now, so nothing ran." }
            if ended.state == .skipped { return ended.detail.flatMap { $0.isEmpty ? nil : $0 } ?? "\(only) was skipped." }
            return nil
        }
        if let stepFailure, !stepFailure.isEmpty { return stepFailure }
        if let envelope { return envelope }
        if let e = thrown as? RtClientError { return e.copy }
        return succeeded == false ? "rt setup apply failed." : "rt setup apply ended without finishing."
    }
}

/// Runs async bodies one at a time, in arrival order.
actor SerialQueue {
    private var tail: Task<Void, Never>?

    func run<T: Sendable>(_ body: @escaping @Sendable () async -> T) async -> T {
        let previous = tail
        let task = Task<T, Never> {
            await previous?.value
            return await body()
        }
        tail = Task { _ = await task.value }
        return await task.value
    }
}
