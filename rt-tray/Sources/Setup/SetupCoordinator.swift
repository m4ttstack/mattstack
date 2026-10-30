import AppKit
import Combine
import MattstackCore

/// Owns the Setup and Settings windows and the models behind them. One
/// instance per process, created by AppDelegate after the services exist.
///
/// Fast setup's models live here, not in the window, so closing it never
/// stops the join's approval check or a run. rt's whole read is the only
/// router: the flow lands on its stage when the window opens, when a screen
/// hands over to `.loading`, and when a run ends; section reads only refresh rows.
@MainActor
final class SetupCoordinator {
    private let rt: RtRunning
    private let permissions: PermissionsService
    private let needs: NeedBroker
    private let updater: UpdaterController
    private let notify: @MainActor (SetupNotice) -> Void
    /// Settings' shared, live view of `setup plan`; P1 borrows its permission probe.
    private let readiness: ReadinessModel
    private let flow = FastSetupFlow()
    private let form: SetupFormModel
    private let install: InstallRunModel
    private let prepare: PrepareRunner
    private let join: JoinPageModel
    private let team: TeamChoiceModel
    private let status = FastSetupStatus()
    private lazy var actions = FormActionRunner(rt: rt, needs: needs, effects: AppFormEffects(permissions: permissions),
                                                reload: { [weak self] in await self?.refreshSection() })
    private let teamSettings: TeamSettingsModel
    private let devLogins: DevLoginsModel
    private let appsSettings: AppsSettingsModel
    private let settingsRefresher: SettingsRefresher
    private var setupWindow: SetupWindowController?
    private var settingsWindow: SettingsWindowController?
    /// Set by `handleJoin` when setup is already complete; consumed the next
    /// time the user actually asks to join a team from Settings.
    private var pendingTeamJoinCode: String?

    /// The screen whose work (prepare, section read, watch) last started.
    private var enteredScreen: FastSetupScreen = .loading
    private var entries = 0
    /// A join link on a first run: the cards pick Join for the member.
    private var picksJoinAtCards = false
    private var probing = false
    private var relaunching = false
    /// This window has shown setup unfinished, so reaching P7 is a Finish to record.
    private var sawUnfinished = false
    private var finishPending = false
    /// A run that ends with rt still holding it is attached to once more, never in a loop.
    private var reattached = false
    private var lastPhase: InstallRunModel.Phase = .idle
    private var lastInviteCode = ""
    private var lastVerdict = false
    private var lastForge = ""
    private var activeObserver: Any?
    private var cancellables = Set<AnyCancellable>()

    /// `permissionProbe` feeds only `readiness`; every other use of
    /// `permissions` (row actions, Settings, TrayRoutes) keeps the real
    /// `PermissionsService` even under stub mode.
    init(rt: RtRunning, permissions: PermissionsService, permissionProbe: PermissionProbing? = nil,
         needs: NeedBroker, updater: UpdaterController, notify: @escaping @MainActor (SetupNotice) -> Void) {
        self.rt = rt; self.permissions = permissions; self.needs = needs; self.updater = updater; self.notify = notify
        readiness = ReadinessModel(plans: RtPlanSource(rt: rt, verb: ["setup", "plan", "--json"]),
                                   permissions: permissionProbe ?? permissions, ticker: MainTicker())
        form = SetupFormModel(rt: rt)
        install = InstallRunModel(stream: FastSetupLaunch.installStream(rt: rt), needs: needs)
        prepare = PrepareRunner(rt: rt)
        join = JoinPageModel(rt: rt, needs: needs)
        team = TeamChoiceModel(rt: rt, pasteboard: SystemPasteboard())
        teamSettings = TeamSettingsModel(rt: rt, needs: needs)
        devLogins = DevLoginsModel(rt: rt)
        appsSettings = AppsSettingsModel(rt: rt)
        appsSettings.onAppsChanged = { NotificationCenter.default.post(name: .rtAppsChanged, object: nil) }
        settingsRefresher = SettingsRefresher(team: teamSettings, apps: appsSettings)
        wire()
    }

    var setupIsComplete: Bool { SetupSession.isFinished }

    // MARK: - Entries

    func showSetupOnLaunch(arguments: [String]) {
        guard SetupCompletion.onLaunch(relaunched: SetupResume.screen(from: arguments) != nil, finished: setupIsComplete) else { return }
        showSetup()
    }

