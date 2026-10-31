import AppKit
import SwiftUI
import Combine
import MattstackCore

/// One dedicated NSWindow hosting fast setup (AppKit lifecycle stays). It
/// keeps `width` and takes each screen's own height, as the mocks do, between
/// `minHeight` and the screen's visible height; a screen taller than that
/// scrolls inside. Dark whatever the system appearance. Always closable:
/// closing never stops the join's approval check or a run, which the coordinator owns.
final class SetupWindowController: NSWindowController, NSWindowDelegate {
    static let width: CGFloat = FastTheme.windowWidth
    static let minHeight: CGFloat = 340
    var onClose: (@MainActor () -> Void)?
    private let flow: FastSetupFlow
    /// A test drive's window is never setup in progress to the updater.
    private let tracksSession: Bool
    private let chromeHeight: CGFloat
    private var cancellables = Set<AnyCancellable>()

    /// `chromeHeight` is what the root draws above the screens (a test drive's banner).
    /// Such a window keeps macOS's title bar over it, so the banner never sits under the traffic lights.
    init<Root: View>(flow: FastSetupFlow, root: Root, title: String = "mattstack Setup", tracksSession: Bool = true, chromeHeight: CGFloat = 0) {
        self.flow = flow
        self.tracksSession = tracksSession
        self.chromeHeight = chromeHeight
        let height = 620 + chromeHeight
        var style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable]
        if chromeHeight == 0 { style.insert(.fullSizeContentView) }
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: Self.width, height: height),
                              styleMask: style, backing: .buffered, defer: false)
        window.title = title
        window.appearance = FastAppearance.window
        window.backgroundColor = FastTheme.windowFill
        // The mocks blend their translucent tiles and glow in sRGB; a wide-gamut display's space blends them stronger.
        window.colorSpace = .sRGB
        if chromeHeight == 0 {
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
        }
        window.isReleasedWhenClosed = false
        window.center()
        super.init(window: window)
        window.delegate = self
        let hosting = FittingHostingController(rootView: AnyView(root.frame(width: Self.width)))
        hosting.sizingOptions = [.preferredContentSize]
        hosting.safeAreaRegions = []
        hosting.onPreferredSize = { [weak self] size in DispatchQueue.main.async { self?.fit(to: size) } }
        window.contentViewController = hosting
        window.setContentSize(NSSize(width: Self.width, height: height))
        hosting.view.layoutSubtreeIfNeeded()
        fit(to: hosting.preferredContentSize)
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

    /// The window's content height for a screen whose ideal height is `ideal`, on a screen showing `visible` points.
    static func fittedHeight(ideal: CGFloat, chromeHeight: CGFloat, visible: CGFloat) -> CGFloat {
        min(max(ideal, minHeight + chromeHeight), visible).rounded()
    }

    /// Grows or shrinks from the top edge, so the title bar stays where the person left it.
    private func fit(to ideal: NSSize) {
        guard let window, ideal.height > 0 else { return }
        let visibleFrame = (window.screen ?? NSScreen.main)?.visibleFrame
        let titlebar = window.frame.height - window.contentRect(forFrameRect: window.frame).height
        let content = Self.fittedHeight(ideal: ideal.height, chromeHeight: chromeHeight,
                                        visible: (visibleFrame?.height ?? 900) - titlebar)
        var frame = window.frame
        let target = content + titlebar
        guard abs(frame.height - target) > 0.5 else { return }
        frame.origin.y += frame.height - target
        frame.size.height = target
        if let visibleFrame, frame.minY < visibleFrame.minY { frame.origin.y = visibleFrame.minY }
        window.setFrame(frame, display: true, animate: window.isVisible)
    }

    /// Ground truth, not "we just showed it": a late screen change after the
    /// window has closed must not re-arm the updater's idle gate.
    private func applyStyle() {
        guard tracksSession else { return }
        let running = isVisible && flow.screen != .ready
        SetupSession.setRunning(running, for: ObjectIdentifier(self))
    }

    func windowWillClose(_ notification: Notification) {
        if tracksSession { SetupSession.setRunning(false, for: ObjectIdentifier(self)) }
        onClose?()
    }
}

/// Reports each new ideal size of the SwiftUI content, which the window fits itself to.
private final class FittingHostingController: NSHostingController<AnyView> {
    var onPreferredSize: ((NSSize) -> Void)?

    override var preferredContentSize: NSSize {
        didSet { if preferredContentSize != oldValue { onPreferredSize?(preferredContentSize) } }
    }
}
