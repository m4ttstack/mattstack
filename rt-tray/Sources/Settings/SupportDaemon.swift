import Foundation
import MattstackCore

/// `SupportCommanding` over rt's socket.
struct SupportDaemon: SupportCommanding {
    private struct Failure: Decodable { let code: String; let message: String }
    private struct Reply<T: Decodable>: Decodable {
        let ok: Bool
        let data: T?
        let failure: Failure?
    }
    private struct Ignored: Decodable {}

    /// Making the org's key encrypts for every member, which outlasts the daemon's own reads.
    private enum Timeout { static let read: TimeInterval = 60; static let write: TimeInterval = 120 }

    func host() async -> SupportReply<SupportHostView> {
        await call("support:host", [:], Timeout.read, as: SupportHostView.self)
    }

    func enable(on: Bool, host: String?) async -> SupportReply<Void> {
        var payload: [String: Any] = ["on": on]
        if let host { payload["host"] = host }
        return await change("support:enable", payload)
    }

    func accept(on: Bool) async -> SupportReply<Void> { await change("support:accept", ["on": on]) }

    private func change(_ verb: String, _ payload: [String: Any]) async -> SupportReply<Void> {
        switch await call(verb, payload, Timeout.write, as: Ignored.self) {
        case .value: return .value(())
        case .refused(let message): return .refused(message)
        case .noAnswer: return .noAnswer
        }
    }

    /// Only a refusal rt's support verbs made is fit to show a person.
    private func call<T: Decodable & Sendable>(_ verb: String, _ payload: [String: Any], _ timeout: TimeInterval, as: T.Type) async -> SupportReply<T> {
        let reply: SocketReply<Reply<T>> = await DaemonClient().command(verb, payload: payload, timeout: timeout)
        guard let r = reply.value else { return .noAnswer }
        if r.ok, let data = r.data { return .value(data) }
        if let f = r.failure, f.code.hasPrefix("support-") { return .refused(f.message) }
        return .noAnswer
    }
}
