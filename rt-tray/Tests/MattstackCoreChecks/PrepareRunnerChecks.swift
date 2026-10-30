import Foundation
import MattstackCore

/// Holds each `run` open until the check releases that stage, so a check can act while a prepare is in flight.
private final class HeldRt: RtRunning, @unchecked Sendable {
    private let lock = NSLock()
    private var calls: [[String]] = []
    private var released = Set<String>()

    var allCalls: [[String]] { lock.lock(); defer { lock.unlock() }; return calls }
    func release(_ stage: String) { lock.lock(); released.insert(stage); lock.unlock() }
    private func isReleased(_ stage: String) -> Bool { lock.lock(); defer { lock.unlock() }; return released.contains(stage) }

    func run(_ args: [String], stdin: Data?) async throws -> RtResult {
        lock.lock(); calls.append(args); lock.unlock()
        let stage = args.count > 2 ? args[2] : ""
        while !isReleased(stage) { try? await Task.sleep(nanoseconds: 5_000_000) }
        return RtResult(exitCode: 0, stdout: Data(#"{"ok":true}"#.utf8), stderr: Data())
    }
    func stream(_ args: [String], stdin: Data?) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { $0.finish() }
    }
}

private final class FinishedLog: @unchecked Sendable {
    private let lock = NSLock()
    private var stages: [String] = []
    func append(_ s: String) { lock.lock(); stages.append(s); lock.unlock() }
    var all: [String] { lock.lock(); defer { lock.unlock() }; return stages }
}

let prepareRunnerChecks: [Check] = [
    Check("PrepareRunner: start runs setup prepare for the stage") { c in
        let rt = HeldRt()
        let runner = await MainActor.run { PrepareRunner(rt: rt) }
        await MainActor.run { runner.start("macos") }
        c.expect(await waitUntil { rt.allCalls.count == 1 }, "prepare never spawned")
        c.expectEqual(rt.allCalls.first, ["setup", "prepare", "macos", "--json"])
        c.expectEqual(await MainActor.run { runner.running }, ["macos"])
        rt.release("macos")
    },
    Check("PrepareRunner: a second start while one runs does nothing") { c in
        let rt = HeldRt()
        let runner = await MainActor.run { PrepareRunner(rt: rt) }
        await MainActor.run { runner.start("macos") }
        c.expect(await waitUntil { rt.allCalls.count == 1 }, "prepare never spawned")
        await MainActor.run { runner.start("macos") }
        try? await Task.sleep(nanoseconds: 50_000_000)
        c.expectEqual(rt.allCalls.count, 1, "a running stage spawns no second prepare")
        rt.release("macos")
    },
    Check("PrepareRunner: accounts starts while macos still runs") { c in
        let rt = HeldRt()
        let runner = await MainActor.run { PrepareRunner(rt: rt) }
        await MainActor.run { runner.start("macos"); runner.start("accounts") }
        c.expect(await waitUntil { rt.allCalls.count == 2 }, "accounts waited on macos in the app")
        c.expectEqual(Set(rt.allCalls.map { $0[2] }), ["macos", "accounts"])
        c.expectEqual(await MainActor.run { runner.running }, ["macos", "accounts"])
        rt.release("macos"); rt.release("accounts")
    },
    Check("PrepareRunner: a finished stage reports and frees the slot") { c in
        let rt = HeldRt()
        let finished = FinishedLog()
        let runner = await MainActor.run { PrepareRunner(rt: rt) }
        await MainActor.run {
            runner.onFinished = { finished.append($0) }
            runner.start("macos")
        }
        c.expect(await waitUntil { rt.allCalls.count == 1 }, "prepare never spawned")
        rt.release("macos")
        c.expect(await waitUntil { runner.running.isEmpty }, "the slot stayed taken after rt returned")
        c.expectEqual(finished.all, ["macos"])
        await MainActor.run { runner.start("macos") }
        c.expect(await waitUntil { rt.allCalls.count == 2 }, "a freed stage could not start again")
    },
]
