import Foundation

/// Polls only while its window is open and on screen. A window kept for reuse
/// (`isReleasedWhenClosed = false`) never removes its SwiftUI hosting view,
/// so `onDisappear` never fires on close: the window's own close
/// notification stops polling, and each `show()` starts it again. A window
/// left open behind others or minimized must not poll either: each poll is
/// a full daemon sweep. `visibilityChanged` re-reads `isVisible` and
/// follows it.
@MainActor
public final class WindowScopedPolling {
    private let start: @MainActor () -> Void
    private let stop: @MainActor () -> Void
    private let isVisible: @MainActor () -> Bool
    private let center: NotificationCenter
    private var observers: [NSObjectProtocol] = []
    private var open = false
    private var running = false

    public init(window: AnyObject, closing: Notification.Name, visibilityChanged: Notification.Name? = nil,
                isVisible: @escaping @MainActor () -> Bool = { true }, center: NotificationCenter = .default,
                start: @escaping @MainActor () -> Void, stop: @escaping @MainActor () -> Void) {
        self.start = start
        self.stop = stop
        self.isVisible = isVisible
        self.center = center
        observers.append(center.addObserver(forName: closing, object: window, queue: nil) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.open = false
                self?.follow()
            }
        })
        if let visibilityChanged {
            observers.append(center.addObserver(forName: visibilityChanged, object: window, queue: nil) { [weak self] _ in
                MainActor.assumeIsolated { self?.follow() }
            })
        }
    }

    deinit { observers.forEach(center.removeObserver) }

    public func show() {
        open = true
        follow()
    }

    private func follow() {
        let want = open && isVisible()
        guard want != running else { return }
        running = want
        if want { start() } else { stop() }
    }
}
