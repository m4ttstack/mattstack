import Foundation

/// What the Homebrew step did. It reaches the app on its own stdout line
/// (`MATTSTACK_HOMEBREW=<rawValue>`) because the op it rides goes on either way.
enum HomebrewOutcome: String {
    case ok, present, failed
}

/// This Mac, as the package's Distribution.xml judges it.
struct HostPlatform {
    let arch: String
    let osVersion: OperatingSystemVersion

    static func current() -> HostPlatform {
        // Asks about the hardware, so a process running translated still
        // reads arm64 on Apple silicon.
        var arm64: Int32 = 0
        var size = MemoryLayout<Int32>.size
        let isArm64 = sysctlbyname("hw.optional.arm64", &arm64, &size, nil, 0) == 0 && arm64 == 1
        return HostPlatform(arch: isArm64 ? "arm64" : "x86_64", osVersion: ProcessInfo.processInfo.operatingSystemVersion)
    }
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
    var host: HostPlatform = .current()
    var emit: (String) -> Void = Report.step
    /// Per run, so no two runs share a download and a dead run's leftover is
    /// never this run's stage.
    let stagePath = ProxyPaths.homebrewStage(pid: ProcessInfo.processInfo.processIdentifier)

    /// Where the Apple silicon and the Intel installs put brew.
    static let brewPaths = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
    static let packageName = "Homebrew.pkg"
    /// The download waits on no person, but a network that stops answering
    /// would otherwise hold the escalated session, and the proxy op queued
    /// behind it, open. curl's own stall limits end a dead transfer sooner.
    static let downloadTimeout: TimeInterval = 900
    /// Room over the pinned size, so the cap can never refuse the right bytes.
    static let downloadSlackBytes = 1 << 20

    /// `--disable` only works as the first argument: it keeps any .curlrc out
    /// of a fetch whose every option is stated here. Under 10 KB/s for a whole
    /// minute is a stall.
    static func downloadArgv(url: String, to path: String, maxBytes: Int) -> [String] {
        ["/usr/bin/curl", "--disable", "--fail", "--location", "--proto", "=https", "--silent", "--show-error",
         "--connect-timeout", "30", "--speed-limit", "10240", "--speed-time", "60",
         "--max-filesize", String(maxBytes), "-o", path, url]
    }

    static func installerArgv(_ packagePath: String) -> [String] {
        ["/usr/sbin/installer", "-pkg", packagePath, "-target", "/"]
    }

    func run() -> HomebrewOutcome {
        if let brew = installedBrew() {
            emit("homebrew: present (\(brew))")
            return .present
        }
        if let reason = unsupportedReason() {
            emit("homebrew: failed \(reason)")
            return .failed
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

    private func unsupportedReason() -> String? {
        if host.arch != pins.homebrewArch {
            return "the pinned package is for \(pins.homebrewArch) Macs, and this Mac is \(host.arch)"
        }
        let need = pins.homebrewMinimumMacOS, have = host.osVersion
        if (have.majorVersion, have.minorVersion, have.patchVersion) < (need.majorVersion, need.minorVersion, need.patchVersion) {
            return "the pinned package needs macOS \(Self.describe(need)) or later, and this Mac runs \(Self.describe(have))"
        }
        return nil
    }

    private static func describe(_ version: OperatingSystemVersion) -> String {
        "\(version.majorVersion).\(version.minorVersion)" + (version.patchVersion > 0 ? ".\(version.patchVersion)" : "")
    }

    /// Leaves the stage a private directory this run just created. Its parent
    /// is root-only, so a symlink at the stage is nothing a run of ours left
    /// behind: it is refused, and left for someone to look at.
    private func claim(_ stage: URL) throws {
        let parent = stage.deletingLastPathComponent()
        if try !RootOwned.check(parent, fs: fs) {
            try fs.mkdir(parent)
            try RootOwned.check(parent, fs: fs)
        }
        if let existing = try fs.stat(stage) {
            if existing.isSymlink { throw ProxyInstallError("refusing the symlink at \(stage.path)") }
            try fs.removeTree(stage)
        }
        try fs.makePrivateDirectory(stage)
    }

    private func install(from stage: URL) -> (HomebrewOutcome, String) {
        let package = stage.appendingPathComponent(Self.packageName)
        let download = runCommand(
            Self.downloadArgv(url: pins.homebrewPkgUrl, to: package.path, maxBytes: pins.homebrewPkgSize + Self.downloadSlackBytes),
            timeout: Self.downloadTimeout)
        guard download.status == 0 else { return (.failed, Self.failedRun("download", download)) }
        guard let info = try? fs.stat(package), info.isRegularFile, !info.isSymlink, info.uid == 0 else {
            return (.failed, "homebrew: failed the download left no root-owned regular file at \(package.path)")
        }
        let found: String
        do { found = try fs.fileHash(package) } catch {
            return (.failed, "homebrew: failed could not hash \(package.path): \(error)")
        }
        guard found == pins.homebrewPkgSha256 else {
            return (.failed, "homebrew: failed sha256 mismatch: pinned \(pins.homebrewPkgSha256), downloaded \(found)")
        }
        // No timeout: installer waits on no person, and killing it midway would
        // leave a half-installed prefix whose bin/brew reads as present forever.
        let installer = runCommand(Self.installerArgv(package.path), timeout: nil)
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
    private func runCommand(_ argv: [String], timeout: TimeInterval?) -> CommandResult {
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