    /// "Resume setup…" and a `setup_progress` click. A window on screen is only brought forward.
    func resumeSetup() {
        showSetup(entry: setupWindow == nil ? .firstRun : flow.entry)
    }

    /// "Setup status…" and a `setup_update` click: the same window, wherever rt says setup is.
    func openSetupStatus() {
        showSetup(entry: .status)
    }

    /// Opens setup and lands on rt's stage. A window already on screen is only
    /// brought forward unless the caller asks for something new (a Join or
    /// Create from Settings, a join link): re-landing it could pull a member
    /// off a card they picked before rt has recorded it.
    func showSetup(entry requested: SetupEntry = .firstRun, choice: TeamChoice? = nil, joinCode: String? = nil) {
        let window = setupWindow ?? makeWindow()
        let asked = choice != nil || joinCode != nil
        if window.isVisible, !asked { window.show(); return }
        let entry = FastSetupLaunch.entry(requested, finished: setupIsComplete)
        flow.entry = entry
        flow.requested = entry == .upgrade ? choice : nil
        team.enter(entry, choice: choice, joinCode: joinCode)
        picksJoinAtCards = joinCode != nil && entry == .firstRun
        if entry == .firstRun { sawUnfinished = true }
        reattached = false
        window.show()
        observeActivation()
        let before = entries
        Task { @MainActor in
            await flow.land(reading: form)
            // The flow may land on the screen it was already on, which starts nothing by itself.
            if entries == before, flow.screen == enteredScreen { enter(flow.screen) }
        }
    }

    private func makeWindow() -> SetupWindowController {
        let view = FastSetupView(flow: flow, form: form, actions: actions, install: install, team: team, status: status,
                                 handlers: FastSetupHandlers(
                                    choose: { [weak self] in self?.choose($0) },
                                    join: { [weak self] in Task { await self?.joinPressed() } },
                                    create: { [weak self] in Task { await self?.createPressed() } },
                                    restore: { [weak self] in Task { await self?.restorePressed() } },
                                    hide: { [weak self] in self?.setupWindow?.close() },
                                    retry: { [weak self] in self?.retry() },
                                    pausedAction: { [weak self] in self?.pausedAction($0) },
                                    openHome: { [weak self] in self?.openHome() },
                                    readAgain: { [weak self] in Task { await self?.landOnRtStage() } }))
        let wc = SetupWindowController(flow: flow, root: view)
        wc.onClose = { [weak self] in self?.windowClosed() }
        setupWindow = wc
        return wc
    }

    // MARK: - Wiring

