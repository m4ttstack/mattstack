import Foundation
import Combine

/// Reads `rt setup form --json` for the fast-setup screens, and re-reads it
/// while a row's answer is landing outside the app.
@MainActor
public final class SetupFormModel: ObservableObject {
    /// The last read rt answered; a failed read leaves it in place.
    @Published public private(set) var form: SetupForm?
    @Published public private(set) var error: String?
    @Published public private(set) var isLoading = false

    private let rt: RtRunning
    private let sleep: @Sendable (TimeInterval) async -> Void
    private var watchTask: Task<Void, Never>?
    private var readsInFlight = 0
    private var issued = 0
    /// A read answered after a newer one has landed is dropped.
    private var landed = 0

    public init(rt: RtRunning, sleep: @escaping @Sendable (TimeInterval) async -> Void = { try? await Task.sleep(nanoseconds: UInt64($0 * 1e9)) }) {
        self.rt = rt; self.sleep = sleep
    }

    public nonisolated static func args(section: String?, extra: [String] = []) -> [String] {
        ["setup", "form"] + (section.map { ["--section", $0] } ?? []) + extra + ["--json"]
    }

    /// `section` nil reads the whole form; `extra` carries `--forge` and `--host` for the create section.
    public func load(section: String?, extra: [String] = []) async {
        issued += 1
        let mine = issued
        readsInFlight += 1
        isLoading = true
        defer {
            readsInFlight -= 1
            isLoading = readsInFlight > 0
        }
        let result = await rt.runJSON(Self.args(section: section, extra: extra), verb: "setup form", as: SetupForm.self)
        guard mine > landed else { return }
        landed = mine
        switch result {
        case .success(let read):
            form = read
            error = nil
        case .failure(let failure):
            error = failure.copy
        }
    }

    /// Re-reads one at a time until no row rt marks `watch` in that section is waiting or busy.
    public func watch(section: String?, every seconds: TimeInterval = 2, extra: [String] = []) {
        stopWatching()
        watchTask = Task { [weak self, sleep] in
            while !Task.isCancelled {
                await sleep(seconds)
                guard !Task.isCancelled, let self else { return }
                await self.load(section: section, extra: extra)
                guard !Task.isCancelled else { return }
                if !self.waits(in: section) {
                    self.watchTask = nil
                    return
                }
            }
        }
    }

    public var isWatching: Bool { watchTask != nil }

    public func stopWatching() {
        watchTask?.cancel()
        watchTask = nil
    }

    private func waits(in section: String?) -> Bool {
        guard let sections = form?.sections else { return false }
        let rows = section.map { sections.rows(for: $0) ?? [] } ?? sections.all
        return rows.contains { $0.watch && ($0.state == .waiting || $0.state == .busy) }
    }
}
