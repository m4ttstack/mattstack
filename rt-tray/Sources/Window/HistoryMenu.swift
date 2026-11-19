import AppKit
import WebKit

/// History ▸ Back (⌘[) and Forward (⌘]) for the showing tab, nil-targeted
/// like the Find submenu. A focused web view answers WKWebView's own
/// `goBack(_:)`/`goForward(_:)`; with focus elsewhere in the tab (the find
/// bar), the tab's FindBarContainer answers them for its web view.
enum HistoryMenu {
    static func menuItem() -> NSMenuItem {
        let item = NSMenuItem(title: "History", action: nil, keyEquivalent: "")
        let menu = NSMenu(title: "History")
        menu.addItem(withTitle: "Back", action: #selector(WKWebView.goBack(_:)), keyEquivalent: "[")
            .setAccessibilityIdentifier(AXID.menuHistoryBack)
        menu.addItem(withTitle: "Forward", action: #selector(WKWebView.goForward(_:)), keyEquivalent: "]")
            .setAccessibilityIdentifier(AXID.menuHistoryForward)
        item.submenu = menu
        return item
    }
}
