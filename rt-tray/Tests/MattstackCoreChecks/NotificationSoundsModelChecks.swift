import Foundation
import MattstackCore

let notificationSoundsModelChecks: [Check] = [
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
    Check("NotificationSoundsModel puts the pick back and shows an error when the write fails") { c in
        let rt = ScriptedRt()
        rt.answers["settings set rt.notify.sounds"] = (1, "")
        let m = await MainActor.run { NotificationSoundsModel() }
        await m.set(.positive, to: "sober/101", rt: rt)
        await MainActor.run {
            c.expectEqual(m.picks, SoundPicks.defaults, "a failed write reverts the optimistic pick")
            c.expect(m.error != nil)
        }
        c.expectEqual(rt.calls.count, 1, "a failed write does not reload")
    },
]
