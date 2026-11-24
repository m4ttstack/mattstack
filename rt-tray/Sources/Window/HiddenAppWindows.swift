import AppKit

/// The windows that were on screen when ⌘H hid the app. AppKit reports every
/// window of a hidden app as not visible, the same as a closed one.
@MainActor
final class HiddenAppWindows {
    static let shared = HiddenAppWindows()

    private let windows = NSHashTable<NSWindow>.weakObjects()
    private var observers: [NSObjectProtocol] = []

    private init() {}

    func start() {
        guard observers.isEmpty else { return }
        observe(NSApplication.willHideNotification) { [windows] _ in
            for window in NSApp.windows where window.isVisible { windows.add(window) }
        }
        observe(NSApplication.didUnhideNotification) { [windows] _ in windows.removeAllObjects() }
        observe(NSWindow.willCloseNotification) { [windows] window in windows.remove(window) }
    }

    func contains(_ window: NSWindow) -> Bool { windows.contains(window) }

    private func observe(_ name: Notification.Name, _ body: @escaping @MainActor (NSWindow?) -> Void) {
        observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { note in
            let window = note.object as? NSWindow
            MainActor.assumeIsolated { body(window) }
        })
    }
}

extension NSWindow {
    /// `isVisible`, with hiding the app not counting as closing the window.
    @MainActor
    var isVisibleOrAppHidden: Bool { isVisible || HiddenAppWindows.shared.contains(self) }
}
