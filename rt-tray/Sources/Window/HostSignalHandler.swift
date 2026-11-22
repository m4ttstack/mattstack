import WebKit

/// Receives what a page posts to `window.webkit.messageHandlers.mattstackHost`.
/// The content controller retains its handlers for the webview's lifetime, so
/// this holds only a forwarding closure, never the store.
@MainActor
final class HostSignalHandler: NSObject, WKScriptMessageHandler {
    static let name = "mattstackHost"

    private let appName: String
    private let forward: @MainActor (String, Any) -> Void

    init(appName: String, forward: @escaping @MainActor (String, Any) -> Void) {
        self.appName = appName
        self.forward = forward
    }

    /// An iframe in the page must not speak for the tab.
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame else { return }
        forward(appName, message.body)
    }
}
