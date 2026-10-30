import Foundation
import MattstackCore

private let trayRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../..").standardized

private func source(_ relative: String) throws -> String {
    try String(contentsOf: trayRoot.appendingPathComponent(relative), encoding: .utf8)
}

private var allCopy: [String] {
    let url = URL(string: "https://chromewebstore.google.com/detail/fnfikoifhimpdedpdepehibjjkcfbacm?hl=en")!
    return TestDriveScenario.allCases.flatMap { [$0.title, $0.detail] } + TestDriveSpeed.allCases.flatMap { [$0.title, $0.detail] }
        + [TestDriveCopy.wouldOpen(url), TestDriveCopy.wouldOpenSettings("fda"), TestDriveCopy.wouldAsk("notifications"),
           TestDriveCopy.wouldAskAdmin, TestDriveCopy.wouldAddLoginItems, TestDriveCopy.wouldStartAtLogin,
           TestDriveCopy.wouldNotify(FastSetupLaunch.approvedNotice)]
}

let testDriveChecks: [Check] = [
    Check("Test drive: the prod flavor never offers it, the dev flavor and DEBUG builds do") { c in
        c.expectEqual(TestDrive.isAvailable(isDevBuild: false, isDebugBuild: false), false, "prod release")
        c.expectEqual(TestDrive.isAvailable(isDevBuild: true, isDebugBuild: false), true, "dev bundle")
        c.expectEqual(TestDrive.isAvailable(isDevBuild: false, isDebugBuild: true), true, "a DEBUG build")
    },
    Check("Test drive: the tray's item is added only behind TestDrive.isAvailable") { c in
        let text = try source("Sources/AppDelegate.swift")
        let title = "\"Test drive setup…\""
        try c.requireEqual(text.components(separatedBy: title).count - 1, 1, "the item should be added in exactly one place")
        guard let gate = text.range(of: "if TestDrive.isAvailable(isDevBuild: BundleFlavor.isDevBuild"),
              let item = text.range(of: title) else { return c.fail("gate or item missing") }
        let between = text[gate.upperBound..<item.lowerBound]
        c.expect(gate.upperBound < item.lowerBound && between.split(separator: "\n").count <= 2,
                 "the item must sit directly inside the isAvailable gate")
    },
    Check("Test drive: six scenarios, each one the stub rt knows") { c in
        c.expectEqual(TestDriveScenario.allCases.map(\.title),
                      ["Join a team", "Create a team", "Just me", "Move from another Mac", "A run that pauses", "Slow installs"])
        let stub = try source("Tests/stub-rt/stub.ts")
        for scenario in TestDriveScenario.allCases {
            c.expect(stub.contains("\"\(scenario.stubScenario)\""), "stub.ts has no scenario \(scenario.stubScenario)")
        }
        c.expectEqual(Set(TestDriveScenario.allCases.map(\.stubScenario)).count, TestDriveScenario.allCases.count, "two picks run one scenario")
    },
    Check("Test drive: Instant answers in about a second, Realistic in a few, and both check approval sooner than the real 15 s") { c in
        c.expectEqual(TestDriveSpeed.allCases.map(\.title), ["Instant", "Realistic"])
        c.expect(TestDriveSpeed.instant.answerDelay >= 0.5 && TestDriveSpeed.instant.answerDelay <= 1)
        c.expect(TestDriveSpeed.realistic.answerDelay >= 2 && TestDriveSpeed.realistic.answerDelay <= 5)
        c.expectEqual(TestDriveSpeed.instant.joinPollInterval, 1)
        c.expect(TestDriveSpeed.realistic.joinPollInterval > 1 && TestDriveSpeed.realistic.joinPollInterval < 15)
        c.expectEqual(TestDriveSpeed.instant.rawValue, "instant", "RT_STUB_SPEED reads these names")
        c.expectEqual(TestDriveSpeed.realistic.rawValue, "realistic")
    },
    Check("Test drive: the stub runs under bun from the first checkout that has it") { c in
        let have: Set<String> = ["/src/b/rt-tray/Tests/stub-rt/stub.ts", "/opt/homebrew/bin/bun", "/u/.bun/bin/bun"]
        let loc = TestDrive.stubLocation(checkouts: ["/src/a", "/src/b"], buns: ["/nope/bun", "/u/.bun/bin/bun", "/opt/homebrew/bin/bun"],
                                         fileExists: { have.contains($0) })
        c.expectEqual(loc?.executable.path, "/u/.bun/bin/bun")
        c.expectEqual(loc?.argumentPrefix, ["/src/b/rt-tray/Tests/stub-rt/stub.ts"])
        c.expectEqual(loc?.source, .stub)
        c.expect(TestDrive.stubLocation(checkouts: ["/src/a"], buns: ["/u/.bun/bin/bun"], fileExists: { have.contains($0) }) == nil,
                 "no checkout with the stub, no drive")
        c.expect(TestDrive.stubLocation(checkouts: ["/src/b"], buns: ["/nope/bun"], fileExists: { have.contains($0) }) == nil,
                 "no bun, no drive")
    },
    Check("Test drive: every stub call runs on the drive's own HOME and state, never this app's socket") { c in
        let env = TestDrive.environment(scenario: .paused, speed: .realistic, stateDir: "/tmp/d/state", home: "/tmp/d/home")
        c.expectEqual(env["RT_STUB_SCENARIO"], "apply-fail-retry")
        c.expectEqual(env["RT_STUB_SPEED"], "realistic")
        c.expectEqual(env["RT_STUB_STATE_DIR"], "/tmp/d/state")
        c.expectEqual(env["HOME"], "/tmp/d/home")
        c.expect(env["RT_APP_SOCKET"]?.hasPrefix("/tmp/d/home/") == true, "the app socket must point inside the drive")
        c.expectEqual(env["RT_STUB_REAL_WRITING_STYLE"], "", "the stub must never read the account's real skills")
    },
    Check("Test drive: Paste fills an invite code JoinLink reads") { c in
        c.expect(JoinLink.code(fromText: TestDrive.sampleInvite) != nil)
    },
    Check("Test drive: each faked effect says what would have happened, in plain copy") { c in
        let store = URL(string: "https://chromewebstore.google.com/detail/fnfikoifhimpdedpdepehibjjkcfbacm?hl=en")!
        c.expectEqual(TestDriveCopy.wouldOpen(store), "Would open chromewebstore.google.com/detail/fnfikoifhimpdedpdepehibjjkcfbacm")
        c.expectEqual(TestDriveCopy.wouldOpen(URL(string: "https://board.mattstack")!), "Would open board.mattstack")
        c.expectEqual(TestDriveCopy.wouldOpenSettings("fda"), "Would open Full Disk Access in System Settings")
        c.expectEqual(TestDriveCopy.wouldOpenSettings("login-items"), "Would open Login Items in System Settings")
        c.expectEqual(TestDriveCopy.wouldNotify(FastSetupLaunch.approvedNotice), "Would notify: You're in")
        for line in allCopy {
            c.expect(!line.contains("\u{2014}") && !line.contains("\u{2013}"), "a dash in '\(line)'")
            c.expect(!line.contains("\u{00B7}"), "a dot separator in '\(line)'")
            c.expect(!line.hasSuffix("."), "a full stop in '\(line)'")
        }
    },
    Check("Test drive: its sources never reach the Mac's native effects or the real setup's records") { c in
        let dir = trayRoot.appendingPathComponent("Sources/Setup/TestDrive")
        let files = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".swift") }
        try c.require(files.count >= 3, "expected the test drive sources")
        let forbidden = ["NSWorkspace", "SMAppService", "SetupSession", "AppRelaunch", "UNUserNotificationCenter", "NSPasteboard",
                         "SystemPasteboard", "AppFormEffects", "RtClientFactory", "PrivilegedInstaller(", "ServicesRegistrar"]
        for f in files {
            let text = try String(contentsOf: dir.appendingPathComponent(f), encoding: .utf8)
            for needle in forbidden where text.contains(needle) { c.fail("\(f) names \(needle)") }
        }
    },
]
