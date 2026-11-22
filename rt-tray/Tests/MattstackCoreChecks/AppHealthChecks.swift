import Foundation
@testable import MattstackCore

private func healthBody(_ text: String) -> Data { Data(text.utf8) }

let appHealthChecks: [Check] = [
    Check("app health: a mattstack health answer carries its boot id as the token and its build id") { c in
        let body = healthBody(#"{"ok":true,"name":"chat","version":"1.2.3","bootId":"boot-1","buildId":"build-1"}"#)
        c.expectEqual(AppHealthParse.mattstack(status: 200, body: body),
                      AppHealth(answering: true, token: "boot-1", buildId: "build-1"))
        let nullBuild = healthBody(#"{"ok":true,"name":"chat","version":"1.2.3","bootId":"boot-1","buildId":null}"#)
        c.expectEqual(AppHealthParse.mattstack(status: 200, body: nullBuild),
                      AppHealth(answering: true, token: "boot-1", buildId: nil))
    },
    Check("app health: HTML answered at the health route is not a mattstack health answer") { c in
        c.expectEqual(AppHealthParse.mattstack(status: 200, body: healthBody("<!doctype html><html></html>")), nil)
        c.expectEqual(AppHealthParse.mattstack(status: 200, body: healthBody(#"{"status":"ok"}"#)), nil)
        c.expectEqual(AppHealthParse.mattstack(status: 200, body: healthBody(#"{"ok":1}"#)), nil)
        c.expectEqual(AppHealthParse.mattstack(status: 200, body: healthBody(#"[true]"#)), nil)
        c.expectEqual(AppHealthParse.mattstack(status: 404, body: Data()), nil)
    },
    Check("app health: ok false or a non-200 status is not answering") { c in
        let notOk = healthBody(#"{"ok":false,"bootId":"boot-1","buildId":null}"#)
        c.expectEqual(AppHealthParse.mattstack(status: 503, body: notOk)?.answering, false)
        c.expectEqual(AppHealthParse.mattstack(status: 200, body: notOk)?.answering, false)
        let okBody = healthBody(#"{"ok":true,"bootId":"boot-1"}"#)
        c.expectEqual(AppHealthParse.mattstack(status: 503, body: okBody)?.answering, false)
    },
    Check("app health: deck answers with its pid as the token") { c in
        c.expectEqual(AppHealthParse.deck(status: 200, pid: "4242"),
                      AppHealth(answering: true, token: "4242", buildId: nil))
        c.expectEqual(AppHealthParse.deck(status: 502, pid: nil).answering, false)
        c.expectEqual(AppHealthParse.deck(status: 200, pid: nil).answering, false,
                      "the proxy answers deck's host while deck is down, without the pid")
    },
    Check("app health: the fallback counts any status below 500 as answering, and no response as not") { c in
        c.expectEqual(AppHealthParse.fallback(status: 200), AppHealth(answering: true, token: nil, buildId: nil))
        c.expect(AppHealthParse.fallback(status: 301).answering)
        c.expect(AppHealthParse.fallback(status: 404).answering)
        c.expect(AppHealthParse.fallback(status: 499).answering)
        c.expect(!AppHealthParse.fallback(status: 500).answering)
        c.expect(!AppHealthParse.fallback(status: 502).answering)
        c.expect(!AppHealthParse.fallback(status: nil).answering)
    },
]
