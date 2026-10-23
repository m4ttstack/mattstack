import Foundation
import UserNotifications

/// The tray plays its alert tones through NSSound, outside the notification
/// system, so macOS never applies the app's own notification settings to
/// them. This is the gate that applies them by hand.
public enum NotificationSound {

    public static func shouldPlay(authorization: UNAuthorizationStatus, sound: UNNotificationSetting) -> Bool {
        switch authorization {
        case .authorized, .provisional, .ephemeral:
            return sound == .enabled
        case .denied, .notDetermined:
            return false
        @unknown default:
            return false
        }
    }
}

/// Severity tiers behind the alert tones. A burst of notifications plays the
/// highest tier it contains, once.
public enum SoundTier: Int, CaseIterable, Comparable, Sendable {
    case neutral = 0
    case positive = 1
    case warning = 2

    /// The tier's key in `rt.notify.sounds`, and its Original tone's bundled .caf name.
    public var key: String {
        switch self {
        case .neutral: return "neutral"
        case .positive: return "positive"
        case .warning: return "warning"
        }
    }

    public var title: String {
        switch self {
        case .neutral: return "Neutral"
        case .positive: return "Positive"
        case .warning: return "Warning"
        }
    }

    public var covers: String {
        switch self {
        case .neutral: return "Comments, rebases, mentions"
        case .positive: return "Passed, approved, merged"
        case .warning: return "Failed, conflicts, errors"
        }
    }

    public init(category: String, readyHeldCategory: String) {
        switch category {
        case "pipeline_passed", "mr_approved", "mr_merged", "mr_ready":
            self = .positive
        case "pipeline_failed", "mr_closed", "merge_conflicts", "merge_error", "runaway_process", readyHeldCategory:
            self = .warning
        default:
            self = .neutral
        }
    }

    public static func < (lhs: SoundTier, rhs: SoundTier) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// The sound picked for each tier, as `rt.notify.sounds` stores it.
public struct SoundPicks: Equatable, Sendable, Codable {
    public var neutral: String
    public var positive: String
    public var warning: String

    public static let defaults = SoundPicks(neutral: SoundID.original, positive: SoundID.original, warning: SoundID.original)

    public init(neutral: String, positive: String, warning: String) {
        self.neutral = neutral
        self.positive = positive
        self.warning = warning
    }

    /// A tier the stored object leaves out keeps its Original.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        neutral = try c.decodeIfPresent(String.self, forKey: .neutral) ?? SoundID.original
        positive = try c.decodeIfPresent(String.self, forKey: .positive) ?? SoundID.original
        warning = try c.decodeIfPresent(String.self, forKey: .warning) ?? SoundID.original
    }

    public subscript(tier: SoundTier) -> String {
        get {
            switch tier {
            case .neutral: return neutral
            case .positive: return positive
            case .warning: return warning
            }
        }
        set {
            switch tier {
            case .neutral: neutral = newValue
            case .positive: positive = newValue
            case .warning: warning = newValue
            }
        }
    }
}

/// Sound ids: `original`, `none`, `sober/<n>`, `macos/<name>`, `custom/<file>`.
public enum SoundID {
    public static let original = "original"
    public static let none = "none"
    public static let soberNumbers = ["101", "102", "103", "104"]

    public static func sober(_ n: String) -> String { "sober/\(n)" }
    public static func macos(_ name: String) -> String { "macos/\(name)" }
    public static func custom(_ file: String) -> String { "custom/\(file)" }

    public static func displayName(_ id: String) -> String {
        if id == original { return "Original" }
        if id == none { return "None" }
        let (source, rest) = split(id)
        switch source {
        case "sober":
            if let i = soberNumbers.firstIndex(of: rest) { return "Sober \(i + 1)" }
            return "Sober \(rest)"
        case "custom":
            return (rest as NSString).deletingPathExtension
        default:
            return rest
        }
    }

    static func split(_ id: String) -> (String, String) {
        guard let slash = id.firstIndex(of: "/") else { return (id, "") }
        return (String(id[..<slash]), String(id[id.index(after: slash)...]))
    }
}

/// Where each kind of sound lives on disk.
public struct SoundLocations: Sendable {
    public var resources: URL?
    public var systemSounds: URL
    public var customSounds: URL

    public static let systemSoundsDir = URL(fileURLWithPath: "/System/Library/Sounds")

    public static func customSoundsDir(home: String) -> URL {
        URL(fileURLWithPath: home).appendingPathComponent(".mattstack/rt/sounds", isDirectory: true)
    }

    public init(resources: URL?, systemSounds: URL = SoundLocations.systemSoundsDir, customSounds: URL) {
        self.resources = resources
        self.systemSounds = systemSounds
        self.customSounds = customSounds
    }
}

public enum SoundResolution: Equatable {
    case file(URL)
    case silent
    /// The pick can't be found, so the tier's Original plays instead, or the
    /// system alert when the bundle has no Original either.
    case fallback(URL?, missing: String)
}

public enum SoundCatalog {

    public static func resolve(_ id: String, tier: SoundTier, in loc: SoundLocations,
                               exists: (URL) -> Bool = { FileManager.default.fileExists(atPath: $0.path) }) -> SoundResolution {
        let original = loc.resources?.appendingPathComponent("\(tier.key).caf")
        if id == SoundID.none { return .silent }
        if id == SoundID.original {
            if let original, exists(original) { return .file(original) }
            return .fallback(nil, missing: id)
        }
        let (source, rest) = SoundID.split(id)
        let candidate: URL?
        switch source {
        case "sober" where SoundID.soberNumbers.contains(rest):
            candidate = loc.resources?.appendingPathComponent("sober-\(rest).caf")
        case "macos" where !rest.isEmpty && !rest.contains("/"):
            candidate = loc.systemSounds.appendingPathComponent("\(rest).aiff")
        case "custom" where !rest.isEmpty && !rest.contains("/"):
            candidate = loc.customSounds.appendingPathComponent(rest)
        default:
            candidate = nil
        }
        if let candidate, exists(candidate) { return .file(candidate) }
        if let original, exists(original) { return .fallback(original, missing: id) }
        return .fallback(nil, missing: id)
    }

    public static func systemSoundIDs(in dir: URL, fm: FileManager = .default) -> [String] {
        let names = (try? fm.contentsOfDirectory(atPath: dir.path)) ?? []
        return names.filter { $0.hasSuffix(".aiff") }
            .map { ($0 as NSString).deletingPathExtension }
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
            .map(SoundID.macos)
    }

    public static func customSoundIDs(in dir: URL, fm: FileManager = .default) -> [String] {
        let names = (try? fm.contentsOfDirectory(atPath: dir.path)) ?? []
        return names.filter { !$0.hasPrefix(".") }
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
            .map(SoundID.custom)
    }

    /// A file name not yet taken in the custom folder: `Doorbell.m4a`, then `Doorbell 2.m4a`.
    public static func uniqueFileName(_ name: String, taken: Set<String>) -> String {
        guard taken.contains(name) else { return name }
        let base = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        var n = 2
        while true {
            let candidate = ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)"
            if !taken.contains(candidate) { return candidate }
            n += 1
        }
    }
}
