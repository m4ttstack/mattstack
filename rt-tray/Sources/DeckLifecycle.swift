import Foundation
import ServiceManagement
import MattstackCore

/// Restarts and watches this flavor's own deck LaunchAgent. The label comes
/// from the daemon's (BundleFlavor), so a dev bundle can only ever touch
/// `com.mattstack.deck.dev` and a prod bundle `com.mattstack.deck`.
///
/// Restarts run inside the daemon lifecycle gate: a flavor that has retired
/// (stand-down or /flavor/retire) has latched that gate, so it can never
/// bring its deck back while the other app owns the Mac.
@MainActor
final class DeckLifecycle {
    static let menuOrigin = "deck: tray menu"
    static let splashOrigin = "deck: window splash"
    static let healOrigin = "deck: auto-heal"

    let label: String
    private let registrar: ServicesRegistrar
    private let daemon: DaemonLifecycle
    private var inFlight: Task<Bool, Never>?
    private var policy = DeckHealPolicy()
    private var lastDecision: DeckHealDecision?

    /// Set while the version-change sweep restarts deck's apps; deck answers
    /// unevenly through it and must not be kickstarted underneath.
    var servedAppsRestarting = false
    /// Cleared once launch's settle pass, which spawn-heals deck itself, ends.
    var launchSettling = true

    init(registrar: ServicesRegistrar, daemon: DaemonLifecycle) {
        self.label = DeckAgentDiagnosis.label(forDaemonLabel: daemon.label)
        self.registrar = registrar
        self.daemon = daemon
    }

    var registration: AgentRegistration {
        ServicesRegistrar.registration(SMAppService.agent(plistName: label + ".plist").status)
    }

    /// Concurrent callers (menu, splash, the poll) share one restart.
    func restart(origin: String) async -> Bool {
        if let inFlight { return await inFlight.value }
        if origin != Self.healOrigin { policy.manualRestart() }
        let label = label
        let registrar = registrar
        let task = Task { () -> Bool in
            await daemon.runGated(origin: origin) {
                if await registrar.restart(label: label) {
                    TrayLog.info("deck kickstarted", ["label": label, "origin": origin])
                    return true
                }
                TrayLog.warn("deck kickstart failed; re-registering", ["label": label, "origin": origin])
                return await registrar.reregisterAgent(label: label)
            }
        }
        inFlight = task
        let ok = await task.value
        inFlight = nil
        policy.restartFinished()
        return ok
    }

    /// One status poll. Returns the menu line; a heal it decides on runs
    /// after the line is returned so the menu says "restarting" meanwhile.
    func poll() async -> (status: String, diagnostic: String?) {
        let probe = await LiveDeckProbe.probe()
        let healthyPid: String?
        if case .healthy(let pid) = probe { healthyPid = pid } else { healthyPid = nil }
        let decision = policy.observe(healthy: healthyPid != nil, hold: hold(),
                                      now: ProcessInfo.processInfo.systemUptime)
        let status = DeckStatusLines.status(for: decision, pid: healthyPid, runMode: runMode())
        let previous = lastDecision
        lastDecision = decision
        if decision == .healthy, let previous, previous != .healthy {
            TrayLog.info("deck answering again", ["label": label])
        }
        switch decision {
        case .healthy, .held(.restartInFlight), .held(.servedAppsRestarting), .held(.launchSettling):
            return (status, nil)
        case .heal:
            TrayLog.warn("deck not answering; restarting it", ["label": label, "probe": String(describing: probe)])
            Task { _ = await restart(origin: Self.healOrigin) }
            return (status, nil)
        case .gaveUp:
            if previous != .gaveUp { TrayLog.error("deck still down after automatic restarts; leaving it", ["label": label]) }
            return (status, await LiveDeckDiagnosis.describe())
        case .waiting, .held:
            return (status, await LiveDeckDiagnosis.describe())
        }
    }

    private func hold() -> DeckHealHold? {
        if inFlight != nil { return .restartInFlight }
        if launchSettling { return .launchSettling }
        if servedAppsRestarting { return .servedAppsRestarting }
        switch registration {
        case .requiresApproval: return .awaitingApproval
        case .notRegistered, .notFound: return .notRegistered
        case .enabled: return nil
        }
    }

    /// Only the dev shim can fall back from source, so only dev shows it.
    private func runMode() -> String? {
        guard BundleFlavor.isDevBuild,
              let data = FileManager.default.contents(atPath: AppHome.current + "/.mattstack/deck/api.json") else {
            return nil
        }
        return DeckStatusLines.runMode(apiJSON: data)
    }
}
