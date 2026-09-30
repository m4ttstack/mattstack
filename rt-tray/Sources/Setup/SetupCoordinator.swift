import AppKit
import MattstackCore

/// Owns the Setup and Settings windows and the models behind them. One
/// instance per process, created by AppDelegate after the services exist.
@MainActor
final class SetupCoordinator {
    private let rt: RtRunning
    private let permissions: PermissionsService
    private let needs: NeedBroker
    private let updater: UpdaterController
    /// Onboarding + Settings' shared, live view of `setup plan`.
    private let readiness: ReadinessModel
    /// The read-only "Setup status…" view's own `setup status` model. Kept
    /// separate from `readiness` rather than steering one model's verb: both
    /// controllers can be open at once (first run auto-opens Setup, the gear
    /// menu stays clickable), and a shared, mutable verb would let one
    /// window's `.checklist` render the other's rows and gate Install on the
    /// wrong plan. Sharing `permissions` (below) across both is still safe —
    /// it's a stateless probe with its own internal locking.
    private let statusReadiness: ReadinessModel
    private let install: InstallRunModel
    private let statusInstall: InstallRunModel
    private let teamSettings: TeamSettingsModel
    private let devLogins: DevLoginsModel
    private let appsSettings: AppsSettingsModel
    private let settingsRefresher: SettingsRefresher
    private var setupWindow: SetupWindowController?
    /// "Setup status…" reuses this SAME controller across repeat opens —
    /// never a fresh one per click. A second `SetupWindowController` here
    /// would be a second, undelegated owner of `statusReadiness`'s
    /// visibility depth count: NSWindow (not this class) would be the only
    /// thing keeping it alive, `windowWillClose` would never fire for the
    /// orphaned one, and its 1 Hz permission poller would wedge on.
    private var statusWindow: SetupWindowController?
    private var settingsWindow: SettingsWindowController?
    /// Set by `handleJoin` when setup is already complete; consumed the next
    /// time the user actually asks to join a team from Settings.
    private var pendingTeamJoinCode: String?

    /// `permissionProbe` feeds only the two `ReadinessModel`s; every other use
    /// of `permissions` (row actions, Settings, TrayRoutes) keeps the real
    /// `PermissionsService` even under stub mode. Defaults to `permissions`
    /// itself (it already conforms to `PermissionProbing`) so a normal launch
    /// is unaffected.
    init(rt: RtRunning, permissions: PermissionsService, permissionProbe: PermissionProbing? = nil,
        needs: NeedBroker, updater: UpdaterController) {
        self.rt = rt; self.permissions = permissions; self.needs = needs; self.updater = updater
        let probe = permissionProbe ?? permissions
        readiness = ReadinessModel(plans: RtPlanSource(rt: rt, verb: ["setup", "plan", "--json"]),
                                   permissions: probe, ticker: MainTicker())
        statusReadiness = ReadinessModel(plans: RtPlanSource(rt: rt, verb: ["setup", "status", "--json"]),
                                         permissions: probe, ticker: MainTicker())
        install = InstallRunModel(stream: { from in
            var args = ["setup", "apply"]
            if let from { args += ["--from", from] }
            return rt.stream(args + ["--json"], stdin: nil)
        }, needs: needs)
        // The status window is a health view, never an installer: its own
        // model can only ever spawn a stream that finishes immediately, so no
        // path through it can start — or, on the next start(), SIGTERM — a
        // live `rt setup apply` the onboarding window owns.
        statusInstall = InstallRunModel(stream: { _ in AsyncThrowingStream { $0.finish() } }, needs: needs)
        teamSettings = TeamSettingsModel(rt: rt, needs: needs)
        devLogins = DevLoginsModel(rt: rt)
        appsSettings = AppsSettingsModel(rt: rt)
        appsSettings.onAppsChanged = { NotificationCenter.default.post(name: .rtAppsChanged, object: nil) }
        settingsRefresher = SettingsRefresher(team: teamSettings, apps: appsSettings)
    }

    var setupIsComplete: Bool {
        SetupCompletion.isFinished(home: AppHome.current) { FileManager.default.contents(atPath: $0) }
    }

    private var setupHasBegun: Bool {
        SetupCompletion.hasBegun(home: AppHome.current) { FileManager.default.fileExists(atPath: $0) }
    }

    func showSetupOnLaunch(resumeFlag: SetupStep?) {
        if case .show(let step) = SetupCompletion.onLaunch(resumeFlag: resumeFlag, finished: setupIsComplete, begun: setupHasBegun) {
            showSetup(step: step)
        }
    }

    /// "Resume setup…". A wizard already on screen is only brought forward:
    /// jumping it back to the checklist would abandon a live Install.
    func resumeSetup() {
        if setupWindow?.window?.isVisible == true { showSetup(); return }
        showSetup(step: setupHasBegun ? .checklist : nil)
    }

