import Foundation
import XCTest
@testable import ProxyInstall

private let pinnedPackage = Data("the pinned Homebrew package".utf8)
private let stage = ProxyPaths.homebrewStage
private let stagedPkg = ProxyPaths.homebrewStage + "/Homebrew.pkg"
private let appleSiliconBrew = "/opt/homebrew/bin/brew"

// A root process downloads a package and hands it to installer(8), so the
// contract is where the bytes land, which bytes are accepted, and that
// nothing of the download outlives the run whatever happens to it.
final class HomebrewStepTests: XCTestCase {
    private var fs = RecordingFileOps()
    private var runner = FakeCommandRunner()
    private var lines: [String] = []
    private var stageAtDownload: PathStat?
    private let pins = PinsValues.fixture(homebrewPkgSha256: sha256Hex(pinnedPackage))

    override func setUp() {
        super.setUp()
        fs = RecordingFileOps()
        runner = FakeCommandRunner()
        lines = []
        stageAtDownload = nil
        serve(pinnedPackage)
    }

    /// curl leaves `body` at its -o path; a succeeding installer puts brew
    /// where the Apple silicon package does.
    private func serve(
        _ body: Data,
        download: CommandResult = CommandResult(status: 0, output: ""),
        installer: CommandResult = CommandResult(status: 0, output: ""),
        installerLeavesBrew: Bool = true
    ) {
        let fs = self.fs
        runner.handler = { [self] argv in
            switch argv.first {
            case "/usr/bin/curl":
                stageAtDownload = try? fs.stat(URL(fileURLWithPath: stage))
                if download.status == 0, let o = argv.firstIndex(of: "-o") { fs.place(argv[o + 1], body) }
                return download
            case "/usr/sbin/installer":
                if installer.status == 0, installerLeavesBrew { fs.existingPaths.insert(appleSiliconBrew) }
                return installer
            default:
                return CommandResult(status: 0, output: "")
            }
        }
    }

    private func makeStep() -> HomebrewStep {
        var step = HomebrewStep(fs: fs, runner: runner, pins: pins)
        step.emit = { [self] in lines.append($0) }
        return step
    }

    func testPresentBrewSkipsTheDownload() {
        for brew in HomebrewStep.brewPaths {
            setUp()
            fs.existingPaths.insert(brew)
            XCTAssertEqual(makeStep().run(), .present, brew)
            XCTAssertTrue(runner.calls.isEmpty, brew)
            XCTAssertTrue(fs.ops.isEmpty, "nothing is staged when brew is already there: \(fs.ops)")
            XCTAssertEqual(lines, ["homebrew: present (\(brew))"])
        }
    }

    // The URL is the compiled pin and the destination a fresh private
    // directory under the root-owned proxy tree: nothing on the command line
    // came from argv, the request, or anywhere the console user can write.
    func testInstallRunsTheInstallerOnThePinnedPackage() {
        XCTAssertEqual(makeStep().run(), .ok)
        XCTAssertEqual(runner.calls, [
            ["/usr/bin/curl", "--disable", "--fail", "--location", "--proto", "=https", "--silent", "--show-error",
             "-o", stagedPkg, pins.homebrewPkgUrl],
            ["/usr/sbin/installer", "-pkg", stagedPkg, "-target", "/"],
        ])
        XCTAssertTrue(stagedPkg.hasPrefix(ProxyPaths.root + "/"))
        XCTAssertEqual(stageAtDownload?.isDirectory, true, "the stage exists before curl writes into it")
        XCTAssertEqual(fs.modes[stage], 0o700)
        XCTAssertTrue(fs.ops.contains("mkdir-private \(stage)"))
        XCTAssertTrue(fs.removed.contains(stage))
        XCTAssertNil(try fs.stat(URL(fileURLWithPath: stage)))
        XCTAssertEqual(lines, ["homebrew: ok"])
    }

    func testShaMismatchRefusesAndRemovesTheStage() {
        serve(Data("some other package".utf8))
        XCTAssertEqual(makeStep().run(), .failed)
        XCTAssertFalse(runner.called("installer"), "a package the pin does not describe is never installed")
        XCTAssertTrue(fs.removed.contains(stage))
        XCTAssertEqual(lines, [
            "homebrew: failed sha256 mismatch: pinned \(pins.homebrewPkgSha256), downloaded \(sha256Hex(Data("some other package".utf8)))",
        ])
    }

