import Foundation

public struct LogViewerWaitDeps: Sendable {
    public var isUp: @Sendable () async -> Bool
    /// nil while `rt daemon logs` is still running.
    public var exitStatus: @Sendable () -> Int32?
    public var output: @Sendable () -> (stderr: String, stdout: String)
    public var sleep: @Sendable () async -> Void

    public init(isUp: @escaping @Sendable () async -> Bool,
                exitStatus: @escaping @Sendable () -> Int32?,
                output: @escaping @Sendable () -> (stderr: String, stdout: String),
                sleep: @escaping @Sendable () async -> Void) {
        self.isUp = isUp
        self.exitStatus = exitStatus
        self.output = output
        self.sleep = sleep
    }
}

/// The tray's View Logs launch: it spawns `rt daemon logs` and opens the
/// viewer itself, so rt is told not to open a second browser tab.
public enum LogViewerLaunch {
    public static let url = URL(string: "http://localhost:5544")!
    public static let rtArguments = ["daemon", "logs", "--no-open"]
    public static let loginShellCommand = "exec rt daemon logs --no-open"
    public static let timedOutReason = "logdy never answered on :5544"

    public enum Outcome: Equatable, Sendable {
        case open
        case failed(reason: String)
        case timedOut
    }

    /// rt stays attached for as long as logdy runs, so rt exiting before the
    /// port answers means there is no viewer to open, whatever its status.
    public static func awaitViewer(_ deps: LogViewerWaitDeps, attempts: Int) async -> Outcome {
        for _ in 0..<attempts {
            await deps.sleep()
            if await deps.isUp() { return .open }
            if let status = deps.exitStatus() {
                let out = deps.output()
                return .failed(reason: reason(stderr: out.stderr, stdout: out.stdout, status: status))
            }
        }
        return .timedOut
    }

    static func reason(stderr: String, stdout: String, status: Int32) -> String {
        firstLine(stderr) ?? firstLine(stdout) ?? "rt daemon logs exited \(status) without starting logdy"
    }

    private static func firstLine(_ text: String) -> String? {
        let plain = text.replacingOccurrences(of: "\u{1B}\\[[0-9;]*m", with: "", options: .regularExpression)
        return plain.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
    }
}
