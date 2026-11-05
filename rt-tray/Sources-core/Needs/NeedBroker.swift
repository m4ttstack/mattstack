import Foundation

/// What rt polls at `GET /setup/need/<id>` while it waits for the app.
public struct NeedOutcome: Codable, Equatable, Sendable {
    public var state: String   // pending | done | failed
    public var detail: String
    public init(state: String, detail: String) { self.state = state; self.detail = detail }
    public static let pending = NeedOutcome(state: "pending", detail: "waiting for the app")
}

/// Executes rt's `need` events exactly once per step id and records the
/// outcome for rt's 1 s poll. Concurrent callers for one id join the same
/// execution; an id nobody has performed yet reads as pending so rt keeps
/// polling until its own 10-minute timeout instead of being told a story.
public actor NeedBroker {
    private struct Call { let token: UUID; let task: Task<NeedResult, Never> }
    private struct Dialog { let op: String?; let task: Task<NeedResult, Never> }

    private let services: ServicesProviding
    private let privileged: PrivilegedInstalling
    private var inFlight: [String: Call] = [:]
    private var outcomes: [String: NeedOutcome] = [:]
    /// The admin dialog on screen, kept across `forget`: a retry must not
    /// stack a second dialog over one the user has not answered yet.
    private var dialog: Dialog?

    public init(services: ServicesProviding, privileged: PrivilegedInstalling) {
        self.services = services
        self.privileged = privileged
    }

    public func outcome(id: String) -> NeedOutcome { outcomes[id] ?? .pending }

    public func perform(id: String, request: NeedRequest) async -> NeedResult {
        if let call = inFlight[id] { return await call.task.value }
        outcomes[id] = .pending
        let task = request.type == "app-privileged" ? privilegedTask(request) : ordinaryTask(request)
        let token = UUID()
        inFlight[id] = Call(token: token, task: task)
        let result = await task.value
        // A forget (Retry) during the await hands this id to a newer run; only
        // the call that still owns it may answer rt's poll.
        if inFlight[id]?.token == token {
            outcomes[id] = NeedOutcome(state: result.ok ? "done" : "failed", detail: result.detail)
        }
        return result
    }

    /// tray.sock's direct privileged routes, for an rt the app did not spawn:
    /// no need id is recorded, but the one admin dialog is shared all the same.
    public func performPrivileged(op: String) async -> NeedResult {
        await privilegedTask(NeedRequest(type: "app-privileged", plists: nil, op: op)).value
    }

    private func privilegedTask(_ request: NeedRequest) -> Task<NeedResult, Never> {
        let open = dialog
        if let open, open.op == request.op { return open.task }
        let privileged = self.privileged
        let task = Task<NeedResult, Never> {
            if let open { _ = await open.task.value }
            switch request.op {
            case "proxy-install": return await privileged.proxyInstall()
            case "proxy-remove": return await privileged.proxyRemove()
            case "proxy-trust": return await privileged.proxyTrust()
            default: return NeedResult(ok: false, detail: "unknown need type app-privileged\(request.op.map { "/\($0)" } ?? "")")
            }
        }
        dialog = Dialog(op: request.op, task: task)
        Task { _ = await task.value; self.dialogClosed(task) }
        return task
    }

    private func dialogClosed(_ task: Task<NeedResult, Never>) {
        if dialog?.task == task { dialog = nil }
    }

    private func ordinaryTask(_ request: NeedRequest) -> Task<NeedResult, Never> {
        let services = self.services
        return Task<NeedResult, Never> {
            switch request.type {
            case "app-register-services":
                let results = await services.register(plists: request.plists ?? [])
                let failed = results.filter { !$0.ok }
                if failed.isEmpty {
                    return NeedResult(ok: true, detail: results.map { "\($0.plist): \($0.status)" }.joined(separator: ", "))
                }
                return NeedResult(ok: false, detail: failed.map { "\($0.plist): \($0.error ?? $0.status)" }.joined(separator: "; "))
            case "app-unregister-services":
                let results = await services.unregister(plists: request.plists ?? [])
                let failed = results.filter { !$0.ok }
                if failed.isEmpty {
                    return NeedResult(ok: true, detail: results.map { "\($0.plist): \($0.status)" }.joined(separator: ", "))
                }
                return NeedResult(ok: false, detail: failed.map { "\($0.plist): \($0.error ?? $0.status)" }.joined(separator: "; "))
            default:
                return NeedResult(ok: false, detail: "unknown need type \(request.type)\(request.op.map { "/\($0)" } ?? "")")
            }
        }
    }

    /// A retry (`setup apply --from`) must be allowed to redo a step.
    public func forget(id: String) { inFlight[id] = nil; outcomes[id] = nil }
    /// A row run owns only its own step's ids; other runs may be polling theirs.
    public func forget(ids: [String]) { ids.forEach { forget(id: $0) } }
    public func forgetAll() { inFlight.removeAll(); outcomes.removeAll() }
}
