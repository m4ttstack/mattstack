import AppKit
import SwiftUI
import MattstackCore

/// "Test drive setup…": the real fast setup window on the stub rt, so setup can be
/// rehearsed on this Mac. Each drive is a coordinator, window, rt and need broker of
/// its own, over a throwaway HOME and stub state dir; the real setup never sees it.
@MainActor
final class TestDriveController {
    private let permissions: PermissionsService
    private let updater: UpdaterController
    private let model = TestDrivePickerModel()
    private let toasts = TestDriveToasts()
    private var picker: NSWindow?
    private var drive: Drive?
    /// Bumped by every picker probe and every start: a probe answer for an older one is dropped.
    private var probeAttempt = 0
    /// Bumped by every start, so only the newest Start or Reset begins a drive.
    private var startAttempt = 0
    /// A start's probe is running; it answers for the picker too, so the picker never cancels it.
    private var starting = false

    private struct Drive {
        let id: UUID
        let run: TestDriveRun
        let root: URL
        let rt: TestDriveRt
        let coordinator: SetupCoordinator
        /// P7's Open the board, which the picker names once the window closes.
        var openedHome: String?
    }

    /// `permissions` and `updater` only satisfy the coordinator: a drive's effects never reach them.
    init(permissions: PermissionsService, updater: UpdaterController) {
        self.permissions = permissions
        self.updater = updater
    }

    func showPicker() {
        presentPicker()
        guard !starting else { return }
        probeAttempt += 1
        let mine = probeAttempt
        model.checking = true
        Task {
            let problem = await Self.problem()
            guard mine == probeAttempt, !starting else { return }
            model.checking = false
            model.problem = problem
        }
    }

