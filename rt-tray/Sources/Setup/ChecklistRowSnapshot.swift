import AppKit
import SwiftUI
import MattstackCore

/// `rt-tray --render-checklist-row-snapshots <out-dir>` renders the checklist's
/// three sections and the row states the row actions produce (waiting on the
/// admin dialog, the per-step buttons), light and dark, then exits before any
/// window, status item, socket or daemon work exists. DEBUG builds only.
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
            SnapshotRenderer.render(Rows(), appearance: scheme == "dark" ? .darkAqua : .aqua, to: out.appendingPathComponent("checklist-rows-\(scheme).png"))
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

    private static let extensionID = "tool.browser-extension"

    private static let tools: [PlanRow] = [
        PlanRow(id: "tool.daemon", kind: .tool, title: "Daemon",
                why: "The daemon watches your repos and backs MRs and notifications.", required: true,
                status: .missing, detail: "not registered yet", action: step("Register services", "services.register"),
                recheck: .onActivate),
        PlanRow(id: extensionID, kind: .tool, title: "Browser extension",
                why: "Agents drive your browser through this extension.", required: false,
                optionalNote: "You load this into your browser yourself; Install cannot do it for you.",
                status: .needsYou, detail: "not loaded yet",
                action: RowAction(type: .steps, label: "Show steps…", steps: ["Open the extension store", "Add the extension"]),
                recheck: .onActivate, finishGated: true),
        PlanRow(id: "tool.proxy", kind: .tool, title: "Local proxy",
                why: "Serves apps on .localhost/.mattstack domains instead of raw ports.", required: false,
                optionalNote: "Works without this; apps serve on their ports meanwhile.",
                status: .missing, detail: "not installed", action: step("Install proxy", "proxy.install"),
                recheck: .onActivate),
        PlanRow(id: "tool.shell", kind: .tool, title: "Shell integration",
                why: "The rtcd alias and PATH precedence come from your shell rc file.", required: false,
                status: .needsYou, detail: "shell integration not added yet", action: step("Add to shell", "path.link"),
                recheck: .onChange),
        PlanRow(id: "pack.acme", kind: .tool, title: "acme pack",
                why: "Installed by Install for the acme pack.", required: false,
                status: .error, detail: "plugin install exited 1", action: step("Install plugins", "plugins.install"),
                recheck: .onChange),
        PlanRow(id: "tool.git", kind: .tool, title: "Command line tools",
                why: "git and python3 come from here.", required: true, status: .ready, detail: "git 2.50.1", recheck: .onChange),
        PlanRow(id: "tool.agents", kind: .tool, title: "Agent runner",
                why: "Runs the agents that do the work.", required: true, status: .ready, detail: "0.9.2", recheck: .onChange),
        PlanRow(id: "tool.intercepts", kind: .tool, title: "Intercept shims",
                why: "Team command intercepts (git, gh, …) only fire once their PATH shims are installed and current.",
                required: false, status: .ready, detail: "Not needed: your team declares no intercepts", recheck: .onChange),
    ]

    private static let mac: [PlanRow] = [
        PlanRow(id: "perm.login-items", kind: .permission, title: "Login Items",
                why: "Lets mattstack.app start automatically and stay running in the background.",
                required: true, status: .ready, detail: "Enabled", recheck: .onActivate),
        PlanRow(id: "perm.disk", kind: .permission, title: "Full Disk Access",
                why: "Reads your repositories' git state.", required: true, status: .ready, detail: "Granted",
                action: RowAction(type: .openSettings, label: "Open Settings…", target: "fda"), recheck: .onActivate),
    ]

    private struct Rows: View {
        var body: some View {
            let layout = ChecklistLayout.make([PlanGroup(id: "tools", title: "Tools", rows: tools),
                                               PlanGroup(id: "mac", title: "Your Mac", rows: mac)],
                                              finishBlockedBy: [extensionID])
            let activity = RowActivity(checking: ["tool.proxy"],
                                       waiting: ["tool.proxy": NeedRequest(type: "app-privileged", plists: nil, op: "proxy-install").waitingCopy])
            // The second group has settled rows only, so its No action needed card draws open.
            return VStack(alignment: .leading, spacing: 20) {
                ForEach(layout.sections) { section in
                    ChecklistSectionsView(section: section, finishBlockedBy: layout.finishBlockedBy, activity: activity) { _ in }
                }
            }
            .padding(20)
            .controlSize(.large)
            .frame(width: SetupWindowController.width)
        }
    }

    #endif
}
