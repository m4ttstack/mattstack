import AppKit
import MattstackCore

/// Shared by the Setup checklist and Settings > Permissions relaunch buttons
/// (both prompt this after a permission grant that only takes effect on the
/// next launch).
enum AppRelaunch {
    static func relaunchInPlace(resumeAt step: SetupStep? = nil) {
        relaunch(passthrough: SetupResume.relaunchArguments(passthrough: Array(CommandLine.arguments.dropFirst()), resumeAt: step))
    }

    /// Fast setup reopens after the relaunch; rt's whole read decides the screen.
    static func relaunchInPlace(resumeScreen: FastSetupScreen) {
        relaunch(passthrough: SetupResume.relaunchArguments(passthrough: Array(CommandLine.arguments.dropFirst()), resumeScreen: resumeScreen))
    }

    /// Never stops a child rt: a run or a background install outlives the app and is attached to again.
    private static func relaunch(passthrough: [String]) {
        let path = Bundle.main.bundlePath
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        // `open` hands its own environment to the app it launches, so it runs
        // with none: a shell-launched tray must not pass NODE or npm_* on.
        // The clean-room appcast override travels explicitly via --env.
        task.environment = [:]
        var args = ["-n", path]
        if let feed = ProcessInfo.processInfo.environment[UpdatePolicy.overrideEnv] { args += ["--env", "\(UpdatePolicy.overrideEnv)=\(feed)"] }
        if !passthrough.isEmpty { args += ["--args"] + passthrough }
        task.arguments = args
        try? task.run()
        NSApp.terminate(nil)
    }
}
