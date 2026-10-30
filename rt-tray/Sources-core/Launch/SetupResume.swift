import Foundation

/// The setup step a relaunched app returns to. A permission such as Full
/// Disk Access only takes effect on the next launch, so the checklist offers
/// a relaunch; without this the re-exec reopened the wizard on Welcome.
public enum SetupResume {
    public static let flag = "--resume-setup"

    private static let names: [SetupStep: String] = [
        .welcome: "welcome", .fullDiskAccess: "full-disk-access", .team: "team", .join: "join",
        .checklist: "checklist", .install: "install", .done: "done",
    ]

    /// Passthrough arguments with any earlier resume pair removed and, when a
    /// step is given, the new pair appended.
    public static func relaunchArguments(passthrough: [String], resumeAt: SetupStep?) -> [String] {
        withoutResume(passthrough) + (resumeAt.flatMap { names[$0] }.map { [flag, $0] } ?? [])
    }

    public static func step(from arguments: [String]) -> SetupStep? {
        guard let name = resumeName(in: arguments) else { return nil }
        return names.first { $0.value == name }?.key
    }

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
