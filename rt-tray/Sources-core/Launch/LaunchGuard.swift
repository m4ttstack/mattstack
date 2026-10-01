import Foundation

public enum LaunchGuard {
    /// Gatekeeper runs a quarantined app from a random read-only mount; a
    /// DMG is a volume. Either way SMAppService and Sparkle cannot work.
    public static func isTranslocatedOrOnRemovableVolume(bundlePath: String) -> Bool {
        bundlePath.contains("/AppTranslocation/") || bundlePath.hasPrefix("/Volumes/")
    }
}

/// Whether this Mac finished setup, read straight from rt's files under
/// ~/.mattstack/rt. Parity anchor: `parseSetupState` and `isSetupFinished`
/// in lib/setup/state.ts, checked against lib/setup/fixtures/setup-finished.json.
public enum SetupCompletion {
    public static let finishArguments = ["setup", "finish", "--json"]

    /// What `rt setup finish` had to say on stderr about the update run it
    /// starts: its own lines only, since rt's settings tips share that
    /// stream, capped like `failureCopy`.
    public static func finishReport(stderr: Data) -> String? {
        guard let text = String(data: stderr, encoding: .utf8) else { return nil }
        let lines = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { $0.hasPrefix("rt setup finish:") }
        guard !lines.isEmpty else { return nil }
        return String(lines.joined(separator: " ").prefix(2000))
    }

    public static func statePath(home: String) -> String { "\(home)/.mattstack/rt/setup-state.json" }
    static func intentPath(home: String) -> String { "\(home)/.mattstack/rt/setup-intent.json" }
    static func daemonPath(home: String) -> String { "\(home)/.mattstack/rt/daemon.json" }

    /// A file from before `finishedAt` (v1, or none at all) carries no Finish,
    /// so it is judged by what the old app went on: with no setup in flight,
    /// a v1 file whose Install ran, or an installed daemon. A pending team
    /// choice means a run is mid-setup, and every run stamps lastApplyAt.
    public static func isFinished(stateJSON: Data?, daemonInstalled: Bool, intentExists: Bool) -> Bool {
        guard let stateJSON else { return daemonInstalled && !intentExists }
        guard let state = (try? JSONSerialization.jsonObject(with: stateJSON)) as? [String: Any] else { return false }
        if let finishedAt = state["finishedAt"] as? String, !finishedAt.isEmpty { return true }
        let version = (state["v"] as? NSNumber)?.intValue ?? 1
        guard version < 2, !intentExists else { return false }
        if let lastApplyAt = state["lastApplyAt"] as? String, !lastApplyAt.isEmpty { return true }
        return daemonInstalled
    }

    public static func isFinished(home: String, readFile: (String) -> Data?, fileExists: (String) -> Bool) -> Bool {
        isFinished(stateJSON: readFile(statePath(home: home)),
                   daemonInstalled: fileExists(daemonPath(home: home)),
                   intentExists: fileExists(intentPath(home: home)))
    }

    /// Where an unfinished setup reopens. A run that got through, with no
    /// team choice pending, lands on Done so quitting there never costs a
    /// re-Install; a failed one goes back to the checklist, where its broken
    /// rows are, since Done's Finish could otherwise record over them.
    public static func resumeStep(stateJSON: Data?, intentExists: Bool) -> SetupStep? {
        if !intentExists, let stateJSON,
           let state = (try? JSONSerialization.jsonObject(with: stateJSON)) as? [String: Any],
           let lastApplyAt = state["lastApplyAt"] as? String, !lastApplyAt.isEmpty,
           state["lastApplyOk"] as? Bool == true {
            return .done
        }
        return intentExists || stateJSON != nil ? .checklist : nil
    }

    public static func resumeStep(home: String, readFile: (String) -> Data?, fileExists: (String) -> Bool) -> SetupStep? {
        resumeStep(stateJSON: readFile(statePath(home: home)), intentExists: fileExists(intentPath(home: home)))
    }

    public enum Launch: Equatable, Sendable {
        case none
        /// nil opens the wizard where it starts.
        case show(SetupStep?)
    }

    public static func onLaunch(resumeFlag: SetupStep?, finished: Bool, resume: SetupStep?) -> Launch {
        if let resumeFlag { return .show(resumeFlag) }
        if finished { return .none }
        return .show(resume)
    }

    public enum MenuEntry: Equatable, Sendable { case resume, status }

    /// The tray menu's setup items, read fresh each time it opens.
    public static func menuEntries(finished: Bool) -> [MenuEntry] {
        finished ? [.status] : [.resume, .status]
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
