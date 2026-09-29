import Foundation

/// Wraps an rt NDJSON run (`setup apply`, `uninstall`) so every `need` event
/// is performed on the app's NeedBroker as it arrives, then passed through to
/// the consumer unchanged.
///
/// rt blocks on `GET /setup/need/<id>` until the app records an outcome, so a
/// consumer that only renders the stream leaves rt polling until its own
/// 10-minute timeout and the run's app/privileged steps never happen. The
/// outcome itself reaches the consumer as rt's next `step` event for that id,
/// which is why nothing is injected into the stream here.
public enum NeedPump {
    /// Which recorded outcomes this run may clear before it starts.
    public enum Scope: Sendable {
        /// The run owns every id (uninstall).
        case all
        /// Other runs may be polling ids outside these (a checklist row's one step).
        case ids([String])
    }

    public static func performing(_ upstream: AsyncThrowingStream<String, Error>,
                                  needs: NeedBroker, forgetting scope: Scope = .all) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                // An outcome left by an earlier run would answer rt's poll
                // with work this run never did.
                switch scope {
                case .all: await needs.forgetAll()
                case .ids(let ids): await needs.forget(ids: ids)
                }
                // Performed alongside the stream, not inline: rt may give up
                // on a need (its own timeout) while the admin dialog is still
                // open, and its closing events must still reach the consumer.
                // The stream finishes only once every need has an outcome.
                var performing: [Task<Void, Never>] = []
                do {
                    for try await line in upstream {
                        continuation.yield(line)
                        guard case .need(let id, let request)? = try? ApplyEvent.decode(line) else { continue }
                        performing.append(Task { _ = await needs.perform(id: id, request: request) })
                    }
                    for p in performing { await p.value }
                    continuation.finish()
                } catch {
                    for p in performing { await p.value }
                    continuation.finish(throwing: error)
                }
            }
            // Cancelling the pump is what tears the upstream down: its own
            // onTermination is the hook that terminates rt.
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
