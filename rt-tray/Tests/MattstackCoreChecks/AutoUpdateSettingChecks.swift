import Foundation
import MattstackCore

let autoUpdateSettingChecks: [Check] = [
    Check("AutoUpdateSetting reads true with exact argv") { c in
        let rt = ScriptedRt()
        rt.answers["settings get mattstack.autoUpdate"] = (0, #"{"ok":true,"key":"mattstack.autoUpdate","value":true,"provenance":{}}"#)
        c.expectEqual(await AutoUpdateSetting.read(rt), true)
        c.expectEqual(rt.calls.map(\.args), [["settings", "get", "mattstack.autoUpdate", "--json"]])
    },
    Check("AutoUpdateSetting reads false") { c in
        let rt = ScriptedRt()
        rt.answers["settings get mattstack.autoUpdate"] = (0, #"{"ok":true,"key":"mattstack.autoUpdate","value":false,"provenance":{}}"#)
        c.expectEqual(await AutoUpdateSetting.read(rt), false)
    },
    Check("AutoUpdateSetting: a failed read is no answer") { c in
        let rt = ScriptedRt()
        rt.answers["settings get mattstack.autoUpdate"] = (1, "")
        c.expectEqual(await AutoUpdateSetting.read(rt), nil)
    },
    Check("AutoUpdateSetting: undecodable output is no answer") { c in
        let rt = ScriptedRt()
        rt.answers["settings get mattstack.autoUpdate"] = (0, "nope")
        c.expectEqual(await AutoUpdateSetting.read(rt), nil)
    },
]
