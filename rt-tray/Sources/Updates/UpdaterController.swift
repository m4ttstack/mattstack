import AppKit
import Sparkle
import MattstackCore

/// Sparkle for an LSUIElement app: a scheduled update opens Sparkle's own
/// window in front (only the menu item while setup runs), a menu item bound
/// to canCheckForUpdates, an update put off to quit installs once idle (held
/// while a window is open or setup runs), and nothing at all in the dev flavor.
final class UpdaterController: NSObject, UpdateChecking, SPUUpdaterDelegate, SPUStandardUserDriverDelegate, @unchecked Sendable {
    @objc dynamic private(set) var canCheckForUpdates = false
    var onUpdateAvailable: ((String) -> Void)?
    /// Called on the main queue once per downloaded update that cannot install yet.
    var onUpdateHeld: ((String, UpdateHold) -> Void)?
    /// Called on the main thread, synchronously, so the flag it sets is in
    /// place before Sparkle's installer sends its quit event.
    var onUpdateInstallingChanged: ((Bool) -> Void)?
    private let enabled: Bool
    private var controller: SPUStandardUpdaterController?
    private var observation: NSKeyValueObservation?
    private let installer: HeldUpdateInstaller
    private let isBusy: () -> Bool
    private var status = UpdateStatus()
    private var retryTimer: Timer?
    private static let retryInterval: TimeInterval = 60

    private let feedOverride: String?

    // These delegate methods are optional, so a Sparkle rename would leave
    // ours compiling but never called; naming them here fails the build.
    private static let requiredDelegateSelectors = [
        #selector(SPUUpdaterDelegate.updater(_:willInstallUpdate:)),
        #selector(SPUUpdaterDelegate.updater(_:didFinishUpdateCycleFor:error:)),
    ]

    init(isDevBuild: Bool, isBusy: @escaping () -> Bool) {
        self.isBusy = isBusy
        installer = HeldUpdateInstaller(setupRunning: isBusy, windowsOpen: {
            NSApp.windows.filter {
                UpdatePolicy.windowHoldsUpdate(isVisible: $0.isVisible, isMiniaturized: $0.isMiniaturized, canBecomeKey: $0.canBecomeKey)
            }.count
        })
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
    }

    var automaticallyChecks: Bool {
        get { controller?.updater.automaticallyChecksForUpdates ?? false }
        set { controller?.updater.automaticallyChecksForUpdates = newValue }
    }
    var isEnabled: Bool { enabled }

    @objc func checkForUpdatesFromMenu() {
        guard let c = controller else {
            TrayLog.info("update check skipped (dev build)", ["source": "menu"])
            return
        }
        // A held update stalls Sparkle's session, so its own check would do nothing.
        if let version = installer.heldVersion {
            let started = installer.installNow()
            TrayLog.info(started ? "held update installing" : "held update waits for setup", ["version": version, "source": "menu"])
            return
        }
        c.checkForUpdates(nil)
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
        retryTimer = Timer.scheduledTimer(withTimeInterval: Self.retryInterval, repeats: true) { [weak self] timer in
            guard let self, self.installer.retry() else { return }
            timer.invalidate()
            TrayLog.info("held update installing", ["version": self.installer.heldVersion ?? "", "source": "idle"])
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
        onUpdateInstallingChanged?(true)
    }

    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: (any Error)?) {
        onUpdateInstallingChanged?(false)
        let checkedAt = updater.lastUpdateCheckDate
        DispatchQueue.main.async { self.writeStatus { $0.lastCheckAt = checkedAt } }
    }

    func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem,
                 immediateInstallationBlock immediateInstallHandler: @escaping () -> Void) -> Bool {
        recordPending(item)
        let version = item.displayVersionString
        let hold = installer.offer(version: version) { DispatchQueue.main.async { immediateInstallHandler() } }
        writeStatus {
            $0.heldVersion = hold == nil ? nil : version
            $0.hold = UpdateStatus.holdName(hold)
        }
        if let hold {
            TrayLog.info("update held", ["version": version, "hold": String(describing: hold)])
            startRetrying()
            DispatchQueue.main.async { self.onUpdateHeld?(version, hold) }
        }
        return true
    }
}
