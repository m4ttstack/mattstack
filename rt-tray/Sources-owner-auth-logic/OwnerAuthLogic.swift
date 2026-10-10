import Foundation

/// How macOS's owner check ended, as `rt-owner-auth` reports it to rt.
public enum OwnerAuthOutcome: Equatable, Sendable {
    case authenticated
    case cancelled
    case unavailable(String)
    case failed(String)
}

/// The helper's argv and exit contract, shared with
/// lib/agent-integrations/codex/owner-auth.ts: `--reason <text>` in; one word
/// on stdout and a matching exit code out. rt counts only exit 0 with
/// `authenticated`.
public enum OwnerAuthContract {
    public static let usageExit: Int32 = 64
    /// macOS shows the reason in its own sheet; a reason past this is not something a person could read there.
    public static let maxReasonLength = 300

    public enum Parsed: Equatable, Sendable {
        case reason(String)
        case usage(String)
    }

    /// `args` excludes argv[0].
    public static func parse(_ args: [String]) -> Parsed {
        guard args.count == 2, args[0] == "--reason" else { return .usage("usage: rt-owner-auth --reason <what is being approved>") }
        let reason = args[1].trimmingCharacters(in: .whitespacesAndNewlines)
        guard !reason.isEmpty else { return .usage("rt-owner-auth needs a reason to show") }
        guard reason.count <= maxReasonLength else { return .usage("rt-owner-auth's reason is longer than \(maxReasonLength) characters") }
        return .reason(reason)
    }

    public static func word(_ outcome: OwnerAuthOutcome) -> String {
        switch outcome {
        case .authenticated: return "authenticated"
        case .cancelled: return "cancelled"
        case .unavailable: return "unavailable"
        case .failed: return "failed"
        }
    }

    public static func exitCode(_ outcome: OwnerAuthOutcome) -> Int32 {
        switch outcome {
        case .authenticated: return 0
        case .cancelled: return 1
        case .unavailable: return 3
        case .failed: return 4
        }
    }

    /// The line for stderr, which rt quotes in its refusal.
    public static func message(_ outcome: OwnerAuthOutcome) -> String? {
        switch outcome {
        case .authenticated, .cancelled: return nil
        case .unavailable(let why), .failed(let why): return why
        }
    }

    // LAError.Code raw values; OwnerAuthChecks pins them to LocalAuthentication's own.
    public static let authenticationFailed = -1
    public static let userCancel = -2
    public static let userFallback = -3
    public static let systemCancel = -4
    public static let passcodeNotSet = -5
    public static let biometryNotAvailable = -6
    public static let biometryNotEnrolled = -7
    public static let biometryLockout = -8
    public static let appCancel = -9
    public static let notInteractive = -1004

    /// What an LAError code from `evaluatePolicy` means for rt.
    public static func outcome(forErrorCode code: Int) -> OwnerAuthOutcome {
        switch code {
        case userCancel, userFallback, systemCancel, appCancel: return .cancelled
        case passcodeNotSet: return .unavailable("No login password is set on this Mac")
        case notInteractive: return .unavailable("There is no screen session to show the prompt in")
        case biometryNotAvailable, biometryNotEnrolled, biometryLockout: return .unavailable("Neither Touch ID nor the password prompt is available")
        case authenticationFailed: return .failed("macOS could not confirm it was you")
        default: return .failed("macOS reported error \(code)")
        }
    }
}

/// LocalAuthentication behind a seam: each call answers nil for success or
/// the LAError code it failed with.
public protocol OwnerAuthenticator {
    func canEvaluate() -> Int?
    func evaluate(reason: String) -> Int?
}

public func runOwnerAuth(reason: String, with auth: OwnerAuthenticator) -> OwnerAuthOutcome {
    if let code = auth.canEvaluate() {
        switch OwnerAuthContract.outcome(forErrorCode: code) {
        case .unavailable(let why): return .unavailable(why)
        default: return .unavailable("macOS cannot ask for Touch ID or a password here (error \(code))")
        }
    }
    guard let code = auth.evaluate(reason: reason) else { return .authenticated }
    return OwnerAuthContract.outcome(forErrorCode: code)
}
