import Foundation
import MattstackCore

/// The first `get` waits until released and answers the old stored picks; later gets answer the new ones.
private final class SlowFirstReadRt: RtRunning, @unchecked Sendable {
    private var gets = 0
    private var held: CheckedContinuation<Void, Never>?
    private var arrived: CheckedContinuation<Void, Never>?
    private var hasArrived = false

    func waitForFirstRead() async {
        if hasArrived { return }
        await withCheckedContinuation { arrived = $0 }
    }
    func releaseFirstRead() { held?.resume(); held = nil }

    func run(_ args: [String], stdin: Data?) async throws -> RtResult {
        guard args.starts(with: ["settings", "get"]) else { return RtResult(exitCode: 0, stdout: Data(), stderr: Data()) }
        gets += 1
        if gets == 1 {
            hasArrived = true
            arrived?.resume()
            await withCheckedContinuation { held = $0 }
            return RtResult(exitCode: 0, stdout: Data(#"{"ok":true,"value":{"warning":"original"}}"#.utf8), stderr: Data())
        }
        return RtResult(exitCode: 0, stdout: Data(#"{"ok":true,"value":{"warning":"macos/Tink"}}"#.utf8), stderr: Data())
    }

    func stream(_ args: [String], stdin: Data?) -> AsyncThrowingStream<String, Error> { AsyncThrowingStream { $0.finish() } }
}

let notificationSoundsModelChecks: [Check] = [
    Check("NotificationSoundsModel ignores a launch read that answers after a newer pick") { c in
        let rt = SlowFirstReadRt()
        let m = await MainActor.run { NotificationSoundsModel() }
        let launch = Task { await m.load(rt: rt) }
        await rt.waitForFirstRead()
        await m.set(.warning, to: "macos/Tink", rt: rt)
        rt.releaseFirstRead()
        await launch.value
        c.expectEqual(await MainActor.run { m.picks.warning }, "macos/Tink", "the stale launch read must not restore Original")
    },
    Check("NotificationSoundsModel is all Original until rt answers, then reflects the stored picks") { c in
        let rt = ScriptedRt()
        rt.answers["settings get rt.notify.sounds"] = (0, #"{"ok":true,"key":"rt.notify.sounds","value":{"neutral":"none","positive":"sober/102","warning":"macos/Glass"}}"#)
        let m = await MainActor.run { NotificationSoundsModel() }
        c.expectEqual(await MainActor.run { m.picks }, SoundPicks.defaults)
        await m.load(rt: rt)
        c.expectEqual(rt.calls.first?.args, ["settings", "get", "rt.notify.sounds", "--json"])
        c.expectEqual(await MainActor.run { m.picks }, SoundPicks(neutral: "none", positive: "sober/102", warning: "macos/Glass"))
    },
    Check("NotificationSoundsModel writes every tier to the machine scope, then reloads") { c in
        let rt = ScriptedRt()
        rt.answers["settings set rt.notify.sounds"] = (0, "")
        rt.answers["settings get rt.notify.sounds"] = (0, #"{"ok":true,"value":{"neutral":"original","positive":"original","warning":"macos/Tink"}}"#)
        let m = await MainActor.run { NotificationSoundsModel() }
        await m.set(.warning, to: "macos/Tink", rt: rt)
        try c.require(rt.calls.count == 2, "expected set, get; got \(rt.calls.map(\.args))")
        c.expectEqual(rt.calls[0].args, ["settings", "set", "rt.notify.sounds",
                                         #"{"neutral":"original","positive":"original","warning":"macos/Tink"}"#, "--scope", "machine"])
        await MainActor.run {
            c.expectEqual(m.picks.warning, "macos/Tink")
            c.expectEqual(m.error, nil)
        }
    },
    Check("NotificationSoundsModel keeps the pick for this run and says it wasn't saved when the write fails") { c in
        let rt = ScriptedRt()
        rt.answers["settings set rt.notify.sounds"] = (1, "")
        let m = await MainActor.run { NotificationSoundsModel() }
        await m.set(.positive, to: "sober/101", rt: rt)
        await MainActor.run {
            c.expectEqual(m.picks.positive, "sober/101", "a failed write still plays the pick until quit")
            c.expect(m.error?.hasPrefix("Not saved") == true, "the error says the pick wasn't saved")
        }
        c.expectEqual(rt.calls.count, 1, "a failed write does not reload")
    },
]
