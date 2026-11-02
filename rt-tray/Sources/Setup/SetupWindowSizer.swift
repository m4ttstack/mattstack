import AppKit

/// Sizes the setup window to each screen: a screen opens at its fitted
/// height, which is also the shortest the person can drag it. A drag or a
/// zoom holds its height while that screen shows, growing only when the
/// content needs more; a new screen fits exactly again.
@MainActor
final class SetupWindowSizer {
    private weak var window: NSWindow?
    /// The shortest fitted content height, chrome included.
    private let floor: CGFloat
    private(set) var heldOn: AnyHashable?
    /// AppKit reports an animated `setFrame` as a live resize, inside the call.
    private var fitting = false

    init(window: NSWindow, floor: CGFloat) {
        self.window = window
        self.floor = floor
    }

    /// The window's content height for a screen whose ideal height is `ideal`, on a screen showing `visible` points.
    static func fittedHeight(ideal: CGFloat, floor: CGFloat, visible: CGFloat) -> CGFloat {
        min(max(ideal, floor), visible).rounded()
    }

    func screenChanged(to screen: AnyHashable) {
        if heldOn != screen { heldOn = nil }
    }

    /// A drag's end or a zoom: the person chose this height.
    func personResized(on screen: AnyHashable) {
        guard !fitting else { return }
        heldOn = screen
    }

    /// Grows or shrinks from the top edge, so the title bar stays where the person left it.
    func fit(ideal: CGFloat, on screen: AnyHashable) {
        guard let window, ideal > 0 else { return }
        let visibleFrame = (window.screen ?? NSScreen.main)?.visibleFrame
        let titlebar = window.frame.height - window.contentRect(forFrameRect: window.frame).height
        let content = Self.fittedHeight(ideal: ideal, floor: floor, visible: (visibleFrame?.height ?? 900) - titlebar)
        window.contentMinSize = NSSize(width: window.contentMinSize.width, height: content)
        var frame = window.frame
        let fitted = content + titlebar
        let target = heldOn == screen ? max(fitted, frame.height) : fitted
        guard abs(frame.height - target) > 0.5 else { return }
        frame.origin.y += frame.height - target
        frame.size.height = target
        if let visibleFrame, frame.minY < visibleFrame.minY { frame.origin.y = visibleFrame.minY }
        fitting = true
        window.setFrame(frame, display: true, animate: window.isVisible)
        fitting = false
    }
}
