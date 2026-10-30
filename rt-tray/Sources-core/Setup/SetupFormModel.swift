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
    /// The newest read that carried each section, keyed by the name `--section` takes, so one screen's read never blanks another's.
    @Published public private(set) var reads: [String: SetupForm] = [:]
    /// The newest whole read: only it carries the stage and what paused.
    @Published public private(set) var whole: SetupForm?

    private let rt: RtRunning
    private let sleep: @Sendable (TimeInterval) async -> Void
    private var watchTask: Task<Void, Never>?
    private var readsInFlight = 0
    private var issued = 0
    /// A read answered after a newer one has landed is dropped.
    private var landed = 0
    private var sectionLanded: [String: Int] = [:]
    private var wholeLanded = 0

    public nonisolated static let sections = ["macos", "invite", "restore", "create", "connect", "this-mac"]

    public init(rt: RtRunning, sleep: @escaping @Sendable (TimeInterval) async -> Void = { try? await Task.sleep(nanoseconds: UInt64($0 * 1e9)) }) {
        self.rt = rt; self.sleep = sleep
    }

    public nonisolated static func args(section: String?, extra: [String] = []) -> [String] {
        ["setup", "form"] + (section.map { ["--section", $0] } ?? []) + extra + ["--json"]
    }

    /// `section` nil reads the whole form; `extra` carries `--forge` and `--host` for the create section.
    /// Hands back this call's own read even when a newer one has landed first, and nil when rt could not answer.
    @discardableResult
    public func load(section: String?, extra: [String] = []) async -> SetupForm? {
        issued += 1
        let mine = issued
        readsInFlight += 1
        isLoading = true
        defer {
            readsInFlight -= 1
            isLoading = readsInFlight > 0
        }
        let result = await rt.runJSON(Self.args(section: section, extra: extra), verb: "setup form", as: SetupForm.self)
        switch result {
        case .success(let read):
            keep(read, issued: mine, whole: section == nil)
            return read
        case .failure(let failure):
            if mine > landed {
                landed = mine
                error = failure.copy
            }
            return nil
        }
    }

    /// A read rt answered some other way, kept as a load keeps it.
    public func absorb(_ read: SetupForm) {
        issued += 1
        keep(read, issued: issued, whole: read.stage != nil)
    }

    public func rows(for section: String) -> [FormRow]? { reads[section]?.sections.rows(for: section) }

    public func read(carrying section: String) -> SetupForm? { reads[section] }

    /// Until the next read of `section` lands it reads as not loaded, and no read already in flight brings the old rows back.
    public func forget(section: String) {
        reads[section] = nil
        sectionLanded[section] = issued
    }

    private func keep(_ read: SetupForm, issued mine: Int, whole isWhole: Bool) {
        if mine > landed {
            landed = mine
            form = read
            error = nil
        }
        for name in Self.sections where read.sections.rows(for: name) != nil && mine > (sectionLanded[name] ?? 0) {
            sectionLanded[name] = mine
            reads[name] = read
        }
        if isWhole, mine > wholeLanded {
            wholeLanded = mine
            whole = read
        }
    }

    /// Re-reads one at a time until no row rt marks `watch` in that section is waiting or busy, and
    /// `alsoWhile` is false: a link the app opened leaves rt's row todo until its answer lands.
    public func watch(section: String?, every seconds: TimeInterval = 2, extra: [String] = [],
                      alsoWhile: (@MainActor () -> Bool)? = nil) {
        stopWatching()
        watchTask = Task { [weak self, sleep] in
            while !Task.isCancelled {
                await sleep(seconds)
                guard !Task.isCancelled, let self else { return }
                await self.load(section: section, extra: extra)
                guard !Task.isCancelled else { return }
                if !self.waits(in: section), alsoWhile?() != true {
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

    public func waits(in section: String?) -> Bool {
        guard let sections = form?.sections else { return false }
        let rows = section.map { sections.rows(for: $0) ?? [] } ?? sections.all
        return rows.contains { $0.watch && ($0.state == .waiting || $0.state == .busy) }
    }
}
