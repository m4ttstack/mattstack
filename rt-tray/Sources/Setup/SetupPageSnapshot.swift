import AppKit
import SwiftUI
import MattstackCore

/// `rt-tray --render-setup-page-snapshots <out-dir>` renders setup's own
/// pages from fixture rows, a checklist page and the summary's counts, light and dark, then exits before any window,
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
        var pages: [(String, AnyView)] = fdaStates.map { name, row, needsRelaunch, loadState in
            (name, AnyView(FullDiskAccessPageBody(
                display: FullDiskAccessPage.display(row: row, needsRelaunch: needsRelaunch, loadState: loadState), checkAgain: {})))
        }
        pages += joinStates.map { name, display in
            (name, AnyView(JoinPageBody(display: display, teamRepo: teamRepoCard, onJoin: {}, onCheckAgain: {})))
        }
        pages.append(("checklist-page-your-mac", AnyView(yourMacPage)))
        pages.append(("summary-chips", AnyView(summaryChips)))
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

    private static func joinStatus(_ state: String, pull: String = #"{"outcome":"pulled","detail":"Pulled the team's settings"}"#) -> JoinStatus {
        let json = #"{"team":{"slug":"widgets","name":"widgets"},"state":"\#(state)","since":"2026-10-29T10:00:00Z","uses":{"repos":2,"accounts":2,"packs":3},"pull":\#(pull)}"#
        return try! JSONDecoder().decode(JoinStatus.self, from: Data(json.utf8))
    }

    private static var teamRepoCard: AnyView {
        let row = PlanRow(id: "access.team-repo", kind: .access, title: "Team repo",
                          why: "rt needs read access to your team's home repo to sync settings and packs. Only the org's admins and your team's owners write it.",
                          required: true, status: .needsYou, detail: "Connect your GitHub account so rt can prove access",
                          action: RowAction(type: .connect, label: "Connect", integration: "github"), recheck: .onActivate)
        return AnyView(ChecklistCard {
            SectionRow(row: row, badge: nil, context: nil, activity: RowActivity(), ids: .checklist, onSkip: nil, perform: { _ in })
        })
    }

    private static let joinStates: [(String, JoinPageDisplay)] = [
        ("join-needs-token", JoinPageDisplay(phase: .needsToken, teamName: "widgets")),
        ("join-ready", JoinPageDisplay(phase: .ready, teamName: "widgets")),
        ("join-joining", JoinPageDisplay(phase: .joining, teamName: "widgets",
                                         logLines: ["Cloning acme/mattstack-team-widgets", "Redeemed the invite from Jane Doe"])),
        ("join-waiting", JoinPageDisplay(phase: .waiting(joinStatus("waiting")), waitingSince: "4 minutes ago", joinLanded: true)),
        ("join-unreadable", JoinPageDisplay(phase: .unreadable(joinStatus("unreadable", pull: #"{"outcome":"failed","detail":"Couldn't reach github.com"}"#)),
                                            joinLanded: true)),
        ("join-approved", JoinPageDisplay(phase: .approved(team: "widgets"), joinLanded: true, lastStatus: joinStatus("approved"))),
        ("join-failed", JoinPageDisplay(phase: .failed(detail: "The invite was already used. Ask your team admin for a new invite", remedy: nil),
                                        teamName: "widgets")),
    ]

    private static func macRow(_ id: String, _ title: String, _ why: String, required: Bool = true, status: RowStatus = .ready,
                               detail: String? = nil, action: RowAction? = nil, information: Bool = false) -> PlanRow {
        PlanRow(id: id, kind: .tool, title: title, why: why, required: required, status: status, detail: detail, action: action,
                recheck: .onActivate, information: information)
    }

    /// The Your Mac page as the "O7" board draws it.
    private static let yourMac = PlanGroup(id: "mac", title: "Your Mac", rows: [
        macRow("tool.clt", "Command Line Tools", "Provides git and the other command-line build tools rt depends on.", status: .missing,
               action: RowAction(type: .install, label: "Install", tool: "clt")),
        macRow("perm.notifications", "Notifications", "Shows menu-bar notifications when something needs your attention.",
               status: .needsYou, action: RowAction(type: .openSettings, label: "Open Settings…", target: "notifications")),
        ChecklistRowSnapshot.missionControl,
        macRow("tool.macos", "macOS version", "rt needs macOS 15 or later.", detail: "26.1"),
        macRow("tool.arch", "Processor", "The bundled tools are built for Apple silicon.", detail: "arm64"),
        macRow("perm.login-items", "Login Items", "Lets mattstack.app start automatically.", detail: "Enabled"),
        ChecklistRowSnapshot.pathPrecedence,
    ])

    private static var yourMacPage: some View {
        let layout = ChecklistLayout.make([yourMac], finishBlockedBy: [ChecklistRowSnapshot.missionControl.id])
        let section = layout.sections[0]
        return VStack(alignment: .leading, spacing: 12) {
            Text(PageLead.text(for: section)).font(.callout).foregroundStyle(.secondary)
            ChecklistSectionsView(section: section, finishBlockedBy: layout.finishBlockedBy, activity: RowActivity(),
                                  onSkip: { _ in }) { _ in }
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.primary.opacity(0.035))
    }

    /// The summary's counts as the "O6" board draws them: one needs you, one skipped, and no optional count.
    private static var summaryChips: some View {
        var skipped = ChecklistRowSnapshot.missionControl
        skipped.waived = true
        let groups = [
            PlanGroup(id: "mac", title: "Your Mac", rows: [skipped, ChecklistRowSnapshot.pathPrecedence] + yourMac.rows[3...5]),
            PlanGroup(id: "agents", title: "Agents and editors", rows: [
                PlanRow(id: "skills.writing-style", kind: .tool, title: "Writing style", why: "w", required: false, status: .needsYou,
                        recheck: .onChange, finishGated: true, waivable: false),
                PlanRow(id: "tool.chrome", kind: .tool, title: "Google Chrome", why: "w", required: false, status: .skipped, recheck: .onChange),
            ]),
        ]
        let layout = ChecklistLayout.make(groups, finishBlockedBy: ["skills.writing-style"])
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                SummaryCount(kind: nil, text: "All", isOn: false) {}
                ForEach(layout.summary, id: \.kind) { part in
                    SummaryCount(kind: part.kind, text: part.text, isOn: part.kind == .needsYou) {}
                }
                Spacer()
            }
            HStack(spacing: 6) {
                ForEach(layout.summary, id: \.kind) { part in
                    SummaryCount(kind: part.kind, text: part.text, isOn: part.kind == .skipped) {}
                }
                Spacer()
            }
            Spacer()
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.primary.opacity(0.035))
    }

    private static let fdaStates: [(String, PlanRow?, Bool, ChecklistLoadState)] = [
        ("fda-checking", nil, false, .loading),
        ("fda-failed", nil, false, .failed("rt setup plan exited 1: could not read ~/.mattstack/rt/setup-state.json")),
        ("fda-off", fdaRow(.needsYou, "Not granted"), false, .loaded),
        ("fda-needsReopen", fdaRow(.ready, "Granted"), true, .loaded),
        ("fda-on", fdaRow(.ready, "Granted"), false, .loaded),
    ]
    #endif
}
