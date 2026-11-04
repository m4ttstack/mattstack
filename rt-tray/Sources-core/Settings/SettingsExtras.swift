/// The setup rows rt targets at Settings rather than setup. rt decides when
/// each row exists and what state it is in; this only reads that answer.
public enum SettingsExtras {
    public static let missionControl = "tool.mission-control"
    public static let chromeSignIn = "tool.chrome-signin"
    public static let skillOverrides = "skills.overrides"
    /// In the accounts group, so Settings > Accounts draws and runs it with Slack's own row.
    public static let slackSupportChat = "account.slack-support"

    /// Mission Control is a standing preference, so it shows in either state.
    public static func shows(_ row: PlanRow?) -> Bool {
        guard let row else { return false }
        if row.id == missionControl { return true }
        return row.status != .ready && row.status != .skipped
    }
}
