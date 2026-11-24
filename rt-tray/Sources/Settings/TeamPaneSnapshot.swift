import AppKit
import SwiftUI
import MattstackCore

enum TeamPaneSnapshot {
    @MainActor
    static func runIfRequested() -> Bool {
        #if DEBUG
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--render-team-pane-snapshots") else { return false }
        guard args.count > i + 1 else {
            FileHandle.standardError.write(Data("usage: --render-team-pane-snapshots <out-dir>\n".utf8))
            exit(64)
        }
        let out = URL(fileURLWithPath: args[i + 1])
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        _ = NSApplication.shared
        var count = 0
        for (name, json) in people {
            let info = try! JSONDecoder().decode(TeamSettingsInfo.self, from: Data(json.utf8))
            for scheme in ["light", "dark"] {
                let view = TeamPaneForm(info: info, invite: nil, error: nil, maskedRemote: "github.com/acme/org",
                                        onCreateTeam: {}, onJoin: {}, onUseTeam: { _ in }, onInvite: { _, _ in })
                    .frame(width: 560)
                SnapshotRenderer.render(view, appearance: scheme == "dark" ? .darkAqua : .aqua,
                                        to: out.appendingPathComponent("team-pane-\(name)-\(scheme).png"))
                count += 1
            }
        }
        for (name, state) in support {
            let info = try! JSONDecoder().decode(TeamSettingsInfo.self, from: Data(people[0].1.utf8))
            for scheme in ["light", "dark"] {
                let view = TeamPaneForm(info: name == "pane" ? info : nil, invite: nil, error: nil, maskedRemote: "github.com/acme/org",
                                        onCreateTeam: {}, onJoin: {}, onUseTeam: { _ in }, onInvite: { _, _ in }, support: state)
                let section = Form { SupportSection(state: state, actions: SupportSectionActions()) }.formStyle(.grouped)
                let framed = name == "pane" ? AnyView(view) : AnyView(section.scrollDisabled(true))
                SnapshotRenderer.render(framed.frame(width: 576), appearance: scheme == "dark" ? .darkAqua : .aqua,
                                        to: out.appendingPathComponent("support-\(name)-\(scheme).png"), scale: 2, colorSpace: .sRGB)
                count += 1
            }
        }
        print("wrote \(count) snapshots to \(out.path)")
        return true
        #else
        return false
        #endif
    }

    #if DEBUG
    private static let staff = [SupportPerson(username: "ada", name: "Ada Park"), SupportPerson(username: "alex", name: "Alex Moreau")]
    private static func org(_ host: String?, hasKey: Bool = true, answering: Bool? = nil) -> SupportOrg {
        SupportOrg(host: host, hasKey: hasKey, people: staff, answering: answering)
    }
    private static let slack = SupportNeed(text: "Connect Slack for support chats in Settings > Accounts", label: "Connect Slack for support chats", fix: "accounts")
    private static let repo = SupportNeed(text: "Choose the repo the support agent works in", label: "Choose the repo the support agent works in", fix: "repo")
    private static let linear = SupportNeed(text: "Add the Linear key support tickets are filed with", label: "Add the Linear key support tickets are filed with",
                                            fix: nil, command: "rt secrets set rt linearSupportApiKey")
    private static func state(_ view: SupportHostView, host: String? = nil, busy: SupportSettingsModel.Busy? = nil, orgError: String? = nil) -> SupportSectionState {
        SupportSectionState(view: view, shownHost: host, busy: busy, orgError: orgError, hostError: nil)
    }
    private static let support: [(String, SupportSectionState)] = [
        ("pane", state(SupportHostView(isHost: false, enabled: true, org: org("alex", answering: true)), host: "alex")),
        ("admin-on", state(SupportHostView(isHost: false, enabled: true, org: org("alex", answering: true)), host: "alex")),
        ("admin-off", state(SupportHostView(isHost: false, enabled: false, org: org(nil, hasKey: false)))),
        ("admin-turning-on", state(SupportHostView(isHost: false, enabled: false, org: org("alex", hasKey: false)), host: "alex", busy: .turningOn)),
        ("admin-not-accepted", state(SupportHostView(isHost: false, enabled: true, org: org("alex", answering: false)), host: "alex")),
        ("admin-failed", state(SupportHostView(isHost: false, enabled: false, org: org("alex", hasKey: false)), host: "alex",
                               orgError: "Your age key does not open the org's secrets")),
        ("admin-no-key", state(SupportHostView(isHost: false, enabled: true, org: org("alex", hasKey: false, answering: true)), host: "alex")),
        ("admin-making-key", state(SupportHostView(isHost: false, enabled: true, org: org("alex", hasKey: false, answering: true)), host: "alex", busy: .makingKey)),
        ("host-not-ready", state(SupportHostView(isHost: true, enabled: true, needs: [slack, repo, linear], repos: ["git.example.com/acme/shop"]))),
        ("host-ready", state(SupportHostView(isHost: true, enabled: true))),
        ("host-answering", state(SupportHostView(isHost: true, enabled: true, accepting: true, open: 1, waiting: 1))),
        ("host-other-mac", state(SupportHostView(isHost: true, enabled: true, otherMac: true))),
    ]
    // TeamSettingsInfo's memberwise initializer is internal to MattstackCore.
    private static let people: [(String, String)] = [
        ("admin", #"{"contract":1,"name":"Widgets","slug":"acme","remote":"https://github.com/acme/org.git","lastPush":"2026-10-01T10:00:00+00:00","members":[{"username":"dev1"},{"username":"dev4"}],"role":"admin","activeTeam":"widgets","teams":["widgets","gadgets"],"orgTeams":["gadgets","widgets"]}"#),
        ("admin-switched", #"{"contract":1,"name":"Gadgets","slug":"acme","remote":"https://github.com/acme/org.git","lastPush":"2026-10-01T10:00:00+00:00","members":[{"username":"dev1"},{"username":"dev4"}],"role":"admin","activeTeam":"gadgets","teams":["widgets","gadgets"],"orgTeams":["gadgets","widgets"]}"#),
        ("owner", #"{"contract":1,"name":"Gadgets","slug":"acme","remote":"https://github.com/acme/org.git","lastPush":"2026-10-01T10:00:00+00:00","members":[{"username":"dev1"},{"username":"dev2"}],"role":"owner","activeTeam":"gadgets","teams":["gadgets"],"orgTeams":["gadgets","widgets"]}"#),
        ("member", #"{"contract":1,"name":"Widgets","slug":"acme","remote":"https://github.com/acme/org.git","lastPush":null,"members":[{"username":"dev1"},{"username":"dev4"}],"role":"member","activeTeam":"widgets","teams":["widgets"],"orgTeams":["gadgets","widgets"]}"#),
    ]
    #endif
}
