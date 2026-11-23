import AppKit
import Sparkle
import MattstackCore

/// Sparkle for an LSUIElement app. With the org's automatic-update setting on
/// (the default), Sparkle downloads and installs an update by itself, held
/// only while setup runs or the daemon is busy. With it off, a scheduled
/// update opens Sparkle's own window in front (only the menu item while setup
/// runs), and an update put off to quit installs once no window is open.
/// A menu item is bound to canCheckForUpdates; the dev flavor runs none of it.
final class UpdaterController: NSObject, UpdateChecking, SPUUpdaterDelegate, SPUStandardUserDriverDelegate, @unchecked Sendable {
    @objc dynamic private(set) var canCheckForUpdates = false
    var onUpdateAvailable: ((String) -> Void)?
    /// Called on the main queue once per downloaded update that cannot install yet.
    var onUpdateHeld: ((String, UpdateHold) -> Void)?
    /// Called on the main thread, synchronously, so the flag it sets is in
    /// place before Sparkle's installer sends its quit event.
    var onUpdateInstallingChanged: ((Bool) -> Void)?
    /// The windows to reopen after the install relaunches the app.
    var openWindows: (() -> Set<RestorableWindow>)?
    private let windowRestore = WindowRestore(defaults: .standard)
    private let enabled: Bool
    private var controller: SPUStandardUpdaterController?
    private var observation: NSKeyValueObservation?
    private let installer: HeldUpdateInstaller
    private let isBusy: () -> Bool
    private let readAutoUpdate: () async -> Bool
    private let daemonBusyProbe: () async -> Bool
    private let policy = PolicyState()
    private var status = UpdateStatus()
    private var retryTimer: Timer?
    private var policyTimer: Timer?
    private static let retryInterval: TimeInterval = 60
    private static let policyInterval: TimeInterval = 600
    private static let readDeadline: TimeInterval = 5

    /// The hold checks are synchronous and the reads behind them are not, so
    /// the last answers are kept here, read and written on the main thread.
    private final class PolicyState: @unchecked Sendable {
        var silent = true
        var daemonBusy = false
    }

    private let feedOverride: String?

    // These delegate methods are optional, so a Sparkle rename would leave
    // ours compiling but never called; naming them here fails the build.
    private static let requiredDelegateSelectors = [
        #selector(SPUUpdaterDelegate.updater(_:willInstallUpdate:)),
        #selector(SPUUpdaterDelegate.updater(_:didFinishUpdateCycleFor:error:)),
    ]

