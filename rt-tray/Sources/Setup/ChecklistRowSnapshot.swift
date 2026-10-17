import AppKit
import SwiftUI
import MattstackCore

/// `rt-tray --render-checklist-row-snapshots <out-dir>` renders the checklist's
/// three sections and the row states the row actions produce (waiting on the
/// admin dialog, the per-step buttons) and the dev-login Add sheet's states,
/// light and dark, then exits before any
/// window, status item, socket or daemon work exists. Also the "Your repos"
/// rows: before Install, a refused pick, and the deferred rows after it. DEBUG builds only.
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
        let sheets: [(String, DevLoginSheet)] = [
            ("blank", sheet()),
            ("empty", sheet(origin: "https://login.example.com")),
            ("mismatch", sheet(origin: "https://login.example.com", email: "dev@example.com", password: "hunter22", confirm: "hunter")),
            ("matching", sheet(origin: "https://login.example.com", email: "dev@example.com", password: "hunter22", confirm: "hunter22")),
        ]
        for (name, view) in sheets {
            for scheme in ["light", "dark"] {
                SnapshotRenderer.render(view.background(Color(nsColor: .windowBackgroundColor)), appearance: scheme == "dark" ? .darkAqua : .aqua, to: out.appendingPathComponent("devlogin-sheet-\(name)-\(scheme).png"))
            }
        }
        for scheme in ["light", "dark"] {
            SnapshotRenderer.render(InstallRows(), appearance: scheme == "dark" ? .darkAqua : .aqua, to: out.appendingPathComponent("install-clone-progress-\(scheme).png"))
        }
        for scheme in ["light", "dark"] {
            SnapshotRenderer.render(RepoRows(), appearance: scheme == "dark" ? .darkAqua : .aqua, to: out.appendingPathComponent("repo-rows-\(scheme).png"))
        }
        print("wrote \(6 + sheets.count * 2) snapshots to \(out.path)")
        return true
        #else
        return false
        #endif
    }

    #if DEBUG
    private static func sheet(origin: String = "", email: String = "", password: String = "", confirm: String = "") -> DevLoginSheet {
        DevLoginSheet(fixedOrigin: nil, email: email, originText: origin, password: password, confirmPassword: confirm,
                      isSaved: { _ in false }, onSave: { _, _, _ in nil })
    }

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

    private static let installSteps: [InstallStep] = [
        InstallStep(info: StepInfo(id: "team.join", title: "Join your team", kind: .rt), state: .done, detail: "Joined acme"),
        InstallStep(info: StepInfo(id: "repos.clone", title: "Clone your repos", kind: .rt), state: .running,
                    detail: "Cloning acme-api (2 of 2) · widgets was already on this Mac",
                    progress: StepProgress(label: "Receiving objects", percent: 42, note: "1.21 GiB · 18.4 MiB/s")),
        InstallStep(info: StepInfo(id: "board.setup", title: "Set up the board", kind: .rt)),
    ]

    /// The Install list mid-clone, as the "R · Install" board draws it.
    private struct InstallRows: View {
        var body: some View {
            Form {
                Section {
                    ForEach(installSteps) { step in
                        InstallStepRow(step: step, hasLog: false, isFailedStep: false, isRunning: true,
                                       showLog: {}, retryFromFailure: {}, retryFrom: {})
                    }
                } header: {
                    Text("Installing… nothing runs that isn't listed here.")
                }
            }
            .formStyle(.grouped)
            .frame(width: SetupWindowController.width, height: 300)
        }
    }

    private static func place(_ repo: String, mode: String, checkout: String? = nil, clone: String, note: String,
                              problem: String? = nil, oneClick: PlaceRepoOneClick? = nil, records: Bool = true) -> RowAction {
        RowAction(type: .placeRepo, label: mode == "clone" ? "Choose location…" : "Locate…", identity: "gitlab.com/acme/\(repo)",
                  repo: repo, mode: mode, checkoutPath: checkout, clonePath: clone, note: note, problem: problem,
                  then: records ? nil : ["setup", "apply", "--only", "repos.clone"], oneClick: oneClick, segmentRecords: records)
    }

    private static func repoRow(_ repo: String, status: RowStatus, gated: Bool = false, _ action: RowAction) -> PlanRow {
        PlanRow(id: "repos.place:gitlab.com/acme/\(repo)", kind: .tool, title: repo, why: "gitlab.com/acme", required: false,
                status: status, detail: action.problem ?? action.note, action: action, recheck: .onChange,
                finishGated: gated, waivable: gated ? false : nil)
    }

    private static let found = repoRow("widgets", status: .ready,
        place("widgets", mode: "checkout", checkout: "~/code/widgets", clone: "~/Documents/GitHub/widgets-2", note: "Found your widgets checkout"))
    private static let toClone = repoRow("acme-api", status: .ready,
        place("acme-api", mode: "clone", clone: "~/code/acme-api", note: "rt clones it here when you click Install"))
    private static let refused = repoRow("dev1", status: .ready,
        place("dev1", mode: "clone", clone: "~/code/dev1", note: "rt clones it here when you click Install"))
    private static let deferred = repoRow("acme-api", status: .needsYou, gated: true,
        place("acme-api", mode: "clone", clone: "~/Documents/GitHub/acme-api", note: "Choose where your repos go",
              oneClick: PlaceRepoOneClick(label: "Clone here", mode: "clone", path: "~/Documents/GitHub/acme-api"), records: false))
    private static let failed = repoRow("widgets", status: .needsYou, gated: true,
        place("widgets", mode: "clone", clone: "~/Documents/GitHub/widgets",
              note: "The last clone failed: fatal: could not read from remote repository.",
              problem: "The last clone failed: fatal: could not read from remote repository.",
              oneClick: PlaceRepoOneClick(label: "Retry", mode: "clone", path: "~/Documents/GitHub/widgets"), records: false))

    /// Before Install as the "R · Your repos" board draws it, then a refused Locate…, then the summary's deferred rows.
    private struct RepoRows: View {
        var body: some View {
            let none = RowActivity()
            return VStack(alignment: .leading, spacing: 20) {
                ChecklistCard {
                    ChecklistCardHeader(title: "No action needed · 3")
                    Divider()
                    SettledRow(row: found, isChecking: false, error: nil) { _ in }
                    Divider()
                    SettledRow(row: toClone, isChecking: false, error: nil) { _ in }
                    Divider()
                    RepoPlacementRow(row: refused, action: refused.action!, isChecking: false,
                                     error: "~/foo isn't a git checkout.", ids: .checklist, shown: "checkout")
                }
                ChecklistCard {
                    ChecklistCardHeader(title: "Needs you", symbol: "exclamationmark.triangle.fill", multicolor: true)
                    Divider()
                    SectionRow(row: deferred, badge: .beforeFinish, context: "Your repos", activity: none, ids: .beforeYouFinish,
                               onSkip: nil) { _ in }
                    Divider()
                    SectionRow(row: failed, badge: .beforeFinish, context: "Your repos", activity: none, ids: .beforeYouFinish,
                               onSkip: nil) { _ in }
                }
            }
            .padding(20)
            .controlSize(.large)
            .frame(width: SetupWindowController.width)
        }
    }

    #endif
}
