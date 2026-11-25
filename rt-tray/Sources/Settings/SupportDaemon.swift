import Foundation
import MattstackCore

/// The support verbs over rt's socket.
struct SupportDaemon: SupportCommanding, HelpCommanding {
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

    func availability() async -> SupportReply<HelpAvailability> {
        await call("support:availability", [:], Timeout.read, as: HelpAvailability.self)
    }

    func parts() async -> SupportReply<[HelpPart]> {
        struct Parts: Decodable, Sendable { let parts: [HelpPart] }
        switch await call("support:context", [:], Timeout.read, as: Parts.self) {
        case .value(let p): return .value(p.parts)
        case .refused(let message): return .refused(message)
        case .noAnswer: return .noAnswer
        }
    }

    func mine() async -> SupportReply<[HelpRequest]> {
        struct Mine: Decodable, Sendable { let requests: [HelpRequest] }
        switch await call("support:mine", [:], Timeout.read, as: Mine.self) {
        case .value(let m): return .value(m.requests)
        case .refused(let message): return .refused(message)
        case .noAnswer: return .noAnswer
        }
    }

    func send(id: String, text: String, parts: [HelpPart]) async -> HelpSend {
        struct Sent: Decodable { let request: HelpRequest }
        let payload: [String: Any] = ["id": id, "text": text, "parts": parts.map { ["key": $0.key, "label": $0.label, "value": $0.value] }]
        let reply: SocketReply<Reply<Sent>> = await DaemonClient().command("support:send", payload: payload, timeout: Timeout.write)
        guard let r = reply.value else { return .noAnswer }
        if r.ok, let data = r.data { return .sent(data.request) }
        if let f = r.failure, f.code.hasPrefix("support-") { return .refused(code: f.code, message: f.message) }
        return .noAnswer
    }

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
