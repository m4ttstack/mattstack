import Foundation
import MattstackCore

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
]
