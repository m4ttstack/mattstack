import AppKit
import SwiftUI
import MattstackCore

/// `rt-tray --render-checklist-row-snapshots <out-dir>` renders the checklist
/// row states the row actions produce (waiting on the admin dialog, the
/// per-step buttons), light and dark, then exits before any window, status
/// item, socket or daemon work exists. DEBUG builds only.
enum ChecklistRowSnapshot {
    @MainActor
    static func runIfRequested() -> Bool {
        #if DEBUG
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--render-checklist-row-snapshots") else { return false }
        guard args.count > i + 1 else {
            FileHandle.standardError.write(Data("usage: --render-checklist-row-snapshots <out-dir>\n".utf8))
            exit(64)
        }
        let out = URL(fileURLWithPath: args[i + 1])
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        _ = NSApplication.shared
        for scheme in ["light", "dark"] {
            render(Rows(), appearance: scheme == "dark" ? .darkAqua : .aqua, to: out.appendingPathComponent("checklist-rows-\(scheme).png"))
        }
        print("wrote 2 snapshots to \(out.path)")
        return true
        #else
        return false
        #endif
    }

    #if DEBUG
    private static func step(_ label: String, _ id: String) -> RowAction {
        RowAction(type: .run, label: label, verb: ["setup", "apply", "--only", id])
    }

    private struct Rows: View {
        var body: some View {
            Form {
                Section("Your Mac") {
                    RowView(row: PlanRow(id: "perm.login-items", kind: .permission, title: "Login Items",
                                         why: "Lets mattstack.app start automatically and stay running in the background.",
                                         required: true, status: .missing, detail: "Not registered yet",
                                         action: step("Register services", "services.register"), recheck: .onActivate), isChecking: false) {}
                }
                Section("Tools") {
                    RowView(row: PlanRow(id: "tool.proxy", kind: .tool, title: "Local proxy",
                                         why: "Serves apps on .localhost/.mattstack domains instead of raw ports.", required: false,
                                         optionalNote: "Works without this; apps serve on their ports meanwhile.",
                                         status: .missing, detail: "not installed", action: step("Install proxy", "proxy.install"),
                                         recheck: .onActivate), isChecking: true,
                            waiting: NeedRequest(type: "app-privileged", plists: nil, op: "proxy-install").waitingCopy) {}
                    RowView(row: PlanRow(id: "tool.daemon", kind: .tool, title: "Daemon",
                                         why: "The daemon watches your repos and backs MRs and notifications.", required: true,
                                         status: .missing, detail: "not registered yet", action: step("Register services", "services.register"),
                                         recheck: .onActivate), isChecking: false) {}
                    RowView(row: PlanRow(id: "tool.shell", kind: .tool, title: "Shell integration",
                                         why: "The rtcd alias and PATH precedence come from your shell rc file.", required: false,
                                         status: .needsYou, detail: "shell integration not added yet", action: step("Add to shell", "path.link"),
                                         recheck: .onChange), isChecking: false) {}
                    RowView(row: PlanRow(id: "tool.linear-mcp", kind: .tool, title: "Linear MCP",
                                         why: "Skills that read and update Linear tickets reach them through this MCP server.", required: false,
                                         optionalNote: "Works without this; only the skills that read Linear tickets need it.",
                                         status: .missing, detail: "Linear is connected but not added to Claude Code yet",
                                         action: step("Add to Claude", "linear.mcp"), recheck: .onChange), isChecking: false) {}
                    RowView(row: PlanRow(id: "pack.acme", kind: .tool, title: "acme pack",
                                         why: "Installed by Install for the acme pack.", required: false,
                                         status: .missing, detail: "not installed yet", action: step("Install plugins", "plugins.install"),
                                         recheck: .onChange), isChecking: false) {}
                    RowView(row: PlanRow(id: "home.backup", kind: .tool, title: "Home repo backup",
                                         why: "Confirms whether your settings are backed up anywhere.", required: false,
                                         status: .needsYou, detail: "no home repo found yet... nothing to back up",
                                         action: step("Create home repo", "home.init"), recheck: .onActivate), isChecking: false) {}
                    RowView(row: PlanRow(id: "tool.intercepts", kind: .tool, title: "Intercept shims",
                                         why: "Team command intercepts (git, gh, …) only fire once their PATH shims are installed and current.",
                                         required: false, status: .ready, detail: "Not needed: your team declares no intercepts",
                                         recheck: .onChange), isChecking: false) {}
                }
            }
            .formStyle(.grouped)
            .controlSize(.large)
            .frame(width: SetupWindowController.width)
        }
    }

    /// AppKit-backed controls (buttons, the progress spinner) only draw through
    /// a real view hierarchy, so this renders a hosting view in an offscreen window.
    @MainActor
    private static func render<V: View>(_ view: V, appearance: NSAppearance.Name, to url: URL) {
        let host = NSHostingView(rootView: view)
        host.appearance = NSAppearance(named: appearance)
        let size = host.fittingSize
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: appearance)
        window.contentView = host
        host.frame = NSRect(origin: .zero, size: size)
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { fatalError("no bitmap for \(url.lastPathComponent)") }
        host.cacheDisplay(in: host.bounds, to: rep)
        try! rep.representation(using: .png, properties: [:])!.write(to: url)
    }
    #endif
}
