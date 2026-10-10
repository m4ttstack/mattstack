import Foundation
import LocalAuthentication
import MattstackCore
import OwnerAuthLogic

private func reviewRow(_ plans: [String: Plan], _ profile: String) -> PlanRow? {
    plans[profile]?.groups.flatMap(\.rows).first { $0.id == "tool.codex-policy" }
}

private struct ScriptedAuthenticator: OwnerAuthenticator {
    var probe: Int?
    var answer: Int?
    func canEvaluate() -> Int? { probe }
    func evaluate(reason: String) -> Int? { answer }
}

let codexHookReviewChecks: [Check] = [
    Check("codex hooks: the review rt sends decodes exactly, and Approve runs only its id through rt") { c in
        let plans = try harnessProfilePlans()
        for profile in ["codex-only", "both"] {
            let row = try c.requireSome(reviewRow(plans, profile), profile)
            c.expectEqual(row.status, .needsYou, profile)
            let action = try c.requireSome(row.action, profile)
            c.expectEqual(action.type, .reviewCodexHooks, profile)
            let review = try c.requireSome(action.review, profile)
            c.expectEqual(review.codexHome, "/Users/member/.codex")
            c.expectEqual(review.hooksPath, "/Users/member/.codex/hooks.json")
            c.expectEqual(review.configPath, "/Users/member/.codex/config.toml")
            c.expect(review.executable.hasSuffix("/rt"), "the hook program")
            c.expectEqual(review.digest, String(repeating: "e", count: 64))
            c.expectEqual(review.hooks.map(\.event), ["PreToolUse", "Stop"])
            c.expectEqual(review.hooks.map(\.key), ["/Users/member/.codex/hooks.json:pre_tool_use:0:0", "/Users/member/.codex/hooks.json:stop:0:0"])
            c.expect(review.hooks.allSatisfy { $0.hash.hasPrefix("sha256:") && $0.command.contains("agent policy-hook") }, "hash and command per hook")
            let approval = try c.requireSome(CodexHookApproval(action: action), profile)
            c.expectEqual(approval.args, ["setup", "codex-policy", "--approve", review.id, "--json"])
            c.expectEqual(RowActionDispatcher.dispatch(action, fieldValues: nil, alternative: nil), .reviewCodexHooks)
        }
        c.expect(reviewRow(plans, "claude-only") == nil, "no Codex, no hooks row")
    },
    Check("codex hooks: a row without a verb or a review offers nothing to approve") { c in
        let review = CodexHookReview(id: "cp-1", codexHome: "/h", hooksPath: "/h/hooks.json", configPath: "/h/config.toml", executable: "/h/rt", digest: "d", hooks: [])
        let noVerb = RowAction(type: .reviewCodexHooks, label: "Review…", review: review)
        c.expect(CodexHookApproval(action: noVerb) == nil)
        c.expectEqual(RowActionDispatcher.dispatch(noVerb, fieldValues: nil, alternative: nil), .none)
        let noReview = RowAction(type: .reviewCodexHooks, label: "Review…", verb: ["setup", "codex-policy"])
        c.expect(CodexHookApproval(action: noReview) == nil)
        let emptyId = RowAction(type: .reviewCodexHooks, label: "Review…", verb: ["setup", "codex-policy"],
                                review: CodexHookReview(id: "", codexHome: "/h", hooksPath: "/h/hooks.json", configPath: "/h/config.toml", executable: "/h/rt", digest: "d", hooks: []))
        c.expect(CodexHookApproval(action: emptyId) == nil, "an empty id approves nothing")
    },
    Check("codex hooks: approving sends exactly the id; a stale id or a declined Touch ID shows rt's own words") { c in
        let rt = ScriptedRt()
        rt.answers["setup codex-policy --approve cp-now"] = (0, #"{"contract":1,"at":"x","ok":true,"approved":"cp-now","hooksPath":"/h/hooks.json"}"#)
        rt.answers["setup codex-policy --approve cp-old"] = (2, #"{"contract":1,"at":"x","error":{"code":"stale","message":"These hooks changed after you looked at them, so rt trusted nothing. Look at them again before you approve."}}"#)
        rt.answers["setup codex-policy --approve cp-cancel"] = (2, #"{"contract":1,"at":"x","error":{"code":"refused","message":"You cancelled the Touch ID check, so rt trusted nothing."}}"#)
        let client = await ChoiceClient(rt: rt)
        c.expect(await client.run(["setup", "codex-policy", "--approve", "cp-now", "--json"]) == nil)
        c.expectEqual(rt.calls.last?.args, ["setup", "codex-policy", "--approve", "cp-now", "--json"])
        c.expectEqual(rt.calls.last?.stdin, nil, "nothing but the id travels")
        c.expectEqual(await client.run(["setup", "codex-policy", "--approve", "cp-old", "--json"]),
                      "These hooks changed after you looked at them, so rt trusted nothing. Look at them again before you approve.")
        c.expectEqual(await client.run(["setup", "codex-policy", "--approve", "cp-cancel", "--json"]),
                      "You cancelled the Touch ID check, so rt trusted nothing.")
    },
    Check("codex hooks: the Done screen never routes the review, and an older tray shows no button for it") { c in
        let review = CodexHookReview(id: "cp-1", codexHome: "/h", hooksPath: "/h/hooks.json", configPath: "/h/config.toml", executable: "/h/rt", digest: "d", hooks: [])
        c.expect(DoneActions.route(RowAction(type: .reviewCodexHooks, label: "Review…", verb: ["setup", "codex-policy"], review: review)) == nil)
        let unknown = try JSONDecoder().decode(RowAction.self, from: Data(#"{"type":"some-newer-review","label":"Review…","verb":["setup","x"]}"#.utf8))
        c.expectEqual(unknown.type, .unknown)
        c.expectEqual(RowActionDispatcher.dispatch(unknown, fieldValues: nil, alternative: nil), .none)
    },
]

let ownerAuthChecks: [Check] = [
    Check("owner auth helper: argv is exactly --reason and a readable reason") { c in
        c.expectEqual(OwnerAuthContract.parse(["--reason", "trust 2 rt hooks in Codex (/h/.codex)"]), .reason("trust 2 rt hooks in Codex (/h/.codex)"))
        for bad in [[], ["--reason"], ["--reason", "  "], ["trust"], ["--reason", "a", "b"], ["--why", "a"], ["--reason", String(repeating: "x", count: 301)]] {
            if case .reason = OwnerAuthContract.parse(bad) { c.fail("accepted \(bad)") }
        }
        c.expectEqual(OwnerAuthContract.usageExit, 64)
    },
    Check("owner auth helper: one word and exit code per outcome, matching rt's reader") { c in
        let cases: [(OwnerAuthOutcome, String, Int32)] = [
            (.authenticated, "authenticated", 0), (.cancelled, "cancelled", 1), (.unavailable("x"), "unavailable", 3), (.failed("y"), "failed", 4),
        ]
        for (outcome, word, code) in cases {
            c.expectEqual(OwnerAuthContract.word(outcome), word)
            c.expectEqual(OwnerAuthContract.exitCode(outcome), code)
        }
        c.expectEqual(OwnerAuthContract.message(.unavailable("No login password is set on this Mac")), "No login password is set on this Mac")
        c.expectEqual(OwnerAuthContract.message(.authenticated), nil)
    },
    Check("owner auth helper: LocalAuthentication's codes map to cancel, unavailable or failed, never success") { c in
        c.expectEqual(OwnerAuthContract.userCancel, LAError.Code.userCancel.rawValue)
        c.expectEqual(OwnerAuthContract.userFallback, LAError.Code.userFallback.rawValue)
        c.expectEqual(OwnerAuthContract.systemCancel, LAError.Code.systemCancel.rawValue)
        c.expectEqual(OwnerAuthContract.appCancel, LAError.Code.appCancel.rawValue)
        c.expectEqual(OwnerAuthContract.authenticationFailed, LAError.Code.authenticationFailed.rawValue)
        c.expectEqual(OwnerAuthContract.passcodeNotSet, LAError.Code.passcodeNotSet.rawValue)
        c.expectEqual(OwnerAuthContract.notInteractive, LAError.Code.notInteractive.rawValue)
        c.expectEqual(OwnerAuthContract.biometryNotAvailable, LAError.Code.biometryNotAvailable.rawValue)
        c.expectEqual(OwnerAuthContract.biometryNotEnrolled, LAError.Code.biometryNotEnrolled.rawValue)
        c.expectEqual(OwnerAuthContract.biometryLockout, LAError.Code.biometryLockout.rawValue)
        for code in [LAError.Code.userCancel, .systemCancel, .appCancel, .userFallback] {
            c.expectEqual(OwnerAuthContract.outcome(forErrorCode: code.rawValue), .cancelled)
        }
        for code in [LAError.Code.passcodeNotSet, .notInteractive] {
            if case .unavailable = OwnerAuthContract.outcome(forErrorCode: code.rawValue) {} else { c.fail("\(code) should be unavailable") }
        }
        for code in [LAError.Code.authenticationFailed.rawValue, -9999] {
            if case .failed = OwnerAuthContract.outcome(forErrorCode: code) {} else { c.fail("\(code) should be failed") }
        }
    },
    Check("owner auth helper: success only when macOS evaluated the owner; a Mac that cannot ask is unavailable") { c in
        c.expectEqual(runOwnerAuth(reason: "r", with: ScriptedAuthenticator(probe: nil, answer: nil)), .authenticated)
        c.expectEqual(runOwnerAuth(reason: "r", with: ScriptedAuthenticator(probe: nil, answer: LAError.Code.userCancel.rawValue)), .cancelled)
        if case .failed = runOwnerAuth(reason: "r", with: ScriptedAuthenticator(probe: nil, answer: LAError.Code.authenticationFailed.rawValue)) {} else { c.fail("a wrong password is failed") }
        for probe in [LAError.Code.passcodeNotSet.rawValue, LAError.Code.userCancel.rawValue, -42] {
            if case .unavailable = runOwnerAuth(reason: "r", with: ScriptedAuthenticator(probe: probe, answer: nil)) {} else { c.fail("probe \(probe) is unavailable") }
        }
    },
]
