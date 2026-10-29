import AppKit
import SwiftUI
import MattstackCore

/// `rt-tray --render-setup-page-snapshots <out-dir>` renders setup's own
/// pages from fixture rows, light and dark, then exits before any window,
/// status item, socket or daemon work exists. DEBUG builds only.
enum SetupPageSnapshot {
    @MainActor
    static func runIfRequested() -> Bool {
        #if DEBUG
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--render-setup-page-snapshots") else { return false }
        guard args.count > i + 1 else {
            FileHandle.standardError.write(Data("usage: --render-setup-page-snapshots <out-dir>\n".utf8))
            exit(64)
        }
        let out = URL(fileURLWithPath: args[i + 1])
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        _ = NSApplication.shared
        let pages: [(String, AnyView)] = fdaStates.map { name, row, needsRelaunch in
            (name, AnyView(FullDiskAccessPageBody(state: FullDiskAccessPage.state(row: row, needsRelaunch: needsRelaunch))))
        }
        for (name, page) in pages {
            for scheme in ["light", "dark"] {
                SnapshotRenderer.render(
                    page.frame(width: SetupWindowController.width, height: bodyHeight)
                        .background(Color(nsColor: .windowBackgroundColor))
                        .controlSize(.large),
                    appearance: scheme == "dark" ? .darkAqua : .aqua,
                    to: out.appendingPathComponent("\(name)-\(scheme).png"))
            }
        }
        print("wrote \(pages.count * 2) snapshots to \(out.path)")
        return true
        #else
        return false
        #endif
    }

    #if DEBUG
    /// The window's height less its header and footer.
    private static let bodyHeight: CGFloat = 440

    private static func fdaRow(_ status: RowStatus, _ detail: String) -> PlanRow {
        PlanRow(id: PermissionRowOverlay.fdaRow, kind: .permission, title: "Full Disk Access",
                why: "Reads your repositories' git state.", required: true, status: status, detail: detail,
                action: RowAction(type: .openSettings, label: "Open Full Disk Access Settings…", target: "fda"), recheck: .onActivate)
    }

    private static let fdaStates: [(String, PlanRow?, Bool)] = [
        ("fda-off", fdaRow(.needsYou, "Not granted"), false),
        ("fda-needsReopen", fdaRow(.ready, "Granted"), true),
        ("fda-on", fdaRow(.ready, "Granted"), false),
    ]
    #endif
}
