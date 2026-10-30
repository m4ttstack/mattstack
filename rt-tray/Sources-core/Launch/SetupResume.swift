import Foundation

/// The setup screen a relaunched app returns to. A permission such as Full
/// Disk Access only takes effect on the next launch, so setup offers a
/// relaunch, and the relaunch reopens setup.
public enum SetupResume {
    public static let flag = "--resume-setup"

    /// Passthrough arguments with any earlier resume pair removed and, when a
    /// screen is given, the new pair appended.
    public static func relaunchArguments(passthrough: [String], resumeScreen: FastSetupScreen?) -> [String] {
        withoutResume(passthrough) + (resumeScreen.map { [flag, $0.rawValue] } ?? [])
    }

    public static func screen(from arguments: [String]) -> FastSetupScreen? {
        resumeName(in: arguments).flatMap(FastSetupScreen.init(rawValue:))
    }

    private static func withoutResume(_ passthrough: [String]) -> [String] {
        var out: [String] = []
        var skipNext = false
        for arg in passthrough {
            if skipNext { skipNext = false; continue }
            if arg == flag { skipNext = true; continue }
            out.append(arg)
        }
        return out
    }

    private static func resumeName(in arguments: [String]) -> String? {
        guard let i = arguments.firstIndex(of: flag), i + 1 < arguments.count else { return nil }
        return arguments[i + 1]
    }
}