    init(isDevBuild: Bool, isBusy: @escaping () -> Bool,
         readAutoUpdate: @escaping () async -> Bool, daemonBusy: @escaping () async -> Bool) {
        self.isBusy = isBusy
        self.readAutoUpdate = readAutoUpdate
        daemonBusyProbe = daemonBusy
        let policy = self.policy
        installer = HeldUpdateInstaller(silent: { policy.silent }, setupRunning: isBusy, windowsOpen: {
            NSApp.windows.filter {
                UpdatePolicy.windowHoldsUpdate(isVisible: $0.isVisible, isMiniaturized: $0.isMiniaturized, canBecomeKey: $0.canBecomeKey)
            }.count
        }, daemonBusy: { policy.daemonBusy })
        let info = Bundle.main.infoDictionary
        feedOverride = UpdatePolicy.feedOverride(environment: ProcessInfo.processInfo.environment,
                                                 arguments: CommandLine.arguments, isDevBuild: isDevBuild)
        enabled = UpdatePolicy.shouldStartUpdater(isDevBuild: isDevBuild,
                                                  publicEDKey: info?["SUPublicEDKey"] as? String,
                                                  feedURL: info?["SUFeedURL"] as? String,
                                                  feedOverride: feedOverride)
        if let feedOverride { TrayLog.info("appcast override in force", ["url": feedOverride]) }
        super.init()
        guard enabled else {
            TrayLog.info("update check skipped (dev build)", ["dev": isDevBuild])
            return
        }
        let c = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: self)
        controller = c
        writeStatus { $0 = UpdateStatus(lastCheckAt: c.updater.lastUpdateCheckDate) }
        observation = c.updater.observe(\.canCheckForUpdates, options: [.initial, .new]) { [weak self] updater, _ in
            self?.canCheckForUpdates = updater.canCheckForUpdates
        }
        // Until the setting is read, Sparkle keeps the download mode the last
        // run gave it: a guess here could install silently on an org that
        // turned that off.
        policy.silent = c.updater.automaticallyDownloadsUpdates
        c.updater.automaticallyChecksForUpdates = true
        c.updater.updateCheckInterval = UpdatePolicy.checkInterval
        Task { await self.refreshPolicy() }
        policyTimer = Timer.scheduledTimer(withTimeInterval: Self.policyInterval, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { await self.refreshPolicy() }
        }
    }

    var isEnabled: Bool { enabled }

    /// Re-reads the setting and, when silent, the daemon's busy state, then
    /// applies them to Sparkle.
    func refreshPolicy() async {
        guard enabled else { return }
        // A hung rt must not hold an update for good: past the deadline the
        // last setting stands and the daemon counts as not busy.
        let readSetting = readAutoUpdate
        let probe = daemonBusyProbe
        let lastSilent = policy.silent
        let silent = await firstAnswer(within: Self.readDeadline, otherwise: lastSilent) { await readSetting() }
        let busy = silent ? await firstAnswer(within: Self.readDeadline, otherwise: false) { await probe() } : false
        await MainActor.run { self.apply(silent: silent, daemonBusy: busy) }
    }

    /// Sparkle keeps a value set at runtime in UserDefaults over the plist, so
    /// checking is switched back on here for a Mac whose person once turned it
    /// off; nothing in the app turns it off any more.
    private func apply(silent: Bool, daemonBusy: Bool) {
        policy.silent = silent
        policy.daemonBusy = daemonBusy
        guard let updater = controller?.updater else { return }
        updater.automaticallyChecksForUpdates = true
        updater.automaticallyDownloadsUpdates = silent
        updater.updateCheckInterval = UpdatePolicy.checkInterval
        if !silent, installer.heldVersion == nil, status.hold != UpdateStatus.orgOff {
            writeStatus { $0.heldVersion = nil; $0.hold = UpdateStatus.orgOff }
        } else if silent, status.hold == UpdateStatus.orgOff {
            writeStatus { $0.hold = nil }
        }
    }

    @objc func checkForUpdatesFromMenu() {
        guard let c = controller else {
            TrayLog.info("update check skipped (dev build)", ["source": "menu"])
            return
        }
        // A held update stalls Sparkle's session, so its own check would do nothing.
        if let version = installer.heldVersion {
            let started = installer.installNow()
            TrayLog.info(started ? "held update installing" : "held update waits for setup or the daemon", ["version": version, "source": "menu"])
            return
        }
        c.checkForUpdates(nil)
    }

    /// The windows open when the install quit the app; empty once taken.
    func takeWindowsToReopen() -> [RestorableWindow] {
        windowRestore.take()
    }

    /// The version a previous run was installing, once it is the one running.
    func takeInstalledVersion() -> String? {
        let defaults = UserDefaults.standard
        let running = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        switch UpdateNotice.launch(pendingVersion: defaults.string(forKey: UpdateNotice.pendingVersionKey), runningVersion: running) {
        case .installed(let version):
            defaults.removeObject(forKey: UpdateNotice.pendingVersionKey)
            return version
        case .none, .stillPending:
            return nil
        }
    }

    private func recordPending(_ item: SUAppcastItem) {
        UserDefaults.standard.set(item.displayVersionString, forKey: UpdateNotice.pendingVersionKey)
    }

    private func writeStatus(_ change: (inout UpdateStatus) -> Void) {
        change(&status)
        guard enabled else { return }
        let path = AppHome.current + "/.mattstack/rt/" + UpdateStatus.fileName
        do {
            try status.encoded().write(to: URL(fileURLWithPath: path), options: .atomic)
        } catch {
            TrayLog.info("update status not written", ["error": String(describing: error)])
        }
    }

    private func startRetrying() {
        retryTimer?.invalidate()
        retryTimer = Timer.scheduledTimer(withTimeInterval: Self.retryInterval, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task {
                await self.refreshPolicy()
                await MainActor.run {
                    let version = self.installer.heldVersion ?? ""
                    guard self.installer.retry() else { return }
                    self.retryTimer?.invalidate()
                    self.retryTimer = nil
                    TrayLog.info("held update installing", ["version": version, "source": "idle"])
                }
            }
        }
    }

    func checkForUpdates() async -> Bool {
        guard let c = controller else {
            TrayLog.info("update check skipped (dev build)", ["source": "seam"])
            return false
        }
        await MainActor.run { c.updater.checkForUpdates() }
        return true
    }

    // MARK: SPUStandardUserDriverDelegate — the update window

    var supportsGentleScheduledUpdateReminders: Bool { true }

    // Sparkle shows a background app's scheduled update behind every other
    // app unless it proposes immediate focus, so the window is opened here.
    func standardUserDriverShouldHandleShowingScheduledUpdate(_ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool) -> Bool {
        false
    }

    func standardUserDriverWillHandleShowingUpdate(_ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState) {
        let version = update.displayVersionString
        if !handleShowingUpdate || state.userInitiated == false {
            DispatchQueue.main.async { self.onUpdateAvailable?(version) }
        }
        let opens = UpdatePolicy.opensUpdateWindow(handledBySparkle: handleShowingUpdate,
                                                   userInitiated: state.userInitiated,
                                                   setupRunning: isBusy())
        DispatchQueue.main.async {
            self.writeStatus {
                $0.offeredVersion = version
                $0.lastCheckAt = Date()
            }
            guard opens, let c = self.controller else { return }
            TrayLog.info("update window opened", ["version": version])
            NSApp.activate(ignoringOtherApps: true)
            c.checkForUpdates(nil)
        }
    }

    func standardUserDriverWillFinishUpdateSession() {
        DispatchQueue.main.async { self.onUpdateAvailable?("") }
    }

    // MARK: SPUUpdaterDelegate — feed override, install when idle

    func feedURLString(for updater: SPUUpdater) -> String? { feedOverride }

    // Sparkle calls this once per update session, just before it asks its
    // installer to quit the app, and not again when "Install and Relaunch"
    // is retried, so the flag must hold until the cycle ends.
    func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) {
        TrayLog.info("update installing", ["version": item.displayVersionString])
        recordPending(item)
        windowRestore.record(openWindows?() ?? [])
        onUpdateInstallingChanged?(true)
    }

    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: (any Error)?) {
        onUpdateInstallingChanged?(false)
        if error != nil { windowRestore.clear() }
        let checkedAt = updater.lastUpdateCheckDate
        DispatchQueue.main.async { self.writeStatus { $0.lastCheckAt = checkedAt } }
    }

    func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem,
                 immediateInstallationBlock immediateInstallHandler: @escaping () -> Void) -> Bool {
        recordPending(item)
        let version = item.displayVersionString
        // Silent, the daemon's last busy answer may be minutes old, so the
        // update is held as busy until a fresh one arrives.
        if policy.silent { policy.daemonBusy = true }
        let hold = installer.offer(version: version) { DispatchQueue.main.async { immediateInstallHandler() } }
        guard let hold else {
            writeStatus { $0.heldVersion = nil; $0.hold = nil }
            return true
        }
        guard hold == .daemonBusy else {
            reportHeld(version, hold)
            return true
        }
        startRetrying()
        Task {
            await self.refreshPolicy()
            await MainActor.run {
                if self.installer.retry() {
                    TrayLog.info("held update installing", ["version": version, "source": "offer"])
                    self.writeStatus { $0.heldVersion = nil; $0.hold = nil }
                } else if let current = self.installer.pendingHold() {
                    self.reportHeld(version, current)
                }
            }
        }
        return true
    }

    private func reportHeld(_ version: String, _ hold: UpdateHold) {
        writeStatus {
            $0.heldVersion = version
            $0.hold = UpdateStatus.holdName(hold)
        }
        TrayLog.info("update held", ["version": version, "hold": String(describing: hold)])
        startRetrying()
        DispatchQueue.main.async { self.onUpdateHeld?(version, hold) }
    }
}
