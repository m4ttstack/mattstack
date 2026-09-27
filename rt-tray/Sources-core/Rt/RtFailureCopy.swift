import Foundation

public extension RtResult {
    /// Exit 2 without a decodable `{ "error": {...} }` envelope falls back to
    /// the raw stderr text, which for a verb whose stdin carried a secret can
    /// quote that secret straight back into the UI — so redacting callers get a
    /// fixed sentence instead. A real envelope is rt's own user-facing copy and
    /// is safe either way.
    func userError(redactStderr: Bool) -> RtUserError? {
        guard exitCode == 2 else { return nil }
        if let envelope = (try? JSONDecoder().decode(ErrorEnvelope.self, from: stdout))?.error {
            return envelope
        }
        return RtUserError(code: nil, message: redactStderr
            ? "rt couldn't complete the request; details withheld because the command carried a secret."
            : String(decoding: stderr.prefix(2000), as: UTF8.self))
    }

    /// Same shape as `failureCopy(verb:)`, but for actions whose stdin carried
    /// a secret (a connect token, an invite code): a misbehaving subprocess
    /// can echo its input on stderr, so the excerpt is withheld rather than
    /// shown or logged.
    func failureCopy(verb: String, redactStderr: Bool) -> String {
        guard redactStderr else { return failureCopy(verb: verb) }
        guard exitCode != 0 else { return "rt \(verb) returned an unexpected reply." }
        return "rt \(verb) failed (exit \(exitCode)); details withheld because the command carried a secret."
    }
}

public extension RtClientError {
    /// User-facing text — never the raw error description, which can carry
    /// a file path or other detail not meant for the setup UI.
    var copy: String {
        switch self {
        case .spawnFailed: return "rt failed to start."
        case .exited(let code, _): return "rt exited unexpectedly (exit \(code))."
        }
    }
}

public struct RtJSONFailure: Error, Equatable {
    public let copy: String
}

public extension RtRunning {
    /// Same failure shape everywhere a JSON verb is called: `userError`
    /// (exit 2) wins outright; any other non-zero exit, or a 0-exit reply
    /// that doesn't decode, falls to `failureCopy(verb:)` (rt's own
    /// stderr-derived copy, never a bare "unexpected reply" for an actual
    /// failure, since that sentence is `failureCopy`'s own 0-exit case);
    /// a thrown `RtClientError` (spawn failure) uses its `.copy`.
    func runJSON<T: Decodable>(_ args: [String], verb: String, as type: T.Type) async -> Result<T, RtJSONFailure> {
        do {
            let r = try await run(args, stdin: nil)
            if let e = r.userError { return .failure(RtJSONFailure(copy: e.message)) }
            guard r.exitCode == 0, let decoded = try? r.decode(T.self) else {
                return .failure(RtJSONFailure(copy: r.failureCopy(verb: verb)))
            }
            return .success(decoded)
        } catch {
            return .failure(RtJSONFailure(copy: (error as? RtClientError)?.copy ?? "rt \(verb) failed to start."))
        }
    }
}