    private func wire() {
        flow.$screen.receive(on: DispatchQueue.main).sink { [weak self] _ in self?.screenChanged() }.store(in: &cancellables)
        form.$form.compactMap { $0 }.sink { [weak self] read in self?.actions.reconcile(with: read.sections.all) }.store(in: &cancellables)
        form.$reads.receive(on: DispatchQueue.main).sink { [weak self] _ in self?.macosMaybeDone() }.store(in: &cancellables)
        install.$phase.receive(on: DispatchQueue.main).sink { [weak self] phase in self?.phaseChanged(to: phase) }.store(in: &cancellables)
        prepare.$running.receive(on: DispatchQueue.main).sink { [weak self] _ in self?.markRunInFlight() }.store(in: &cancellables)
        team.objectWillChange.receive(on: DispatchQueue.main).sink { [weak self] _ in self?.teamChanged() }.store(in: &cancellables)
        readiness.$permissionSnapshot.removeDuplicates().receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.permissionsChanged() }.store(in: &cancellables)
        readiness.$fdaNeedsRelaunch.removeDuplicates().receive(on: DispatchQueue.main)
            .sink { [weak self] needs in if needs { self?.relaunchForFullDiskAccess() } }.store(in: &cancellables)
        prepare.onFinished = { [weak self] _ in Task { await self?.refreshSection() } }
        join.onApproved = { [weak self] _ in self?.approved() }
    }

    /// Updates wait while a run or a background install is live, window or not.
    private func markRunInFlight() {
        SetupSession.setRunInFlight(install.isRunning || !prepare.running.isEmpty, for: ObjectIdentifier(self))
    }

    private func screenChanged() {
        let screen = flow.screen
        guard screen != enteredScreen else { return }
        leave(enteredScreen)
        enter(screen)
    }

    private func leave(_ screen: FastSetupScreen) {
        form.stopWatching()
        if screen == .macos { stopProbing() }
    }

    private func enter(_ screen: FastSetupScreen) {
        enteredScreen = screen
        entries += 1
        switch screen {
        case .loading:
            Task { await landOnRtStage() }
        case .macos:
            prepare.start("macos")
            if setupWindow?.isVisible == true { startProbing() }
            Task { await refreshSection() }
        case .path:
            if picksJoinAtCards {
                picksJoinAtCards = false
                choose(.join)
            }
        case .invite:
            // A relaunch onto a screen has no card picked behind it, and the team model's verbs follow the choice.
            team.choice = .join
            picksJoinAtCards = false
            lastVerdict = team.hasGoodVerdict
            if team.hasGoodVerdict { Task { await refreshSection() } } else { form.forget(section: "invite"); previewInvite() }
        case .createTeam:
            team.choice = .create
            lastForge = team.forge
            form.forget(section: "create")
            Task { await refreshSection() }
        case .restore:
            team.choice = .restore
            Task { await refreshSection() }
        case .thisMac:
            Task { await refreshSection() }
        case .connect:
            prepare.start("accounts")
            Task { await refreshSection() }
        case .waiting:
            Task { await keepCheckingApproval() }
        case .running:
            startBarIfNeeded()
        case .paused:
            break
        case .ready:
            if sawUnfinished { finishPending = true }
        }
        if screen != .loading, screen != .ready { sawUnfinished = true }
    }

    // MARK: - Reads

    /// A whole read, and rt's stage decides the screen.
    private func landOnRtStage() async {
        await flow.land(reading: form)
        if flow.screen == .running { startBarIfNeeded() }
    }

    /// Re-reads the current screen's own section, then watches it while a row's answer is landing outside the app.
    private func refreshSection() async {
        let screen = flow.screen
        guard let section = screen.section else { return }
        if screen == .invite, !team.hasGoodVerdict { return }
        let extra = section == "create" ? ["--forge", team.forge] : []
        await form.load(section: section, extra: extra)
        guard flow.screen == screen, setupWindow?.isVisible == true else { return }
        if form.waits(in: section) || appWaits(in: section) {
            form.watch(section: section, extra: extra, alsoWhile: { [weak self] in self?.appWaits(in: section) ?? false })
        }
    }

    /// A link opened or a sign-in started: rt still calls the row todo until its answer lands.
    private func appWaits(in section: String) -> Bool {
        (form.rows(for: section) ?? []).contains { $0.watch && actions.waiting[$0.id] != nil }
    }

    private func macosMaybeDone() {
        guard flow.screen == .macos, FastSetupFlow.macosReady(form.rows(for: "macos")) else { return }
        flow.macosDone()
    }

    // MARK: - P1's permissions

    /// The app's own probe sees a grant before rt's next read does, so a change asks rt again.
    private func startProbing() {
        guard !probing else { return }
        probing = true
        readiness.becameVisible()
    }

    private func stopProbing() {
        guard probing else { return }
        probing = false
        readiness.becameHidden()
    }

    private func permissionsChanged() {
        guard probing, flow.screen == .macos else { return }
        Task { await refreshSection() }
    }

    /// Full Disk Access takes effect on the next launch, and P1 promises mattstack reopens itself.
    /// The probe re-reports the grant every tick, and a second relaunch would start a second app.
    private func relaunchForFullDiskAccess() {
        guard !relaunching, flow.screen == .macos, setupWindow?.isVisible == true else { return }
        relaunching = true
        AppRelaunch.relaunchInPlace(resumeScreen: .macos)
    }

    private func observeActivation() {
        guard activeObserver == nil else { return }
        activeObserver = NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.setupWindow?.isVisible == true else { return }
                await self.refreshSection()
            }
        }
    }

    // MARK: - Cards, invite, create, restore

    private func choose(_ choice: TeamChoice) {
        guard status.busy == nil else { return }
        status.failures[.path] = nil
        team.choice = choice
        guard choice == .solo else { flow.choose(choice); return }
        Task {
            status.busy = .path
            defer { status.busy = nil }
            if let failure = await team.validateAndPrepare() { status.failures[.path] = failure; return }
            flow.choose(.solo)
        }
    }

    private func teamChanged() {
        if team.inviteCode != lastInviteCode {
            lastInviteCode = team.inviteCode
            status.failures[.invite] = nil
            if flow.screen == .invite { previewInvite() }
        }
        if team.hasGoodVerdict != lastVerdict {
            lastVerdict = team.hasGoodVerdict
            if flow.screen == .invite {
                // A second code must never show the first team's rows.
                form.forget(section: "invite")
                if lastVerdict { Task { await refreshSection() } }
            }
        }
        if team.forge != lastForge, flow.screen == .createTeam {
            lastForge = team.forge
            form.forget(section: "create")
            Task { await refreshSection() }
        }
    }

    private func previewInvite() {
        Task { await team.previewInvite() }
    }

    private func joinPressed() async {
        guard status.busy == nil else { return }
        status.busy = .invite
        defer { status.busy = nil }
        status.failures[.invite] = nil
        if let failure = await team.validateAndPrepare() { status.failures[.invite] = failure; return }
        join.reset()
        await join.join()
        switch join.phase {
        case .failed(let detail, _):
            status.failures[.invite] = detail
        case .approved:
            break
        case .unreadable:
            flow.joined()
            await flow.land(reading: form)
        default:
            flow.joined()
        }
    }

    private func createPressed() async {
        guard status.busy == nil else { return }
        status.busy = .createTeam
        defer { status.busy = nil }
        status.failures[.createTeam] = nil
        await team.loadGitHubStatus()
        if let failure = await team.validateAndPrepare() { status.failures[.createTeam] = failure; return }
        flow.created()
    }

    private func restorePressed() async {
        guard status.busy == nil else { return }
        status.busy = .restore
        defer { status.busy = nil }
        status.failures[.restore] = nil
        if let failure = await team.validateAndPrepare() { status.failures[.restore] = failure; return }
        flow.restored()
    }

    // MARK: - The wait

    /// A relaunch onto the wait has no join of its own in flight, so it picks rt's up.
    private func keepCheckingApproval() async {
        guard !join.isPolling else { return }
        guard case .joined(let joined)? = await JoinPageModel.launchStatus(rt: rt), flow.screen == .waiting else { return }
        join.adopt(joined)
        if joined.state == "approved" {
            await landOnRtStage()
        } else {
            join.startPolling()
        }
    }

    private func approved() {
        prepare.start("accounts")
        Task { await form.load(section: "connect") }
        guard flow.screen == .waiting else { return }
        notify(FastSetupLaunch.approvedNotice)
        flow.requested = nil
        flow.approved()
    }

    // MARK: - The bar

    private func startBarIfNeeded() {
        guard flow.screen == .running, FastSetupLaunch.startsRun(stage: .running, runLive: install.isRunning) else { return }
        let state = FileManager.default.contents(atPath: SetupCompletion.statePath(home: AppHome.current))
        status.runStartedAt = FastSetupLaunch.runStartedAt(stateJSON: state) ?? Date()
        install.start()
    }

    /// Takes each phase in order, so a run that starts and ends between two main-queue turns still ends.
    private func phaseChanged(to phase: InstallRunModel.Phase) {
        defer { lastPhase = phase; markRunInFlight() }
        guard lastPhase == .running, phase != .running else { return }
        Task { await runEnded() }
    }

    private func runEnded() async {
        var landed: SetupForm?
        for attempt in 0..<3 {
            if attempt > 0 { try? await Task.sleep(nanoseconds: 2_000_000_000) }
            landed = await flow.landAfterRun(reading: form)
            if landed != nil || install.isRunning { break }
        }
        guard let read = landed, let stage = read.stage else { return }
        if setupWindow?.isInFront != true, let notice = FastSetupLaunch.runEndNotice(stage: stage, paused: read.paused) {
            notify(notice)
        }
        guard FastSetupLaunch.startsRun(stage: stage, runLive: install.isRunning) else { reattached = false; return }
        guard !reattached else {
            TrayLog.warn("setup run ended while rt still holds it; not attaching again")
            return
        }
        reattached = true
        startBarIfNeeded()
    }

    /// The first live failure retries from rt's failed step; after a relaunch rt's paused read names it.
    private func retry() {
        guard !install.isRunning else { return }
        let from = form.whole?.paused?.step ?? install.resumableStepId
        status.runStartedAt = Date()
        reattached = false
        install.start(from: from.flatMap { $0.isEmpty ? nil : $0 })
        flow.retry()
    }

    private func pausedAction(_ action: RowAction) {
        let row = FormRow(id: "paused", title: action.label, subtext: "", state: .todo, detail: "", action: action)
        Task { await actions.perform(row) }
    }

    // MARK: - P7 and closing

    private func openHome() {
        finishSetup()
        if let home = form.form?.home ?? form.whole?.home, let url = URL(string: home.url) {
            if BundleFlavor.isStubActive {
                TrayLog.info("open \(url.host ?? home.url) skipped (stub mode)")
            } else {
                NSWorkspace.shared.open(url)
            }
        }
        setupWindow?.close()
    }

    /// P7's finish path, the one place closing on it or pressing its button records Finish.
    private func finishSetup() {
        guard finishPending else { return }
        finishPending = false
        sawUnfinished = false
        SetupSession.markFinished()
        recordFinish()
    }

    private func windowClosed() {
        form.stopWatching()
        stopProbing()
        if flow.screen == .ready { finishSetup() }
        let entry = flow.entry, applied = flow.screen == .ready
        Task { @MainActor in await settingsRefresher.setupWindowClosed(entry: entry, applied: applied) }
    }

    /// Until this lands on disk the next launch reopens setup, so a failure
    /// is logged with rt's own message.
    private func recordFinish() {
        let rt = self.rt
        Task { @MainActor in
            do {
                let r = try await rt.run(SetupCompletion.finishArguments, stdin: nil)
                if let e = r.userError {
                    TrayLog.warn("setup finish refused", ["err": e.message])
                } else if r.exitCode != 0 {
                    TrayLog.warn("setup finish failed", ["exit": String(r.exitCode), "detail": r.failureCopy(verb: "setup finish")])
                } else if let note = SetupCompletion.finishReport(stderr: r.stderr) {
                    TrayLog.warn("setup finish reported", ["detail": note])
                }
            } catch {
                TrayLog.warn("setup finish did not run", ["err": String(describing: error)])
            }
        }
    }

    // MARK: - Settings

    func showSettings(pane: SettingsPane? = nil) {
        if settingsWindow == nil {
            let env = SettingsEnvironment(rt: rt, needs: needs, permissions: permissions, readiness: readiness, updater: updater, apps: appsSettings, team: teamSettings,
                                          devLogins: devLogins,
                                          waivers: WaiverClient(rt: rt),
                                          isDevBuild: BundleFlavor.isDevBuild,
                                          version: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev",
                                          // An unfinished first run is only brought forward: re-entering it
                                          // as an upgrade would pull a live setup onto the invite.
                                          onJoinAnotherTeam: { [weak self] in
                                              guard let self else { return }
                                              guard self.setupIsComplete else { self.resumeSetup(); return }
                                              let code = self.pendingTeamJoinCode
                                              self.pendingTeamJoinCode = nil
                                              self.showSetup(entry: .upgrade, choice: .join, joinCode: code)
                                          },
                                          onCreateTeam: { [weak self] in
                                              guard let self else { return }
                                              guard self.setupIsComplete else { self.resumeSetup(); return }
                                              self.showSetup(entry: .upgrade, choice: .create)
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
    /// team," not first-run onboarding: it goes straight to Settings › Team,
    /// with the code held ready for "Join another team…" to prefill. On an
    /// unfinished Mac it opens setup on the invite with the code filled in.
    func handleJoin(code: String) {
        if setupIsComplete {
            pendingTeamJoinCode = code
            showSettings(pane: .team)
        } else {
            showSetup(joinCode: code)
        }
    }
}

struct RtPlanSource: PlanSource {
    let rt: RtRunning
    let verb: [String]
    /// The setup UI shows a failure's `RtJSONFailure.copy` as is, so the raw error is logged here, where every fetch passes.
    func fetchPlan() async throws -> Plan {
        let label = verb.filter { $0 != "--json" }.joined(separator: " ")
        let result: RtResult
        do {
            result = try await rt.run(verb, stdin: nil)
        } catch {
            throw failure(error, copy: (error as? RtClientError)?.copy ?? "rt \(label) failed to start.")
        }
        if let e = result.userError { throw failure(e, copy: e.message) }
        do {
            return try result.decode(Plan.self)
        } catch {
            throw failure(error, copy: result.failureCopy(verb: label))
        }
    }

    private func failure(_ error: Error, copy: String) -> RtJSONFailure {
        TrayLog.warn("plan fetch failed", ["verb": verb.joined(separator: " "), "err": String(describing: error)])
        return RtJSONFailure(copy: copy)
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
