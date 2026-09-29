import Foundation
@testable import MattstackCore

private final class Script: @unchecked Sendable {
    private let lock = NSLock()
    private var probes = 0
    private let upAt: Int?
    private let exitAt: Int?
    private let status: Int32
    init(upAt: Int?, exitAt: Int?, status: Int32 = 1) {
        self.upAt = upAt; self.exitAt = exitAt; self.status = status
    }
    func probe() -> Bool {
        lock.lock(); defer { lock.unlock() }
        probes += 1
        return upAt.map { probes >= $0 } ?? false
    }
    func exitStatus() -> Int32? {
        lock.lock(); defer { lock.unlock() }
        return exitAt.flatMap { probes >= $0 ? status : nil }
    }
    var probeCount: Int { lock.lock(); defer { lock.unlock() }; return probes }
}

private func deps(_ s: Script, stderr: String = "", stdout: String = "") -> LogViewerWaitDeps {
    LogViewerWaitDeps(
        isUp: { s.probe() },
        exitStatus: { s.exitStatus() },
        output: { (stderr: stderr, stdout: stdout) },
        sleep: {}
    )
}

let logViewerLaunchChecks: [Check] = [
    Check("the tray's rt daemon logs spawn passes --no-open so only the tray opens the viewer") { c in
        c.expectEqual(LogViewerLaunch.rtArguments, ["daemon", "logs", "--no-open"])
        c.expect(LogViewerLaunch.loginShellCommand.hasSuffix("rt daemon logs --no-open"), LogViewerLaunch.loginShellCommand)
    },
    Check("log viewer opens once logdy answers") { c in
        let s = Script(upAt: 3, exitAt: nil)
        let outcome = await LogViewerLaunch.awaitViewer(deps(s), attempts: 10)
        c.expectEqual(outcome, .open)
        c.expectEqual(s.probeCount, 3)
    },
    Check("log viewer reports the first stderr line when rt exits without a viewer") { c in
        let s = Script(upAt: nil, exitAt: 2)
        let err = "\u{1B}[33mlogdy not found (checked mattstack.app, PATH)\u{1B}[0m\n  install: brew install logdy\n"
        let outcome = await LogViewerLaunch.awaitViewer(deps(s, stderr: err, stdout: "  native stderr header\n"), attempts: 10)
        c.expectEqual(outcome, .failed(reason: "logdy not found (checked mattstack.app, PATH)"))
    },
    Check("log viewer falls back to stdout's first line when stderr is empty") { c in
        let s = Script(upAt: nil, exitAt: 1, status: 0)
        let outcome = await LogViewerLaunch.awaitViewer(deps(s, stdout: "\n  no daemon logs yet\n"), attempts: 10)
        c.expectEqual(outcome, .failed(reason: "no daemon logs yet"))
    },
    Check("log viewer names the exit code when rt printed nothing") { c in
        let s = Script(upAt: nil, exitAt: 1, status: 127)
        let outcome = await LogViewerLaunch.awaitViewer(deps(s), attempts: 10)
        c.expectEqual(outcome, .failed(reason: "rt daemon logs exited 127 without starting logdy"))
    },
    Check("log viewer gives up when logdy never answers") { c in
        let s = Script(upAt: nil, exitAt: nil)
        let outcome = await LogViewerLaunch.awaitViewer(deps(s), attempts: 4)
        c.expectEqual(outcome, .timedOut)
        c.expectEqual(s.probeCount, 4)
        c.expectEqual(LogViewerLaunch.timedOutReason, "logdy never answered on :5544")
    },
]
