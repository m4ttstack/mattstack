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

    private struct Drive {
        let id: UUID
        let run: TestDriveRun
        let root: URL
        let coordinator: SetupCoordinator
    }

    /// `permissions` and `updater` only satisfy the coordinator: a drive's effects never reach them.
    init(permissions: PermissionsService, updater: UpdaterController) {
        self.permissions = permissions
        self.updater = updater
    }

    func showPicker() {
        model.problem = Self.stubLocation() == nil ? Self.noStub : nil
        let window = picker ?? makePicker()
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func makePicker() -> NSWindow {
        let view = TestDrivePickerView(model: model, actions: TestDrivePickerActions(
            start: { [weak self] in self?.startPicked() },
            show: { [weak self] in self?.showDrive() },
            reset: { [weak self] in self?.reset() },
            cancel: { [weak self] in self?.picker?.close() }))
        let hosting = NSHostingController(rootView: view)
        let window = NSWindow(contentViewController: hosting)
        window.styleMask = [.titled, .closable]
        window.title = "Test drive setup"
        window.isReleasedWhenClosed = false
        window.setContentSize(hosting.view.fittingSize)
        picker = window
        return window
    }

    private func startPicked() {
        start(TestDriveRun(scenario: model.scenario, speed: model.speed))
    }

    private func showDrive() {
        picker?.close()
        drive?.coordinator.resumeSetup()
    }

    /// Clears the stub's state and starts the same scenario again from P1.
    private func reset() {
        start(drive?.run ?? TestDriveRun(scenario: model.scenario, speed: model.speed))
    }

    private func start(_ run: TestDriveRun) {
        endDrive()
        guard let location = Self.stubLocation() else {
            model.problem = Self.noStub
            showPicker()
            return
        }
        let id = UUID()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("\(Self.rootPrefix)\(id.uuidString.prefix(8))")
        let stateDir = root.appendingPathComponent("state"), home = root.appendingPathComponent("home")
        do {
            try FileManager.default.createDirectory(at: stateDir, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        } catch {
            model.problem = "Couldn't make a folder for the test drive"
            showPicker()
            return
        }
        let rt = RtClient(location: location, environment: TestDrive.environment(scenario: run.scenario, speed: run.speed,
                                                                                 stateDir: stateDir.path, home: home.path))
        let toasts = self.toasts
        let delay = run.speed.answerDelay
        let needs = NeedBroker(services: TestDriveServices(toasts: toasts), privileged: TestDrivePrivileged(toasts: toasts, delay: delay))
        let host = SetupHost(
            isTestDrive: true,
            home: home.path,
            effects: { _, reload in TestDriveEffects(rt: rt, toasts: toasts, delay: delay, reload: reload) },
            openHome: { url in toasts.show(TestDriveCopy.wouldOpen(url)) },
            pasteboard: TestDrivePasteboard(),
            joinPollInterval: run.speed.joinPollInterval,
            windowTitle: "Test drive setup",
            chromeHeight: TestDriveFrame.bannerHeight,
            decorate: { [weak self] content in
                AnyView(TestDriveFrame(toasts: toasts, run: run,
                                       onScenarios: { self?.showPicker() }, onReset: { self?.reset() }, content: content))
            },
            windowClosed: { [weak self] screen in self?.windowClosed(id, on: screen) })
        let coordinator = SetupCoordinator(
            rt: rt, permissions: permissions, permissionProbe: TestDrivePermissionProbe(), needs: needs, updater: updater,
            notify: { [weak self] notice in self?.notified(id, notice) },
            registerLoginItem: { toasts.show(TestDriveCopy.wouldStartAtLogin) },
            host: host)
        drive = Drive(id: id, run: run, root: root, coordinator: coordinator)
        model.live = run
        model.note = nil
        model.problem = nil
        picker?.close()
        TrayLog.info("test drive started", ["scenario": run.scenario.stubScenario, "speed": run.speed.rawValue])
        coordinator.showSetup()
    }

    private func endDrive() {
        guard let drive else { return }
        self.drive = nil
        model.live = nil
        drive.coordinator.shutDown()
        Self.removeRoot(drive.root)
    }

    /// The real app's banner would bring setup back when clicked; the drive does what that click does.
    private func notified(_ id: UUID, _ notice: SetupNotice) {
        guard let drive, drive.id == id else { return }
        toasts.show(TestDriveCopy.wouldNotify(notice))
        drive.coordinator.resumeSetup()
    }

    /// P7 closing ends the drive's walk: the picker comes back with where it would have gone.
    private func windowClosed(_ id: UUID, on screen: FastSetupScreen) {
        guard drive?.id == id, screen == .ready else { return }
        model.note = toasts.latest.map { "Finished. \($0)" } ?? "Finished"
        showPicker()
    }

    private static let rootPrefix = "mattstack-test-drive-"
    private static let noStub = "Needs the mattstack checkout and bun on this Mac"

    /// Only a folder this controller made, under this user's temporary directory, is ever removed.
    private static func removeRoot(_ root: URL) {
        let temp = FileManager.default.temporaryDirectory.standardizedFileURL.path
        let path = root.standardizedFileURL.path
        guard path.hasPrefix(temp + "/"), root.lastPathComponent.hasPrefix(rootPrefix) else { return }
        try? FileManager.default.removeItem(at: root)
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
