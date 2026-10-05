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
        print("wrote \(count) snapshots to \(out.path)")
        return true
        #else
        return false
        #endif
    }

    #if DEBUG
    // TeamSettingsInfo's memberwise initializer is internal to MattstackCore.
    private static let people: [(String, String)] = [
        ("admin", #"{"contract":1,"name":"Acme","slug":"acme","remote":"https://github.com/acme/org.git","lastPush":"2026-10-01T10:00:00+00:00","members":[{"username":"dev1"},{"username":"dev4"}],"role":"admin","activeTeam":"widgets","teams":["widgets","gadgets"],"orgTeams":["gadgets","widgets"]}"#),
        ("owner", #"{"contract":1,"name":"Acme","slug":"acme","remote":"https://github.com/acme/org.git","lastPush":"2026-10-01T10:00:00+00:00","members":[{"username":"dev1"},{"username":"dev2"}],"role":"owner","activeTeam":"gadgets","teams":["gadgets"],"orgTeams":["gadgets","widgets"]}"#),
        ("member", #"{"contract":1,"name":"Acme","slug":"acme","remote":"https://github.com/acme/org.git","lastPush":null,"members":[{"username":"dev1"},{"username":"dev4"}],"role":"member","activeTeam":"widgets","teams":["widgets"],"orgTeams":["gadgets","widgets"]}"#),
    ]
    #endif
}