    func showSetup(step: SetupStep? = nil, joinCode: String? = nil, entry: SetupEntry = .firstRun, choice: TeamChoice? = nil) {
        if setupWindow == nil {
            let env = SetupEnvironment(rt: rt, needs: needs, readiness: readiness, install: install, permissions: permissions,
                                       isDevBuild: BundleFlavor.isDevBuild, bundleId: Bundle.main.bundleIdentifier ?? "com.mattstack.app",
                                       bundlePath: Bundle.main.bundlePath)
            let wc = SetupWindowController(environment: env)
            wc.onClose = { [weak self, weak wc] entry in
                guard let self, let wc else { return }
                if SetupCompletion.closeRecordsFinish(step: wc.flow.step, finishEnabled: wc.done.finishEnabled, readOnly: false) {
                    self.recordFinish()
                }
                let applied = wc.flow.step == .done && self.install.phase == .succeeded
                Task { @MainActor in await self.settingsRefresher.setupWindowClosed(entry: entry, applied: applied) }
            }
            setupWindow = wc
        }
        // Re-entering an already-complete setup must never trap the user
        // behind a titlebar with no close button.
        setupWindow?.allowsCloseAlways = setupIsComplete
        setupWindow?.show(step: step, joinCode: joinCode, entry: entry, choice: choice)
    }

    /// Until this lands every launch reopens setup, so a failure is logged
    /// and the next launch simply returns the user to it.
    private func recordFinish() {
        let rt = self.rt
        Task { @MainActor in
            do {
                let r = try await rt.run(SetupCompletion.finishArguments, stdin: nil)
                if let e = r.userError { throw e }
                if r.exitCode != 0 { TrayLog.warn("setup finish failed", ["exit": String(r.exitCode)]) }
            } catch {
                TrayLog.warn("setup finish failed", ["err": String(describing: error)])
            }
        }
    }

    /// "Setup status…": screen 3 as a read-only health view over
    /// `rt setup status`, driven by its own `statusReadiness` model; always
    /// closable since it's diagnostics, not a wizard.
    func openSetupStatus() {
        if statusWindow == nil {
            let env = SetupEnvironment(rt: rt, needs: needs, readiness: statusReadiness, install: statusInstall, permissions: permissions,
                                       isDevBuild: BundleFlavor.isDevBuild, bundleId: Bundle.main.bundleIdentifier ?? "com.mattstack.app",
                                       bundlePath: Bundle.main.bundlePath, readOnly: true)
            let wc = SetupWindowController(environment: env)
            wc.allowsCloseAlways = true
            wc.window?.title = "mattstack Setup status"
            statusWindow = wc
        }
        statusWindow?.flow.jump(to: .checklist)
        statusWindow?.flow.isInstalling = false
        statusWindow?.show(step: .checklist)
    }

    func showSettings(pane: SettingsPane? = nil) {
        if settingsWindow == nil {
            let env = SettingsEnvironment(rt: rt, needs: needs, permissions: permissions, readiness: readiness, updater: updater, apps: appsSettings, team: teamSettings,
                                          devLogins: devLogins,
                                          waivers: WaiverClient(rt: rt),
                                          isDevBuild: BundleFlavor.isDevBuild,
                                          version: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev",
                                          // An unfinished first run is only brought forward: re-entering it
                                          // as an upgrade would jump a live run back to Team, and a second
                                          // Install there SIGTERMs its running `rt setup apply`.
                                          onJoinAnotherTeam: { [weak self] in
                                              guard let self else { return }
                                              guard self.setupIsComplete else { self.showSetup(); return }
                                              let code = self.pendingTeamJoinCode
                                              self.pendingTeamJoinCode = nil
                                              self.showSetup(step: .team, joinCode: code, entry: .upgrade, choice: .join)
                                          },
                                          onCreateTeam: { [weak self] in
                                              guard let self else { return }
                                              guard self.setupIsComplete else { self.showSetup(); return }
                                              self.showSetup(step: .team, entry: .upgrade, choice: .create)
                                          },
                                          onQuitForUninstall: { NSApp.terminate(nil) })
            settingsWindow = SettingsWindowController(env: env)
        }
        settingsWindow?.show(pane: pane)
        Task { @MainActor in await settingsRefresher.reload() }
    }

    func showDevLoginAdd(origin: String) {
        showSettings(pane: .devLogins)
        devLogins.addRequest = origin
    }

    /// A join link while setup is already complete is "join a DIFFERENT
    /// team," not first-run onboarding: it never reopens the Setup wizard
    /// (that would trap the user in a flow they already finished). It goes
    /// straight to Settings › Team, with the code held ready for "Join
    /// another team…" to prefill.
    func handleJoin(code: String) {
        if setupIsComplete {
            pendingTeamJoinCode = code
            showSettings(pane: .team)
        } else {
            showSetup(step: .team, joinCode: code)
        }
    }
}

struct RtPlanSource: PlanSource {
    let rt: RtRunning
    let verb: [String]
    /// The setup UI shows plain copy for a failed fetch, so the raw error is logged here, where every fetch passes.
    func fetchPlan() async throws -> Plan {
        do {
            let r = try await rt.run(verb, stdin: nil)
            if let e = r.userError { throw e }
            return try r.decode(Plan.self)
        } catch {
            TrayLog.warn("plan fetch failed", ["verb": verb.joined(separator: " "), "err": String(describing: error)])
            throw error
        }
    }
}

/// Timer-backed ticker on the main run loop.
struct MainTicker: TickerScheduling {
    func schedule(every seconds: TimeInterval, _ tick: @escaping @Sendable () -> Void) -> TickerHandle {
        let box = TimerBox()
        box.timer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: true) { _ in tick() }
        return TickerHandle { box.invalidate() }
    }
}

/// Timer isn't Sendable; the cancel closure only ever runs on the main run
/// loop that created it, same thread the timer itself fires on.
private final class TimerBox: @unchecked Sendable {
    var timer: Timer?
    func invalidate() { timer?.invalidate() }
}
