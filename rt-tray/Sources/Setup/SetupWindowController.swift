import AppKit
import SwiftUI
import Combine
import MattstackCore

struct SetupEnvironment {
    let rt: RtRunning
    let needs: NeedBroker
    let readiness: ReadinessModel
    let install: InstallRunModel
    let permissions: PermissionsService
    let join: JoinPageModel
    let isDevBuild: Bool
    let bundleId: String
    let bundlePath: String
    /// "Setup status…" — screen 3 as a health view, never a wizard step
    /// (SetupFlowModel.readOnly carries the footer semantics).
    var readOnly = false
}

/// One dedicated NSWindow hosting SwiftUI (AppKit lifecycle stays). Opens
/// at `width` and resizes no smaller; close/minimize appear only once setup
/// is done.
final class SetupWindowController: NSWindowController, NSWindowDelegate {
    static let width: CGFloat = 720
    static let minHeight: CGFloat = 560
    let flow: SetupFlowModel
    let team: TeamChoiceModel
    let done: DoneModel
    /// Set by the caller (e.g. re-entering an already-complete setup, or the
    /// read-only "Setup status…" view) to make the window closable even
    /// though `flow` itself hasn't reached `.done` — a wizard step must never
    /// double as a trap once there's nothing left to walk the user through.
    var allowsCloseAlways = false
    var onClose: (@MainActor (SetupEntry) -> Void)?
    private let environment: SetupEnvironment
    private var activeObserver: Any?
    private var cancellables = Set<AnyCancellable>()

    init(environment: SetupEnvironment) {
        self.environment = environment
        self.flow = SetupFlowModel(readOnly: environment.readOnly)
        self.team = TeamChoiceModel(rt: environment.rt, pasteboard: SystemPasteboard())
        self.done = DoneModel(readiness: environment.readiness, waivers: WaiverClient(rt: environment.rt))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: Self.width, height: 620),
                              styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        window.contentMinSize = NSSize(width: Self.width, height: Self.minHeight)
        window.title = "mattstack Setup"
        window.isReleasedWhenClosed = false
        window.center()
        super.init(window: window)
        window.delegate = self
        let root = SetupView(flow: flow, team: team, readiness: environment.readiness, install: environment.install, done: done,
                             join: environment.join, permissions: environment.permissions, env: environment,
                             onFinish: { [weak self] in self?.window?.close() })
        window.contentViewController = NSHostingController(rootView: root)
        window.setContentSize(NSSize(width: Self.width, height: 620))
        flow.objectWillChange.sink { [weak self] _ in DispatchQueue.main.async { self?.applyStyle() } }
            .store(in: &cancellables)
    }
    required init?(coder: NSCoder) { fatalError("not supported") }

    func show(step: SetupStep? = nil, joinCode: String? = nil, entry: SetupEntry = .firstRun, choice: TeamChoice? = nil) {
        flow.entry = entry
        if let step { flow.jump(to: step, landing: step == .checklist && !flow.readOnly) }
        team.enter(entry, choice: choice, joinCode: joinCode)
        if entry == .firstRun, !flow.readOnly, flow.step == .checklist { resumeAnUnfinishedJoin() }
        // The page's own onAppear does not fire again for a window shown a second time.
        if flow.step == .join { environment.join.startPolling() }
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        applyStyle()
        window?.center()
        NSApp.activate(ignoringOtherApps: true)
        // A second show() while already open (deep link, tray re-click) must
        // not accumulate observers — each would fire didBecomeActive() again.
        if let o = activeObserver { NotificationCenter.default.removeObserver(o) }
        activeObserver = NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.environment.readiness.didBecomeActive() }
        }
    }

    /// A Mac that chose an invite reopens on the checklist, which must never
    /// Install before the join: one not joined yet goes back to the Join
    /// page, and one that joined and quit before approval goes back to the wait.
    private func resumeAnUnfinishedJoin() {
        let rt = environment.rt
        flow.resolvingJoin = true
        Task { @MainActor [weak self] in
            let launch = await JoinPageModel.launchStatus(rt: rt)
            guard let self else { return }
            defer { self.flow.resolvingJoin = false }
            guard self.flow.step == .checklist else { return }
            switch launch {
            case .unredeemed?:
                break
            case .joined(let status)? where status.state == "waiting":
                self.environment.join.adopt(status)
            default:
                return
            }
            self.flow.joining = true
            self.flow.jump(to: .join)
        }
    }

    private func applyStyle() {
        guard let window else { return }
        var mask: NSWindow.StyleMask = [.titled, .resizable]
        if flow.windowMayClose || allowsCloseAlways { mask.insert([.closable, .miniaturizable]) }
        window.styleMask = mask
        // Ground truth, not "we just showed it": a late write to flow after
        // the window has actually closed must not re-arm the updater's idle
        // gate forever. A window that's only closable because the caller
        // forced it (already-complete setup, the status view) isn't an
        // active onboarding run either, so it contributes `false` — keyed by
        // this controller's own identity so one window's restyle can never
        // clobber another window's still-genuine "running" state.
        let running = window.isVisible && !flow.windowMayClose && !allowsCloseAlways
        SetupSession.setRunning(running, for: ObjectIdentifier(self))
    }

    func windowWillClose(_ notification: Notification) {
        SetupSession.setRunning(false, for: ObjectIdentifier(self))
        // The hosting view outlives the window, so the page's onDisappear never fires on close.
        environment.join.stopPolling()
        // Only balances an outstanding becameVisible() (see
        // SetupFlowModel.readinessIsVisible) — closing on a step that
        // already left .checklist must not send a second, unmatched hide.
        if flow.readinessIsVisible {
            flow.readinessIsVisible = false
            environment.readiness.becameHidden()
        }
        if let o = activeObserver { NotificationCenter.default.removeObserver(o) }
        onClose?(flow.entry)
    }
}
