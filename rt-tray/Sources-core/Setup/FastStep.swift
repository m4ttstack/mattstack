/// The title bar's "<n> of <total>": where a screen sits on its path's walk.
/// Paused takes the bar's place, so a run counts the same whether it pauses or not.
public enum FastStep {
    /// Each path's screens in order, keyed by rt's `FormPath` (`join`, `create`, `solo`, `restore`).
    public static func order(path: String) -> [FastSetupScreen]? {
        switch path {
        case "join": return [.macos, .path, .invite, .waiting, .connect, .thisMac, .running]
        case "create": return [.macos, .path, .createTeam, .connect, .thisMac, .running]
        case "solo": return [.macos, .path, .connect, .thisMac, .running]
        case "restore": return [.macos, .path, .restore, .running]
        default: return nil
        }
    }

    /// Nil while loading. Before rt names a path (or on a screen its path never
    /// walks), the create and restore screens imply their own and every other screen counts as join.
    public static func counter(for screen: FastSetupScreen, path: String?) -> String? {
        switch screen {
        case .loading: return nil
        case .ready: return "Done"
        case .tools: return "Setup status"
        default: break
        }
        let place: FastSetupScreen = screen == .paused ? .running : screen
        let named = path.flatMap(order(path:)).flatMap { $0.contains(place) ? $0 : nil }
        guard let walk = named ?? order(path: implied(by: place)), let index = walk.firstIndex(of: place) else { return nil }
        return "\(index + 1) of \(walk.count)"
    }

    /// Setup status is not a step in setup, so it shows no counter; its tools and ready screens carry that name.
    public static func label(for screen: FastSetupScreen, path: String?, entry: SetupEntry) -> String? {
        guard entry == .status else { return counter(for: screen, path: path) }
        return screen == .tools || screen == .ready ? "Setup status" : nil
    }

    private static func implied(by screen: FastSetupScreen) -> String {
        switch screen {
        case .createTeam: return "create"
        case .restore: return "restore"
        default: return "join"
        }
    }
}
