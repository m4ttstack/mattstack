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
    // An older rt sends {"homebrew": true} beside the op.
    Check("NeedModels: an app-privileged need with a key the app does not know still decodes") { c in
        let event = try ApplyEvent.decode(#"{"event":"need","id":"proxy.install","request":{"type":"app-privileged","op":"proxy-install","homebrew":true}}"#)
        guard case .need(_, let request) = event else { c.fail("not a need event"); return }
        c.expectEqual(request, NeedRequest(type: "app-privileged", plists: nil, op: "proxy-install"))
    },
]
