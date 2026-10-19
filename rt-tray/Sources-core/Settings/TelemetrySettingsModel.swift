import Foundation
import Combine

@MainActor
public final class TelemetrySettingsModel: ObservableObject {
    /// True until `load()` answers: the registry default is on.
    @Published public private(set) var enabled = true
    @Published public private(set) var inFlight = false
    @Published public private(set) var error: String?
    private let rt: RtRunning
    public init(rt: RtRunning) { self.rt = rt }

    /// Skips while a write is in flight so a late read cannot undo the optimistic switch.
    public func load() async {
        guard !inFlight else { return }
        await read()
    }

    private func read() async {
        struct Reading: Decodable { var value: Bool }
        error = nil
        switch await rt.runJSON(["settings", "get", "telemetry.enabled", "--json"], verb: "settings get", as: Reading.self) {
        case .success(let reading): enabled = reading.value
        case .failure(let failure): error = failure.copy
        }
    }

    public func setEnabled(_ on: Bool) async {
        guard !inFlight else { return }
        inFlight = true
        defer { inFlight = false }
        error = nil
        let prior = enabled
        enabled = on
        do {
            let r = try await rt.run(["settings", "set", "telemetry.enabled", on ? "true" : "false", "--scope", "user"], stdin: nil)
            guard r.exitCode == 0 else {
                enabled = prior
                error = r.userError?.message ?? r.failureCopy(verb: "settings set")
                return
            }
        } catch {
            enabled = prior
            self.error = (error as? RtClientError)?.copy ?? "rt settings set failed to start."
            return
        }
        await read()
    }
}
