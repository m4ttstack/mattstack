import Foundation

/// The two update notifications: an update waiting to install, and one that
/// finished. The app records the version it is installing before Sparkle
/// quits it, and the next launch compares that with the version running.
public enum UpdateNotice {
    public static let pendingVersionKey = "MSUpdatePendingVersion"

    public struct Copy: Equatable, Sendable {
        public let title: String
        public let body: String
        public init(title: String, body: String) {
            self.title = title
            self.body = body
        }
    }

    public enum LaunchOutcome: Equatable, Sendable {
        case none
        case installed(String)
        case stillPending
    }

    public static func launch(pendingVersion: String?, runningVersion: String) -> LaunchOutcome {
        guard let pendingVersion else { return .none }
        return pendingVersion == runningVersion ? .installed(runningVersion) : .stillPending
    }

    public static func installed(version: String) -> Copy {
        Copy(title: "mattstack updated to \(version)", body: "Restarted on the new version")
    }

    public static func waiting(version: String, hold: UpdateHold) -> Copy {
        let body: String
        switch hold {
        case .windowsOpen: body = "Installs when you close mattstack's windows"
        case .setupRunning: body = "Installs once setup finishes and mattstack's windows close"
        }
        return Copy(title: "mattstack \(version) is ready", body: body)
    }
}
