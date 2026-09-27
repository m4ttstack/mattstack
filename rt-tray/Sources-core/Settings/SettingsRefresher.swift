import Foundation

/// Settings' panes load on appear, which never fires again while the window
/// stays open, so an upgrade run from Settings (or a re-show onto the pane
/// already current) has to pull team and apps state back in explicitly.
@MainActor
public final class SettingsRefresher {
    private let team: TeamSettingsModel
    private let apps: AppsSettingsModel
    public init(team: TeamSettingsModel, apps: AppsSettingsModel) { self.team = team; self.apps = apps }

    public func reload() async {
        await team.load()
        await apps.load()
    }

    public func setupWindowClosed(entry: SetupEntry, applied: Bool) async {
        guard entry == .upgrade, applied else { return }
        await reload()
    }
}
