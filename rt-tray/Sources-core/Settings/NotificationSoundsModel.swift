import Foundation
import Combine

/// This Mac's `rt.notify.sounds`, held in memory so a notification never
/// waits on rt to learn which tone to play.
@MainActor
public final class NotificationSoundsModel: ObservableObject {
    @Published public private(set) var picks = SoundPicks.defaults
    @Published public private(set) var error: String?

    /// How long picks settle before one write saves them all.
    private let saveDelay: Duration
    private var pendingSave: Task<Void, Never>?
    private var saveCount = 0

    /// Bumped by every pick and read, so a read that a newer pick has
    /// superseded never lands over it.
    private var generation = 0

    public init(saveDelay: Duration = .milliseconds(600)) {
        self.saveDelay = saveDelay
    }

    /// Skips while a save is pending so a read cannot undo a fresh pick.
    public func load(rt: RtRunning) async {
        guard pendingSave == nil else { return }
        struct Reading: Decodable { var value: SoundPicks }
        generation += 1
        let mine = generation
        let result = await rt.runJSON(["settings", "get", "rt.notify.sounds", "--json"], verb: "settings get", as: Reading.self)
        guard mine == generation else { return }
        error = nil
        switch result {
        case .success(let reading): picks = reading.value
        case .failure(let failure): error = failure.copy
        }
    }

    /// A pick that failed to save still plays until the app quits, so a
    /// sound can be tried even when rt can't store it.
    static func unsaved(_ why: String) -> String { "Not saved, so this pick lasts until mattstack quits. \(why)" }

    /// Takes effect at once; the save waits for picks to settle and writes
    /// only the last state, after any write already running.
    public func pick(_ tier: SoundTier, _ id: String, rt: RtRunning) {
        guard picks[tier] != id else { return }
        generation += 1
        error = nil
        picks[tier] = id
        let previous = pendingSave
        previous?.cancel()
        saveCount += 1
        let mine = saveCount
        pendingSave = Task { [saveDelay] in
            try? await Task.sleep(for: saveDelay)
            if Task.isCancelled { return }
            await previous?.value
            await self.save(rt: rt)
            if self.saveCount == mine { self.pendingSave = nil }
        }
    }

    /// Waits for the pending save, if any. Checks use it; the pane never waits.
    public func settle() async {
        while let task = pendingSave { await task.value }
    }

    private func save(rt: RtRunning) async {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let json = String(decoding: (try? encoder.encode(picks)) ?? Data("{}".utf8), as: UTF8.self)
        do {
            let r = try await rt.run(["settings", "set", "rt.notify.sounds", json, "--scope", "machine"], stdin: nil)
            if r.exitCode != 0 { error = Self.unsaved(r.userError?.message ?? r.failureCopy(verb: "settings set")) }
        } catch {
            self.error = Self.unsaved((error as? RtClientError)?.copy ?? "rt settings set failed to start.")
        }
    }
}