    private func presentPicker() {
        let window = picker ?? makePicker()
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// The app is quitting: no drive outlives it, and neither does any drive's folder.
    func shutDown() {
        endDrive()
        Self.removeStaleRoots()
    }

    private func makePicker() -> NSWindow {
        let view = TestDrivePickerView(model: model, toasts: toasts, actions: TestDrivePickerActions(
            start: { [weak self] in self?.startPicked() },
            show: { [weak self] in self?.showDrive() },
            reset: { [weak self] in self?.reset() },
            cancel: { [weak self] in self?.picker?.close() }))
        let hosting = NSHostingController(rootView: view)
        hosting.sizingOptions = .preferredContentSize
        let window = NSWindow(contentViewController: hosting)
        window.styleMask = [.titled, .closable]
        window.title = "Test drive setup"
        window.isReleasedWhenClosed = false
        picker = window
        return window
    }

    private func startPicked() {
        start(TestDriveRun(scenario: model.scenario, speed: model.speed))
    }

    private func showDrive() {
        picker?.close()
        toasts.clearNotice()
        drive?.coordinator.resumeSetup()
    }

    /// Clears the stub's state and starts the same scenario again from P1.
    private func reset() {
        start(drive?.run ?? TestDriveRun(scenario: model.scenario, speed: model.speed))
    }

    /// Scenarios… pressed while this probes only brings the picker forward; this start still runs.
    private func start(_ run: TestDriveRun) {
        endDrive()
        Self.removeStaleRoots()
        startAttempt += 1
        probeAttempt += 1
        let mine = startAttempt
        starting = true
        model.checking = true
        Task {
            let problem = await Self.problem()
            guard mine == startAttempt else { return }
            starting = false
            model.checking = false
            model.problem = problem
            if problem != nil { return presentPicker() }
            begin(run)
        }
    }

    private func begin(_ run: TestDriveRun) {
        guard let location = Self.stubLocation() else {
            model.problem = TestDriveCopy.noStub
            return presentPicker()
        }
        let id = UUID()
        let root = Self.newRoot(id)
        let stateDir = root.appendingPathComponent("state"), home = root.appendingPathComponent("home")
        do {
            try FileManager.default.createDirectory(at: stateDir, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        } catch {
            model.problem = "Couldn't make a folder for the test drive"
            return presentPicker()
        }
        let rt = TestDriveRt(RtClient(location: location, environment: TestDrive.environment(scenario: run.scenario, speed: run.speed,
                                                                                           stateDir: stateDir.path, home: home.path)))
        let toasts = self.toasts
        let delay = run.speed.answerDelay
        let needs = NeedBroker(services: TestDriveServices(toasts: toasts), privileged: TestDrivePrivileged(toasts: toasts, delay: delay))
        let host = SetupHost(
            isTestDrive: true,
            home: home.path,
            effects: { _, reload in TestDriveEffects(rt: rt, toasts: toasts, delay: delay, reload: reload) },
            openHome: { [weak self] url in self?.openedHome(id, url) },
            pasteboard: TestDrivePasteboard(),
            joinPollInterval: run.speed.joinPollInterval,
            windowTitle: "Test drive setup",
            chromeHeight: TestDriveFrame.bannerHeight,
            decorate: { [weak self] content in
                AnyView(TestDriveFrame(toasts: toasts, run: run, onShow: { self?.showDrive() },
                                       onScenarios: { self?.showPicker() }, onReset: { self?.reset() }, content: content))
            },
            windowClosed: { [weak self] screen in self?.windowClosed(id, on: screen) })
        let coordinator = SetupCoordinator(
            rt: rt, permissions: permissions, permissionProbe: TestDrivePermissionProbe(), needs: needs, updater: updater,
            notify: { [weak self] notice in self?.notified(id, notice) },
            registerLoginItem: { toasts.show(TestDriveCopy.wouldStartAtLogin) },
            host: host)
        drive = Drive(id: id, run: run, root: root, rt: rt, coordinator: coordinator)
        model.live = run
        model.note = nil
        toasts.clearNotice()
        picker?.close()
        TrayLog.info("test drive started", ["scenario": run.scenario.stubScenario, "speed": run.speed.rawValue])
        coordinator.showSetup()
    }

    private func endDrive() {
        guard let drive else { return }
        self.drive = nil
        model.live = nil
        toasts.clearNotice()
        drive.rt.retire()
        drive.coordinator.shutDown()
        Self.removeRoot(drive.root)
    }

    /// A real notification waits on the person's click, so this one waits on Show and never raises the window itself.
    private func notified(_ id: UUID, _ notice: SetupNotice) {
        guard drive?.id == id else { return }
        toasts.notify(TestDriveCopy.wouldNotify(notice))
    }

    private func openedHome(_ id: UUID, _ url: URL) {
        guard drive?.id == id else { return }
        let line = TestDriveCopy.wouldOpen(url)
        drive?.openedHome = line
        toasts.show(line)
    }

    /// P7 closing ends the drive's walk: the picker comes back with where it would have gone.
    private func windowClosed(_ id: UUID, on screen: FastSetupScreen) {
        guard let drive, drive.id == id, screen == .ready else { return }
        model.note = drive.openedHome.map { "Finished. \($0)" } ?? "Finished"
        showPicker()
    }

    // MARK: - The stub and the drive's folders

    private static let rootPrefix = "mattstack-test-drive-"

    private static func newRoot(_ id: UUID) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("\(rootPrefix)\(id.uuidString.prefix(8))")
    }

    /// Only a folder named like this controller's, directly under this user's temporary directory, is ever removed.
    private static func removeRoot(_ root: URL) {
        let temp = FileManager.default.temporaryDirectory.standardizedFileURL
        let path = root.standardizedFileURL
        guard path.deletingLastPathComponent().path == temp.path, path.lastPathComponent.hasPrefix(rootPrefix) else { return }
        try? FileManager.default.removeItem(at: path)
    }

    /// A drive that was live when the app last quit, or that a late call brought back, leaves its folder here.
    private static func removeStaleRoots() {
        let temp = FileManager.default.temporaryDirectory
        let names = (try? FileManager.default.contentsOfDirectory(atPath: temp.path)) ?? []
        for name in names where name.hasPrefix(rootPrefix) { removeRoot(temp.appendingPathComponent(name)) }
    }

    /// Why no drive can start: no checkout or bun, or a stub that refuses the probe. One call, in a folder of its own.
    private static func problem() async -> String? {
        guard let location = stubLocation() else { return TestDriveCopy.noStub }
        let root = newRoot(UUID())
        defer { removeRoot(root) }
        let state = root.appendingPathComponent("state"), home = root.appendingPathComponent("home")
        try? FileManager.default.createDirectory(at: state, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        let rt = RtClient(location: location, environment: TestDrive.environment(scenario: .join, speed: .instant,
                                                                                 stateDir: state.path, home: home.path))
        let problem = TestDrive.stubProblem(probe: try? await rt.run(TestDrive.probeArguments, stdin: nil))
        if let problem { TrayLog.warn("test drive stub probe failed", ["stub": location.argumentPrefix.first ?? "", "problem": problem]) }
        return problem
    }

    /// The tree this dev app was last built from carries the stub that matches it, then the checkout its rt
    /// wrapper runs; a DEBUG build also finds the checkout it was built from. Read only once a person asks for a drive.
    private static func stubLocation() -> RtLocation? {
        let config = BundleFlavor.isDevBuild ? DevSourceConfigReader.read(home: AppHome.current) : nil
        var checkouts = BundleFlavor.isDevBuild ? [DevBuildWatcher.shared.lastSource].compactMap { $0 } : []
        if let config { checkouts.append(config.sourcePath) }
        #if DEBUG
        checkouts.append(URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../..").standardized.path)
        #endif
        let account = NSHomeDirectory()
        let buns = [ProcessInfo.processInfo.environment["RT_STUB_BUN"], config?.bunPath,
                    "\(account)/.bun/bin/bun", "/opt/homebrew/bin/bun", "/usr/local/bin/bun"].compactMap { $0 }
        return TestDrive.stubLocation(checkouts: checkouts, buns: buns, fileExists: { FileManager.default.fileExists(atPath: $0) })
    }
}
