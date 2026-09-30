import Foundation

public enum LaunchGuard {
    /// Gatekeeper runs a quarantined app from a random read-only mount; a
    /// DMG is a volume. Either way SMAppService and Sparkle cannot work.
    public static func isTranslocatedOrOnRemovableVolume(bundlePath: String) -> Bool {
        bundlePath.contains("/AppTranslocation/") || bundlePath.hasPrefix("/Volumes/")
    }
}

/// Whether this Mac finished setup, read straight from rt's
/// ~/.mattstack/rt/setup-state.json. Parity anchor: `isSetupFinished` and
/// `readSetupState` in lib/setup/state.ts must answer the same way.
public enum SetupCompletion {
    public static let finishArguments = ["setup", "finish", "--json"]

    public static func statePath(home: String) -> String { "\(home)/.mattstack/rt/setup-state.json" }

    /// A v1 file predates `finishedAt`; one whose Install ran reads finished so
    /// an upgrade never sends a working Mac back through setup.
    public static func isFinished(stateJSON: Data?) -> Bool {
        guard let stateJSON,
              let state = (try? JSONSerialization.jsonObject(with: stateJSON)) as? [String: Any] else { return false }
        if let finishedAt = state["finishedAt"] as? String, !finishedAt.isEmpty { return true }
        let version = (state["v"] as? NSNumber)?.intValue ?? 1
        guard version < 2, let lastApplyAt = state["lastApplyAt"] as? String else { return false }
        return !lastApplyAt.isEmpty
    }

    public static func isFinished(home: String, readFile: (String) -> Data?) -> Bool {
        isFinished(stateJSON: readFile(statePath(home: home)))
    }

    /// A team choice (the setup intent) or an Install (the state file) is on disk.
    public static func hasBegun(home: String, fileExists: (String) -> Bool) -> Bool {
        fileExists("\(home)/.mattstack/rt/setup-intent.json") || fileExists(statePath(home: home))
    }

    public enum Launch: Equatable, Sendable {
        case none
        /// nil opens the wizard where it starts.
        case show(SetupStep?)
    }

    public static func onLaunch(resumeFlag: SetupStep?, finished: Bool, begun: Bool) -> Launch {
        if let resumeFlag { return .show(resumeFlag) }
        if finished { return .none }
        return .show(begun ? .checklist : nil)
    }

    /// Finish and the titlebar close at Done share one gate; the read-only
    /// status window never finishes anything.
    public static func closeRecordsFinish(step: SetupStep, finishEnabled: Bool, readOnly: Bool) -> Bool {
        !readOnly && step == .done && finishEnabled
    }
}

public enum JoinLink {
    public static func code(from url: URL) -> String? {
        guard url.scheme?.lowercased() == "mattstack", url.host?.lowercased() == "join" else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count == 1 else { return nil }
        let code = parts[0].trimmingCharacters(in: .whitespacesAndNewlines)
        return code.isEmpty ? nil : code
    }

    /// The URL shape is host-agnostic, matching lib/team/invite-crypto.ts: a
    /// link minted under RT_JOIN_BASE_URL carries the code in the same fragment.
    public static func code(fromText text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        var candidate = trimmed
        if let url = URL(string: trimmed), let scheme = url.scheme?.lowercased() {
            if scheme == "mattstack" {
                guard let code = code(from: url) else { return nil }
                candidate = code
            } else if let fragment = url.fragment, !fragment.isEmpty {
                candidate = fragment
            } else if url.host != nil {
                return nil
            }
        }
        let normalized = normalize(candidate)
        guard normalized.count == 77, normalized.allSatisfy({ alphabet.contains($0) }) else { return nil }
        return normalized
    }

    static let alphabet = Set("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    static func normalize(_ raw: String) -> String {
        String(raw.uppercased().compactMap { ch -> Character? in
            if ch == "-" || ch.isWhitespace || ch.isNewline { return nil }
            if ch == "O" { return "0" }
            if ch == "I" || ch == "L" { return "1" }
            return ch
        })
    }
}

public enum AppPathSetting {
    /// `JSONEncoder`/plain `JSONSerialization` escape `/` as `\/`, which a
    /// file path has no reason to carry — `.withoutEscapingSlashes` keeps
    /// the value a real JSON string literal without that noise.
    public static func arguments(bundlePath: String) -> [String] {
        let data = (try? JSONSerialization.data(withJSONObject: bundlePath, options: [.fragmentsAllowed, .withoutEscapingSlashes]))
            ?? Data("\"\"".utf8)
        return ["settings", "set", "mattstack.appPath", String(decoding: data, as: UTF8.self), "--scope", "machine"]
    }
}
