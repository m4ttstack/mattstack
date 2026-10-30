import Foundation

/// What the Homebrew step did. It reaches the app on its own stdout line
/// (`MATTSTACK_HOMEBREW=<rawValue>`) because the op it rides goes on either way.
enum HomebrewOutcome: String {
    case ok, present, failed
}

// Homebrew rides the proxy's admin prompt, so this fetches a package from the
// network and installs it as root. Everything that decides what gets installed
// is compiled in: the URL and the sha256 come from the pins, the stage from
// ProxyPaths, and nothing from argv, the request or a file the console user
// can write.
struct HomebrewStep {
    let fs: FileOps
    let runner: CommandRunner
    let pins: PinsValues
    var emit: (String) -> Void = Report.step
    var stagePath: String = ProxyPaths.homebrewStage
    /// Both bounded: a stalled download or installer would otherwise hold the
    /// escalated session, and the proxy op queued behind it, for as long as it
    /// takes.
    var downloadTimeout: TimeInterval = 300
    var installerTimeout: TimeInterval = 180

    /// Where the Apple silicon and the Intel installs put brew.
    static let brewPaths = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
    static let packageName = "Homebrew.pkg"

    /// `--disable` only works as the first argument: it keeps any .curlrc out
    /// of a fetch whose every option is stated here.
    static func downloadArgv(url: String, to path: String) -> [String] {
        ["/usr/bin/curl", "--disable", "--fail", "--location", "--proto", "=https", "--silent", "--show-error",
         "-o", path, url]
    }

    static func installerArgv(_ packagePath: String) -> [String] {
        ["/usr/sbin/installer", "-pkg", packagePath, "-target", "/"]
    }

    func run() -> HomebrewOutcome {
        if let brew = installedBrew() {
            emit("homebrew: present (\(brew))")
            return .present
        }
        let stage = URL(fileURLWithPath: stagePath)
        do {
            try claim(stage)
        } catch {
            emit("homebrew: failed \(error)")
            return .failed
        }
        let (outcome, line) = install(from: stage)
        do { try fs.removeTree(stage) } catch {
            emit("homebrew: could not remove \(stage.path): \(error)")
        }
        emit(line)
        return outcome
    }

    private func installedBrew() -> String? {
        Self.brewPaths.first { (try? fs.stat(URL(fileURLWithPath: $0))) != nil }
    }

    /// Leaves the stage a private directory this run just created. Its parent
    /// is root-only, so a symlink at the stage is nothing a dead run of ours
    /// left behind: it is refused, and left for someone to look at.
    private func claim(_ stage: URL) throws {
        let parent = stage.deletingLastPathComponent()
        if try !CopyStep.checkRootOwned(parent, fs: fs) {
            try fs.mkdir(parent)
            try CopyStep.checkRootOwned(parent, fs: fs)
        }
        if let existing = try fs.stat(stage) {
            if existing.isSymlink { throw ProxyInstallError("refusing the symlink at \(stage.path)") }
            try fs.removeTree(stage)
        }
        try fs.makePrivateDirectory(stage)
    }

    private func install(from stage: URL) -> (HomebrewOutcome, String) {
        let package = stage.appendingPathComponent(Self.packageName)
        let download = runCommand(Self.downloadArgv(url: pins.homebrewPkgUrl, to: package.path), timeout: downloadTimeout)
        guard download.status == 0 else { return (.failed, Self.failedRun("download", download)) }
        guard let info = try? fs.stat(package), info.isRegularFile, !info.isSymlink, info.uid == 0 else {
            return (.failed, "homebrew: failed the download left no package at \(package.path)")
        }
        let found: String
        do { found = try fs.fileHash(package) } catch {
            return (.failed, "homebrew: failed could not hash \(package.path): \(error)")
        }
        guard found == pins.homebrewPkgSha256 else {
            return (.failed, "homebrew: failed sha256 mismatch: pinned \(pins.homebrewPkgSha256), downloaded \(found)")
        }
        let installer = runCommand(Self.installerArgv(package.path), timeout: installerTimeout)
        guard installer.status == 0 else { return (.failed, Self.failedRun("installer", installer)) }
        guard installedBrew() != nil else {
            return (.failed, "homebrew: failed the installer finished but no brew is at \(Self.brewPaths.joined(separator: " or "))")
        }
        return (.ok, "homebrew: ok")
    }

    private static func failedRun(_ what: String, _ result: CommandResult) -> String {
        if result.status == RealCommandRunner.timedOutStatus { return "homebrew: failed \(what) \(result.output)" }
        let output = TrustStep.condensed(result.output)
        return "homebrew: failed \(what) exited \(result.status)" + (output.isEmpty ? "" : ": \(output)")
    }

    /// Children get a stated environment, never this process's.
    private func runCommand(_ argv: [String], timeout: TimeInterval) -> CommandResult {
        do { return try runner.run(argv, env: ["PATH": LaunchdPlist.daemonPath], timeout: timeout) } catch {
            return CommandResult(status: -1, output: "\(error)")
        }
    }
}

/// The `homebrew` verb: Homebrew alone, for a Mac whose proxy needs nothing.
/// The outcome travels on its line, never the exit code, so rt keeps the step
/// done and says what happened, as it does when Homebrew rides an install.
struct HomebrewOp {
    let step: HomebrewStep
    var emit: (String) -> Void = Report.step

    static func run() -> Int32 {
        guard geteuid() == 0 else {
            Report.step("mattstack-proxy-install homebrew must run as root")
            return ExitCode.noPerm
        }
        return HomebrewOp(step: HomebrewStep(fs: RealFileOps(), runner: RealCommandRunner(), pins: Pins.current)).execute()
    }

    func execute() -> Int32 {
        emit(Report.homebrewLine(step.run()))
        return ExitCode.ok
    }
}
