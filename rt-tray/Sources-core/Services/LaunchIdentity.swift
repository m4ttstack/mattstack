import Foundation

/// What the version detector compares across launches. A bundle replaced at
/// the same version (a dev rebuild) leaves its agents and served apps on the
/// old binary unless that counts as a change, so the main executable's
/// modification date is part of the identity.
public enum LaunchIdentity {
    public static func current(version: String, executableModified: Date?) -> String {
        guard let executableModified else { return version }
        return "\(version)@\(Int(executableModified.timeIntervalSince1970))"
    }
}
