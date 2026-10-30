import Foundation
import MattstackCore

let needModelsChecks: [Check] = [
    Check("ProxyHelper path and prompt") { c in
        c.expectEqual(ProxyHelper.path(bundlePath: "/Applications/mattstack.app"),
                      "/Applications/mattstack.app/Contents/Helpers/mattstack-proxy-install")
        c.expect(ProxyHelper.promptText.contains("administrator"))
    },
    Check("NeedResult encodes {ok, detail}") { c in
        let j = String(decoding: try JSONEncoder().encode(NeedResult(ok: true, detail: "proxy installed")), as: UTF8.self)
        c.expect(j.contains("\"ok\":true") && j.contains("\"detail\":\"proxy installed\""))
    },
    Check("NeedModels: an app-privileged need's homebrew flag decodes, and absent reads nil") { c in
        let flagged = try ApplyEvent.decode(#"{"event":"need","id":"proxy.install","request":{"type":"app-privileged","op":"proxy-install","homebrew":true}}"#)
        guard case .need(_, let withFlag) = flagged else { c.fail("not a need event"); return }
        c.expectEqual(withFlag.homebrew, true)
        c.expectEqual(withFlag.op, "proxy-install")

        let plain = try ApplyEvent.decode(#"{"event":"need","id":"proxy.install","request":{"type":"app-privileged","op":"homebrew"}}"#)
        guard case .need(_, let without) = plain else { c.fail("not a need event"); return }
        c.expectEqual(without.homebrew, nil)
        c.expectEqual(without.op, "homebrew")
    },
]
