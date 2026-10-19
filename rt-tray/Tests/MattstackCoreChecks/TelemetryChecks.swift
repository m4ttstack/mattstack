import Foundation
import MattstackCore

private actor Gate {
    private var arrived = false
    private var arrivalWaiters: [CheckedContinuation<Void, Never>] = []
    private var held: CheckedContinuation<Void, Never>?
    func arrive() async {
        arrived = true
        arrivalWaiters.forEach { $0.resume() }
        arrivalWaiters = []
        await withCheckedContinuation { held = $0 }
    }
    func waitForArrival() async {
        if arrived { return }
        await withCheckedContinuation { arrivalWaiters.append($0) }
    }
    func release() { held?.resume(); held = nil }
}

/// `set` waits on `gate` (or throws a spawn failure); `get` always answers off.
private final class SwitchRt: RtRunning, @unchecked Sendable {
    var gate: Gate?
    var throwOnSet = false
    var gets = 0

    func run(_ args: [String], stdin: Data?) async throws -> RtResult {
        if args.starts(with: ["settings", "get"]) {
            gets += 1
            return RtResult(exitCode: 0, stdout: Data(#"{"ok":true,"value":false}"#.utf8), stderr: Data())
        }
        if throwOnSet { throw RtClientError.spawnFailed("no rt") }
        if let gate { await gate.arrive() }
        return RtResult(exitCode: 0, stdout: Data(), stderr: Data())
    }

    func stream(_ args: [String], stdin: Data?) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { $0.finish() }
    }
}

let telemetryChecks: [Check] = [
    Check("TelemetrySettingsModel is on until rt answers, then reflects the stored value with exact argv") { c in
        let rt = ScriptedRt()
        rt.answers["settings get telemetry.enabled"] = (0, #"{"ok":true,"key":"telemetry.enabled","value":false,"provenance":{}}"#)
        let m = await MainActor.run { TelemetrySettingsModel(rt: rt) }
        c.expectEqual(await MainActor.run { m.enabled }, true, "the registry default is on before the first answer")
        await m.load()
        try c.require(rt.calls.count == 1, "expected one call; got \(rt.calls.map(\.args))")
        c.expectEqual(rt.calls[0].args, ["settings", "get", "telemetry.enabled", "--json"])
        c.expectEqual(await MainActor.run { m.enabled }, false)
        c.expectEqual(await MainActor.run { m.error }, nil)
    },
    Check("TelemetrySettingsModel writes the user-scope setting with exact argv, then reloads") { c in
        let rt = ScriptedRt()
        rt.answers["settings get telemetry.enabled"] = (0, #"{"ok":true,"key":"telemetry.enabled","value":false}"#)
        rt.answers["settings set telemetry.enabled false --scope user"] = (0, "")
        let m = await MainActor.run { TelemetrySettingsModel(rt: rt) }
        await m.setEnabled(false)
        try c.require(rt.calls.count == 2, "expected set, get; got \(rt.calls.map(\.args))")
        c.expectEqual(rt.calls[0].args, ["settings", "set", "telemetry.enabled", "false", "--scope", "user"])
        c.expectEqual(rt.calls[1].args, ["settings", "get", "telemetry.enabled", "--json"])
        await MainActor.run {
            c.expectEqual(m.enabled, false)
            c.expectEqual(m.inFlight, false)
            c.expectEqual(m.error, nil)
        }
    },
    Check("TelemetrySettingsModel rolls the switch back and shows an error when the write fails") { c in
        let rt = ScriptedRt()
        rt.answers["settings set telemetry.enabled false"] = (1, "")
        let m = await MainActor.run { TelemetrySettingsModel(rt: rt) }
        await m.setEnabled(false)
        await MainActor.run {
            c.expectEqual(m.enabled, true, "a failed write reverts the optimistic switch")
            c.expect(m.error != nil, "a failed write surfaces an error")
            c.expectEqual(m.inFlight, false)
        }
        c.expectEqual(rt.calls.count, 1, "a failed write does not reload")
    },
    Check("TelemetrySettingsModel keeps the default and shows an error when the read fails") { c in
        let rt = ScriptedRt()
        rt.answers["settings get telemetry.enabled"] = (1, "")
        let m = await MainActor.run { TelemetrySettingsModel(rt: rt) }
        await m.load()
        await MainActor.run {
            c.expectEqual(m.enabled, true)
            c.expect(m.error != nil)
        }
    },
    Check("TelemetrySettingsModel rolls the switch back when rt cannot start") { c in
        let rt = SwitchRt()
        rt.throwOnSet = true
        let m = await MainActor.run { TelemetrySettingsModel(rt: rt) }
        await m.setEnabled(false)
        await MainActor.run {
            c.expectEqual(m.enabled, true, "a spawn failure reverts the optimistic switch")
            c.expect(m.error != nil, "a spawn failure surfaces an error")
            c.expectEqual(m.inFlight, false)
        }
        c.expectEqual(rt.gets, 0, "a failed write does not reload")
    },
    Check("TelemetrySettingsModel load skips while a write is in flight") { c in
        let rt = SwitchRt()
        let gate = Gate()
        rt.gate = gate
        let m = await MainActor.run { TelemetrySettingsModel(rt: rt) }
        let first = Task { await m.setEnabled(false) }
        await gate.waitForArrival()
        await MainActor.run {
            c.expectEqual(m.enabled, false, "the switch flips before rt answers")
            c.expectEqual(m.inFlight, true)
        }
        await m.load()
        c.expectEqual(rt.gets, 0, "a read during the write must not run")
        await gate.release()
        await first.value
        c.expectEqual(rt.gets, 1, "the write's own reload runs once")
        await MainActor.run { c.expectEqual(m.inFlight, false) }
    },
]
