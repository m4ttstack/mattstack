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

    /// nil when the run succeeded, otherwise the copy to show under the row.
    /// `waiting` receives a need's `waitingCopy` while it is outstanding and
    /// nil once rt reports progress again.
    public static func apply(_ args: [String], rt: RtRunning, needs: NeedBroker,
                             waiting: @escaping @Sendable (String?) async -> Void) async -> String? {
        var stepFailure: String?
        var envelope: String?
        var succeeded: Bool?
        var thrown: Error?
        do {
            for try await line in NeedPump.performing(rt.stream(args, stdin: nil), needs: needs) {
                guard let event = try? ApplyEvent.decode(line) else {
                    if let e = try? JSONDecoder().decode(ErrorEnvelope.self, from: Data(line.utf8)) { envelope = e.error.message }
                    continue
                }
                switch event {
                case .need(_, let request):
                    await waiting(request.waitingCopy)
                case .step(_, let state, let detail, let remedy):
                    await waiting(nil)
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
        if succeeded == true { return nil }
        if let stepFailure, !stepFailure.isEmpty { return stepFailure }
        if let envelope { return envelope }
        if let e = thrown as? RtClientError { return e.copy }
        return succeeded == false ? "rt setup apply failed." : "rt setup apply ended without finishing."
    }
}
