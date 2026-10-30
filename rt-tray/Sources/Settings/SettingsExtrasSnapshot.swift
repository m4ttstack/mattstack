import AppKit
import SwiftUI
import MattstackCore

enum SettingsExtrasSnapshot {
    @MainActor
    static func runIfRequested() -> Bool {
        #if DEBUG
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--render-settings-extras-snapshots") else { return false }
        guard args.count > i + 1 else {
            FileHandle.standardError.write(Data("usage: --render-settings-extras-snapshots <out-dir>\n".utf8))
            exit(64)
        }
        let out = URL(fileURLWithPath: args[i + 1])
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        _ = NSApplication.shared
        var count = 0
        for (name, title, height, row) in rows {
            for scheme in ["light", "dark"] {
                let view = Form { SettingsExtraSection(title: title, row: row, isChecking: false, onAction: {}) }
                    .formStyle(.grouped)
                    .frame(width: 560, height: height)
                SnapshotRenderer.render(view, appearance: scheme == "dark" ? .darkAqua : .aqua,
                                        to: out.appendingPathComponent("extras-\(name)-\(scheme).png"))
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
    /// Mirrors what lib/setup/validators/tools.ts and skills-overrides.ts emit.
    /// Heights fit each row whole, since a grouped Form has no fitting size of its own.
    private static let rows: [(String, String, CGFloat, PlanRow)] = [
        ("mission-control", "Keyboard", 230, PlanRow(
            id: SettingsExtras.missionControl, kind: .tool, title: "Mission Control shortcut",
            why: "rt's nav picker uses Control+Up, which macOS binds to Mission Control by default.", required: false,
            optionalNote: "Works without this; only matters if Control+Up doesn't reach rt's nav picker.",
            status: .needsYou, detail: "Control+Up opens Mission Control, and rt's picker needs it",
            action: RowAction(type: .openSettings, label: "Open Keyboard Settings…", target: "keyboard"), recheck: .onActivate)),
        ("mission-control-ready", "Keyboard", 210, PlanRow(
            id: SettingsExtras.missionControl, kind: .tool, title: "Mission Control shortcut",
            why: "rt's nav picker uses Control+Up, which macOS binds to Mission Control by default.", required: false,
            optionalNote: "Works without this; only matters if Control+Up doesn't reach rt's nav picker.",
            status: .ready, detail: "Control+Up is free for rt's picker", recheck: .onActivate)),
        ("chrome-signin", "Chrome sign-in", 180, PlanRow(
            id: SettingsExtras.chromeSignIn, kind: .tool, title: "Chrome sign-in",
            why: "widgets needs Chrome signed into janedoe@acme.dev.", required: false,
            optionalNote: "Cannot be checked automatically; confirm it by hand.",
            status: .needsYou, detail: "Confirm Chrome is signed into janedoe@acme.dev",
            action: RowAction(type: .steps, label: "Show steps…",
                              steps: ["Open Chrome", "Click your profile picture (top right)", "Confirm you're signed into janedoe@acme.dev"]),
            recheck: .onActivate)),
        ("skill-overrides", "Skill overrides", 200, PlanRow(
            id: SettingsExtras.skillOverrides, kind: .tool, title: "Skill overrides",
            why: "Old slot keys in your own overrides file stop the mattstack skills from compiling.", required: false,
            status: .needsYou, detail: "Old slot keys: work rules becomes work/domain-rules rules or a step's own rules prop, your choice. A rules prop adds to lower layers where domain replaced them.",
            action: RowAction(type: .steps, label: "Show steps…",
                              steps: ["Edit /Users/janedoe/.mattstack/user/skills/overrides.jsonc as listed", "Run: rt skills materialize"]),
            recheck: .onChange)),
    ]
    #endif
}
