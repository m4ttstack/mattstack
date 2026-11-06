#if DEBUG
import AppKit
import MattstackCore
import SwiftUI

/// `rt-tray --button-playground`: a live window of the setup kit's buttons, for
/// looking at press, hover and loading in motion. Clicking a button loads it for
/// a few seconds. Under the window preview's gate: an unbundled debug build and
/// a scratch HOME, since it boots none of the tray.
@MainActor
enum ButtonPlayground {
    private static var window: NSWindow!

    static func run() -> Never {
        if let refusal = WindowPreviewGate.refusal(bundleIdentifier: Bundle.main.bundleIdentifier,
                                                   home: ProcessInfo.processInfo.environment["HOME"],
                                                   accountHome: accountHome()) {
            FileHandle.standardError.write(Data((refusal.replacingOccurrences(of: "--window-preview", with: "--button-playground") + "\n").utf8))
            exit(2)
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        app.appearance = NSAppearance(named: FastAppearance.window.name)
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = main

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 760, height: 620),
                          styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.title = "Button playground"
        window.contentViewController = NSHostingController(rootView: PlaygroundView()
            .frame(width: 760, height: 620)
            .background(FastTheme.windowBackground)
            .environment(\.colorScheme, .dark))
        window.center()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        app.run()
        exit(0)
    }

    private static func accountHome() -> String {
        guard let entry = getpwuid(getuid()), let dir = entry.pointee.pw_dir else { return NSHomeDirectory() }
        return String(cString: dir)
    }

    private struct PlaygroundView: View {
        @State private var loading: Set<String> = []
        @State private var holdAll = false

        var body: some View {
            VStack(alignment: .leading, spacing: 20) {
                FastScreenHeader(title: "Buttons", subtitle: "Click any button. It loads for three seconds.")
                Toggle("Hold every button loading", isOn: $holdAll).toggleStyle(.switch).controlSize(.mini).foregroundColor(FastTheme.textSecondary)
                row("Primary") {
                    button("continue", "Continue", loadingTitle: "Checking…")
                    button("finish", "Finish setup", loadingTitle: "Finishing…")
                }
                row("Primary small") {
                    button("allow", "Allow", size: .small)
                    button("retry", "Retry", kind: .primary(glow: false), shape: .retry, loadingTitle: "Retrying…")
                }
                row("Secondary") {
                    button("hide", "Hide", kind: .secondary())
                    button("recheck", "Re-check", kind: .secondary(), size: .small, loadingTitle: "Checking…")
                }
                row("Outline") {
                    button("install", "Install", icon: "arrow.down.circle", kind: .outline, loadingTitle: "Installing…")
                    button("connect", "Connect Slack", icon: "message", kind: .outline, loadingTitle: "Connecting…")
                }
                row("Outline small") {
                    button("install-s", "Install", icon: "arrow.down.circle", kind: .outline, size: .small, loadingTitle: "Installing…")
                    button("signin-s", "Sign in to Claude", icon: "arrow.right.to.line", kind: .outline, size: .small, loadingTitle: "Opening…")
                }
                row("Disabled") {
                    FastButton(title: "Continue") {}.disabled(true)
                    FastButton(title: "Hide", kind: .secondary()) {}.disabled(true)
                }
                Spacer()
            }
            .padding(48)
        }

        private func row(_ name: String, @ViewBuilder _ content: () -> some View) -> some View {
            HStack(spacing: 16) {
                Text(name).font(FastTheme.note).foregroundColor(FastTheme.textSecondary).frame(width: 110, alignment: .leading)
                content()
            }
        }

        private func button(_ id: String, _ title: String, icon: String? = nil, kind: FastButton.Kind = .primary(),
                            size: FastButtonSize = .large, shape: FastButtonShape? = nil, loadingTitle: String? = nil) -> some View {
            FastButton(title: title, icon: icon, kind: kind, size: size, shape: shape,
                       isLoading: holdAll || loading.contains(id), loadingTitle: loadingTitle) {
                loading.insert(id)
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) { loading.remove(id) }
            }
        }
    }
}
#endif
