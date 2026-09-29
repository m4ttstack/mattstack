import Foundation

public enum SettingsPane: String, CaseIterable, Sendable {
    case general, permissions, accounts, fastBrowser, devLogins, apps, team, uninstall

    public var title: String {
        switch self {
        case .general: return "General"
        case .permissions: return "Permissions"
        case .accounts: return "Accounts"
        case .fastBrowser: return "Fast Browser"
        case .devLogins: return "Dev logins"
        case .apps: return "Apps"
        case .team: return "Team"
        case .uninstall: return "Uninstall"
        }
    }

    /// Panes whose rows the 1 s readiness tick re-checks while visible.
    /// Accounts is not one: its rows change only through its own actions,
    /// which re-check, and it refreshes on appear.
    public var watchesReadiness: Bool { self == .permissions }

    public var symbol: String {
        switch self {
        case .general: return "gearshape"
        case .permissions: return "lock.shield"
        case .accounts: return "person.crop.circle"
        case .fastBrowser: return "globe"
        case .devLogins: return "key"
        case .apps: return "square.grid.2x2"
        case .team: return "person.3"
        case .uninstall: return "trash"
        }
    }
}
