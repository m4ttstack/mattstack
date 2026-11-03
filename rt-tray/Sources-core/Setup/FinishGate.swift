import Foundation

/// A finish-gated row blocks Finish until ready, skipped, or waived on this Mac by `rt setup waive`.
public enum FinishGate {
    public static let skipRowButton = "Skip"
}

public extension PlanRow {
    /// The contract's own flag; the note beside it is copy, never the state.
    var isWaived: Bool { finishGated && waived }
}

/// Runs the two waiver verbs. It never re-reads the plan itself: the row's
/// shape on screen must come from rt, and the caller owns that re-read
/// (the Settings pane's refresh), so a hung or failed re-read is reported
/// there and not swallowed here.
@MainActor
public final class WaiverClient {
    private let rt: RtRunning

    public init(rt: RtRunning) { self.rt = rt }

    /// nil once the verb succeeded; otherwise the user-facing failure copy.
    public func waive(_ rowId: String) async -> String? { await run("waive", rowId) }
    public func unwaive(_ rowId: String) async -> String? { await run("unwaive", rowId) }

    private func run(_ verb: String, _ rowId: String) async -> String? {
        let args = ["setup", verb, rowId, "--json"]
        do {
            let result = try await rt.run(args, stdin: nil)
            if let e = result.userError { return e.message }
            if result.exitCode != 0 { return result.failureCopy(verb: "setup \(verb) \(rowId)") }
        } catch {
            return (error as? RtClientError)?.copy ?? "rt setup \(verb) failed to start."
        }
        return nil
    }
}

/// Runs a choose row's verb and hands back its refusal, so the sheet that
/// asked can show it.
@MainActor
public final class ChoiceClient {
    private let rt: RtRunning
    public init(rt: RtRunning) { self.rt = rt }

    /// nil once the verb succeeded; otherwise the user-facing failure copy.
    /// An empty verb refuses without spawning rt: `verb + [id, "--json"]`
    /// would otherwise run `rt <id> --json`, a nonconforming rt's row shape
    /// making the app execute an arbitrary id as a top-level rt command.
    public func choose(verb: [String], id: String) async -> String? {
        guard !verb.isEmpty else { return "This choice has no command to run." }
        let args = verb + [id, "--json"]
        do {
            let result = try await rt.run(args, stdin: nil)
            if let e = result.userError { return e.message }
            if result.exitCode != 0 { return result.failureCopy(verb: args.dropLast().joined(separator: " ")) }
        } catch {
            return (error as? RtClientError)?.copy ?? "rt \(verb.joined(separator: " ")) failed to start."
        }
        return nil
    }
}
