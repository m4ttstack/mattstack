import Foundation
import Combine

/// This Mac's `rt.notify.sounds`, held in memory so a notification never
/// waits on rt to learn which tone to play.
@MainActor
public final class NotificationSoundsModel: ObservableObject {
    @Published public private(set) var picks = SoundPicks.defaults
    @Published public private(set) var inFlight = false
    @Published public private(set) var error: String?

    public init() {}

    /// Skips while a write is in flight so a late read cannot undo the optimistic pick.
    public func load(rt: RtRunning) async {
        guard !inFlight else { return }
        await read(rt: rt)
    }

    private func read(rt: RtRunning) async {
        struct Reading: Decodable { var value: SoundPicks }
        error = nil
        switch await rt.runJSON(["settings", "get", "rt.notify.sounds", "--json"], verb: "settings get", as: Reading.self) {
        case .success(let reading): picks = reading.value
        case .failure(let failure): error = failure.copy
        }
    }

    /// A pick that failed to save still plays until the app quits, so a
    /// sound can be tried even when rt can't store it.
    static func unsaved(_ why: String) -> String { "Not saved, so this pick lasts until mattstack quits. \(why)" }

    public func set(_ tier: SoundTier, to id: String, rt: RtRunning) async {
        guard !inFlight, picks[tier] != id else { return }
        inFlight = true
        defer { inFlight = false }
        error = nil
        picks[tier] = id
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let json = String(decoding: (try? encoder.encode(picks)) ?? Data("{}".utf8), as: UTF8.self)
        do {
            let r = try await rt.run(["settings", "set", "rt.notify.sounds", json, "--scope", "machine"], stdin: nil)
            guard r.exitCode == 0 else {
                error = Self.unsaved(r.userError?.message ?? r.failureCopy(verb: "settings set"))
                return
            }
        } catch {
            self.error = Self.unsaved((error as? RtClientError)?.copy ?? "rt settings set failed to start.")
            return
        }
        await read(rt: rt)
    }
}
