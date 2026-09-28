import Foundation
@testable import MattstackCore

private let listJSON = #"[{"origin":"https://login.example.com","email":"dev@example.com","fields":{"email":"devlogin:login.example.com:email","password":"devlogin:login.example.com:password"}}]"#

private struct EchoingRt: RtRunning {
    let exitCode: Int32
    func run(_ args: [String], stdin: Data?) async throws -> RtResult {
        RtResult(exitCode: exitCode, stdout: Data("not json".utf8), stderr: stdin ?? Data())
    }
    func stream(_ args: [String], stdin: Data?) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { $0.finish() }
    }
}

let devLoginsModelChecks: [Check] = [
    Check("dev logins model: load decodes rt logins list") { c in
        let rt = ScriptedRt(); rt.answers["logins list"] = (0, listJSON)
        let model = await DevLoginsModel(rt: rt)
        await model.load()
        let rows = await model.rows
        try c.requireEqual(rows.count, 1)
        c.expectEqual(rows[0].origin, "https://login.example.com")
        c.expectEqual(rt.calls.first?.args ?? [], ["logins", "list", "--json"])
        c.expect(await model.loaded)
        c.expect(await model.isSaved("https://login.example.com"))
        c.expect(!(await model.isSaved("https://other.example.com")))
    },
    Check("dev logins model: save sends values on stdin only") { c in
        let rt = ScriptedRt(); rt.answers["logins add"] = (0, #"{"ok":true}"#); rt.answers["logins list"] = (0, "[]")
        let model = await DevLoginsModel(rt: rt)
        let err = await model.save(origin: "https://login.example.com", email: "dev@example.com", password: "Canary p@ss")
        c.expect(err == nil)
        let add = try c.requireSome(rt.calls.first { $0.args.starts(with: ["logins", "add"]) })
        c.expectEqual(add.args, ["logins", "add", "https://login.example.com", "--json"])
        c.expect(!add.args.joined().contains("Canary"))
        let body = try JSONSerialization.jsonObject(with: Data((add.stdin ?? "").utf8)) as? [String: String]
        c.expectEqual(body ?? [:], ["email": "dev@example.com", "password": "Canary p@ss"])
    },
    Check("dev logins model: a refused save returns rt's message") { c in
        let rt = ScriptedRt(); rt.answers["logins add"] = (2, #"{"contract":1,"at":"x","error":{"code":"bad-origin","message":"http is allowed only for localhost and 127.0.0.1; use https"}}"#)
        let model = await DevLoginsModel(rt: rt)
        let err = await model.save(origin: "http://login.example.com", email: "a", password: "b")
        c.expectEqual(err, "http is allowed only for localhost and 127.0.0.1; use https")
    },
    Check("dev logins model: a failed save never shows stderr, which can echo the values") { c in
        for code: Int32 in [1, 2] {
            let model = await DevLoginsModel(rt: EchoingRt(exitCode: code))
            let err = try c.requireSome(await model.save(origin: "https://login.example.com", email: "dev@example.com", password: "Canary p@ss"))
            c.expect(!err.contains("Canary") && !err.contains("dev@example.com"), "exit \(code): \(err)")
        }
    },
    Check("dev logins model: remove runs rt logins remove and reloads") { c in
        let rt = ScriptedRt(); rt.answers["logins remove"] = (0, #"{"ok":true,"removed":true}"#); rt.answers["logins list"] = (0, "[]")
        let model = await DevLoginsModel(rt: rt)
        let err = await model.remove(origin: "https://login.example.com")
        c.expect(err == nil)
        c.expectEqual(rt.calls.map(\.args), [["logins", "remove", "https://login.example.com", "--json"], ["logins", "list", "--json"]])
    },
    Check("dev logins confirm: first-time origins need the typed host") { c in
        c.expect(!DevLoginConfirm.canSave(host: "login.example.com", typedHost: "", isFirstTime: true, email: "a", password: "b"))
        c.expect(!DevLoginConfirm.canSave(host: "login.example.com", typedHost: "login-example.com", isFirstTime: true, email: "a", password: "b"))
        c.expect(DevLoginConfirm.canSave(host: "login.example.com", typedHost: " Login.Example.com ", isFirstTime: true, email: "a", password: "b"))
        c.expect(DevLoginConfirm.canSave(host: "login.example.com", typedHost: "", isFirstTime: false, email: "a", password: "b"))
        c.expect(!DevLoginConfirm.canSave(host: "login.example.com", typedHost: "", isFirstTime: false, email: " ", password: "b"))
        c.expect(!DevLoginConfirm.canSave(host: "login.example.com", typedHost: "", isFirstTime: false, email: "a", password: ""))
    },
    Check("dev logins confirm: warnings for punycode and http") { c in
        c.expectEqual(DevLoginConfirm.warnings(origin: "https://login.example.com"), [])
        c.expectEqual(DevLoginConfirm.warnings(origin: "https://xn--bcher-kva.example").count, 1)
        c.expectEqual(DevLoginConfirm.warnings(origin: "http://localhost:3000").count, 1)
    },
    Check("dev login sheet: a saved site reads as Replace whether it was typed, linked or picked") { c in
        let saved: (String) -> Bool = { $0 == "https://login.example.com" }
        c.expect(DevLoginSheetCopy.replacing(fixedOrigin: nil, typedOrigin: "https://Login.example.com/", isSaved: saved), "typed Add of a saved site")
        c.expect(DevLoginSheetCopy.replacing(fixedOrigin: "https://login.example.com", typedOrigin: "", isSaved: saved), "link or Replace of a saved site")
        c.expect(!DevLoginSheetCopy.replacing(fixedOrigin: nil, typedOrigin: "https://other.example.com", isSaved: saved), "typed Add of a new site")
        c.expect(!DevLoginSheetCopy.replacing(fixedOrigin: nil, typedOrigin: "login.example.com", isSaved: saved), "an invalid typed origin")
        c.expectEqual(DevLoginSheetCopy.title(replacing: true), "Replace dev login")
        c.expectEqual(DevLoginSheetCopy.title(replacing: false), "Save a dev login")
    },
    Check("dev login sheet: nothing dismisses it while a save is in flight") { c in
        let sheet = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../Sources/Settings/DevLoginSheet.swift").standardized
        let text = try String(contentsOf: sheet, encoding: .utf8)
        let cancel = text.split(separator: "\n").first { $0.contains("Button(\"Cancel\")") }.map(String.init) ?? ""
        c.expect(cancel.contains(".disabled(saving)"), "Cancel stays enabled during a save")
        c.expect(text.contains(".interactiveDismissDisabled(saving)"), "the sheet can be dismissed during a save")
    },
]