    // Homebrew is a convenience riding the proxy's prompt: an installer that
    // fails costs Homebrew and nothing else, and says so before the trust line.
    func testInstallerFailureIsReportedNotFatal() {
        serve(pinnedPackage, installer: CommandResult(status: 1, output: "installer: The install failed.\n"))
        fs.existingPaths.insert(caFixturePath)
        var op = InstallOp(
            bundleRoot: URL(fileURLWithPath: "/Applications/mattstack.app/Contents"),
            user: .fixture(),
            pins: pins,
            fs: fs,
            runner: runner,
            copyPayload: { _, _, _, _ in })
        op.homebrew = makeStep()
        op.emit = { [self] in lines.append($0) }
        op.caWait = 0

        XCTAssertEqual(op.execute(), ExitCode.ok)
        XCTAssertTrue(runner.called("bootstrap"))
        XCTAssertTrue(fs.removed.contains(stage))
        XCTAssertEqual(lines.first, "homebrew: failed installer exited 1: installer: The install failed.")
        XCTAssertEqual(lines.suffix(2), ["MATTSTACK_HOMEBREW=failed", "MATTSTACK_TRUST=ok"])
    }

    // The stage's parent is root-only, so a symlink there is not something a
    // dead run of ours left: it is refused, and left for someone to look at.
    func testASymlinkAtTheStageIsRefusedAndLeftAlone() {
        fs.symlinkPaths.insert(stage)
        XCTAssertEqual(makeStep().run(), .failed)
        XCTAssertTrue(runner.calls.isEmpty)
        XCTAssertFalse(fs.removed.contains(stage))
        XCTAssertEqual(lines, ["homebrew: failed refusing the symlink at \(stage)"])
    }

    func testAStageLeftByADeadRunIsReplacedWithAFreshOne() throws {
        fs.existingPaths.insert(stage)
        XCTAssertEqual(makeStep().run(), .ok)
        let removedFirst = try XCTUnwrap(fs.ops.firstIndex(of: "remove \(stage)"))
        let created = try XCTUnwrap(fs.ops.firstIndex(of: "mkdir-private \(stage)"))
        XCTAssertLessThan(removedFirst, created)
    }

    func testAProxyRootTheConsoleUserCouldWriteIsRefusedBeforeAnyDownload() {
        let unsafe = [
            PathStat(uid: 501, isDirectory: true),
            PathStat(uid: 0, isDirectory: true, isGroupOrWorldWritable: true),
            PathStat(uid: 0, isSymlink: true),
        ]
        for root in unsafe {
            setUp()
            fs.statOverrides[ProxyPaths.root] = root
            XCTAssertEqual(makeStep().run(), .failed, "\(root)")
            XCTAssertTrue(runner.calls.isEmpty, "\(root)")
            XCTAssertFalse(fs.ops.contains("mkdir-private \(stage)"), "\(root)")
            XCTAssertEqual(lines.first?.hasPrefix("homebrew: failed refusing to install under"), true, "got: \(lines)")
        }
    }

    // A first install reaches here before CopyStep has made the tree.
    func testAMissingProxyRootIsCreatedBeforeTheStage() throws {
        XCTAssertEqual(makeStep().run(), .ok)
        let root = try XCTUnwrap(fs.ops.firstIndex(of: "mkdir \(ProxyPaths.root)"))
        let created = try XCTUnwrap(fs.ops.firstIndex(of: "mkdir-private \(stage)"))
        XCTAssertLessThan(root, created)
    }

    func testADownloadFailureRemovesTheStageAndSkipsTheInstaller() {
        serve(pinnedPackage, download: CommandResult(status: 22, output: "curl: (22) The requested URL returned error: 404\n"))
        XCTAssertEqual(makeStep().run(), .failed)
        XCTAssertFalse(runner.called("installer"))
        XCTAssertTrue(fs.removed.contains(stage))
        XCTAssertEqual(lines, ["homebrew: failed download exited 22: curl: (22) The requested URL returned error: 404"])
    }

    func testAnInstallerThatLeavesNoBrewIsAFailure() {
        serve(pinnedPackage, installerLeavesBrew: false)
        XCTAssertEqual(makeStep().run(), .failed)
        XCTAssertTrue(fs.removed.contains(stage))
        XCTAssertEqual(lines.last?.hasPrefix("homebrew: failed the installer finished but no brew"), true, "got: \(lines)")
    }

    // A stalled download would otherwise hold the escalated session, and the
    // proxy install queued behind it, for as long as the network takes.
    func testTheDownloadAndTheInstallerAreBoundedAndGetAStatedEnvironment() {
        _ = makeStep().run()
        XCTAssertEqual(runner.timeouts.count, 2)
        XCTAssertTrue(runner.timeouts.allSatisfy { $0 != nil })
        XCTAssertEqual(runner.envs, [["PATH": LaunchdPlist.daemonPath], ["PATH": LaunchdPlist.daemonPath]])
    }

    func testTheHomebrewVerbReportsItsOutcomeAndExitsZeroEvenWhenItFails() {
        serve(Data("some other package".utf8))
        var op = HomebrewOp(step: makeStep())
        op.emit = { [self] in lines.append($0) }
        XCTAssertEqual(op.execute(), ExitCode.ok)
        XCTAssertEqual(lines.last, "MATTSTACK_HOMEBREW=failed")
    }
}
