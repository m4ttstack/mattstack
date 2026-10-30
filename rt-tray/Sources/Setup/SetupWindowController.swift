import AppKit
import SwiftUI
import Combine
import MattstackCore

/// What the checklist `SetupView` reads; nothing opens it any more.
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

/// One dedicated NSWindow hosting fast setup (AppKit lifecycle stays). Opens
/// at `width` and resizes no smaller. Always closable: closing never stops
/// the join's approval check or a run, which the coordinator owns.
final class SetupWindowController: NSWindowController, NSWindowDelegate {
    static let width: CGFloat = 720
    static let minHeight: CGFloat = 560
    var onClose: (@MainActor () -> Void)?
    private let flow: FastSetupFlow
    private var cancellables = Set<AnyCancellable>()

    init<Root: View>(flow: FastSetupFlow, root: Root) {
        self.flow = flow
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: Self.width, height: 620),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.contentMinSize = NSSize(width: Self.width, height: Self.minHeight)
        window.title = "mattstack Setup"
        window.isReleasedWhenClosed = false
        window.center()
        super.init(window: window)
        window.delegate = self
        window.contentViewController = NSHostingController(rootView: root)
        window.setContentSize(NSSize(width: Self.width, height: 620))
        flow.$screen.sink { [weak self] _ in DispatchQueue.main.async { self?.applyStyle() } }
            .store(in: &cancellables)
    }
    required init?(coder: NSCoder) { fatalError("not supported") }

    var isVisible: Bool { window?.isVisible == true }
    /// A banner is for a person who is not looking at this window.
    var isInFront: Bool { NSApp.isActive && window?.isKeyWindow == true }

    func show() {
        let wasVisible = isVisible
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        if !wasVisible { window?.center() }
        applyStyle()
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Ground truth, not "we just showed it": a late screen change after the
    /// window has closed must not re-arm the updater's idle gate.
    private func applyStyle() {
        let running = isVisible && flow.screen != .ready
        SetupSession.setRunning(running, for: ObjectIdentifier(self))
    }

    func windowWillClose(_ notification: Notification) {
        SetupSession.setRunning(false, for: ObjectIdentifier(self))
        onClose?()
    }
}
