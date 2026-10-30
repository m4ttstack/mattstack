import Foundation
import MattstackCore

final class FakePasteboard: PasteboardReading, @unchecked Sendable {
    private let value: String?
    private(set) var reads = 0
    init(_ value: String?) { self.value = value }
    func inviteText() -> String? { reads += 1; return value }
}

let completeInviteCode = "01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567-89ABC-DEFGH-JKMNP-QRSTV-WXYZ0-12345-6789A-BC"

private let restoredReply = #"{"contract":1,"at":"2026-01-01T00:00:00.000Z","ok":true,"repo":"janedoe/mattstack-home","url":"https://github.com/janedoe/mattstack-home.git","key":"imported"}"#

let teamChoiceChecks: [Check] = [
    Check("Paste invite fills the field from a copied deep link") { c in
        let pb = FakePasteboard("mattstack://join/01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567-89ABC-DEFGH-JKMNP-QRSTV-WXYZ0-12345-6789A-BC")
        let m = await MainActor.run { TeamChoiceModel(rt: ScriptedRt(), pasteboard: pb) }
        await MainActor.run { m.pasteInvite() }
        c.expect(await MainActor.run { !m.inviteCode.isEmpty })
        c.expectEqual(pb.reads, 1)
    },
    Check("nothing reads the pasteboard without a click") { c in
        let pb = FakePasteboard("mattstack://join/01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567-89ABC-DEFGH-JKMNP-QRSTV-WXYZ0-12345-6789A-BC")
        let m = await MainActor.run { TeamChoiceModel(rt: ScriptedRt(), pasteboard: pb) }
        await MainActor.run { m.choice = .join }
        _ = await m.validateAndPrepare()
        c.expectEqual(pb.reads, 0)
    },
    Check("a denied alert reads as nil and leaves whatever was typed alone") { c in
        let m = await MainActor.run { TeamChoiceModel(rt: ScriptedRt(), pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.inviteCode = "typed-so-far"; m.pasteInvite() }
        c.expectEqual(await MainActor.run { m.inviteCode }, "typed-so-far")
    },
    Check("a clipboard holding something else leaves the field alone") { c in
        let m = await MainActor.run { TeamChoiceModel(rt: ScriptedRt(), pasteboard: FakePasteboard("https://example.com/")) }
        await MainActor.run { m.pasteInvite() }
        c.expectEqual(await MainActor.run { m.inviteCode }, "")
    },

    Check("Slug.make") { c in
        c.expectEqual(Slug.make("Acme Claims!"), "acme-claims")
        c.expectEqual(Slug.make("  My  Team -- 2 "), "my-team-2")
        c.expectEqual(Slug.make(""), "")
    },
    Check("create: slug preview, gh owner picker from github status, canContinue needs name + remote") { c in
        let rt = ScriptedRt()
        rt.answers["setup github status"] = (0, #"{"contract":1,"status":"ready","handle":"m4ttheweric","owners":["m4ttheweric","acme"]}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await m.loadGitHubStatus()
        await MainActor.run {
            c.expectEqual(m.ghHandle, "m4ttheweric")
            c.expectEqual(m.ghOwners, ["m4ttheweric", "acme"])
            c.expectEqual(m.useGhRepo, true)
            c.expectEqual(m.ghOwner, "m4ttheweric")
            c.expectEqual(m.canContinue, false)
            m.teamName = "Acme Claims"
            c.expectEqual(m.slugPreview, "acme-claims")
            c.expectEqual(m.ghRepoPreview, "m4ttheweric/mattstack-team-acme-claims")
            c.expectEqual(m.canContinue, true)
            m.useGhRepo = false
            c.expectEqual(m.canContinue, false, "URL field now required")
            m.remoteURL = "git@gitlab.example.com:tools/mattstack-team.git"
            c.expectEqual(m.canContinue, true)
        }
    },
    Check("create: a ready GitHub token with no gh session keeps the repository URL field") { c in
        let rt = ScriptedRt()
        rt.answers["setup github status"] = (0, #"{"contract":1,"integration":"github","status":"ready","detail":"GitHub token works","scopesSeen":["repo"]}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await m.loadGitHubStatus()
        await MainActor.run {
            c.expectEqual(m.ghHandle, nil)
            c.expectEqual(m.useGhRepo, false, "no handle means no GitHub repo toggle, so the URL field must stay")
            m.teamName = "Acme Claims"
            m.remoteURL = "https://example.com/t.git"
            c.expectEqual(m.canContinue, true)
        }
    },
    Check("create: validateAndPrepare calls home init --dry-run then team create, never with secrets on argv") { c in
        let rt = ScriptedRt()
        rt.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        rt.answers["team create"] = (0, #"{"contract":1,"team":{"slug":"acme-claims","name":"Acme Claims"},"remote":"ok"}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .create; m.teamName = "Acme Claims"; m.useGhRepo = false; m.remoteURL = "https://example.com/t.git" }
        let err = await m.validateAndPrepare()
        c.expect(err == nil, "got \(err ?? "")")
        try c.require(rt.calls.count >= 2, "expected home init --dry-run then team create, got \(rt.calls.map(\.args))")
        c.expectEqual(rt.calls[0].args.prefix(3), ["home", "init", "--dry-run"])
        c.expectEqual(rt.calls[1].args, ["team", "create", "Acme Claims", "--remote", "https://example.com/t.git", "--others", "--json"])
        let gh = ScriptedRt()
        gh.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        gh.answers["team create"] = (0, #"{"contract":1,"team":{"slug":"acme-claims","name":"Acme Claims"},"remote":"ok"}"#)
        let m2 = await MainActor.run { TeamChoiceModel(rt: gh, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m2.choice = .create; m2.teamName = "Acme Claims"; m2.useGhRepo = true; m2.ghOwner = "acme"; m2.othersWillJoin = false }
        c.expect(await m2.validateAndPrepare() == nil)
        try c.require(gh.calls.count >= 2, "expected home init --dry-run then team create, got \(gh.calls.map(\.args))")
        c.expectEqual(gh.calls[1].args, ["team", "create", "Acme Claims", "--create-repo", "acme", "--json"])
    },
    Check("create: loadGitHubStatus only queries rt once — a second call after Back doesn't clobber the user's edits") { c in
        let rt = ScriptedRt()
        rt.answers["setup github status"] = (0, #"{"contract":1,"status":"ready","handle":"m4ttheweric","owners":["m4ttheweric","acme"]}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await m.loadGitHubStatus()
        await MainActor.run {
            c.expectEqual(m.useGhRepo, true)
            m.useGhRepo = false
            m.remoteURL = "git@gitlab.example.com:tools/mattstack-team.git"
        }
        await m.loadGitHubStatus()
        await MainActor.run {
            c.expectEqual(m.useGhRepo, false, "a second load must not re-overwrite the user's choice")
            c.expectEqual(m.remoteURL, "git@gitlab.example.com:tools/mattstack-team.git")
        }
        c.expectEqual(rt.calls.filter { $0.args.prefix(3) == ["setup", "github", "status"] }.count, 1)
    },
    Check("create: validateAndPrepare is idempotent for unchanged inputs; a changed field re-runs it") { c in
        let rt = ScriptedRt()
        rt.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        rt.answers["team create"] = (0, #"{"contract":1,"team":{"slug":"acme-claims","name":"Acme Claims"},"remote":"ok"}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .create; m.teamName = "Acme Claims"; m.useGhRepo = false; m.remoteURL = "https://example.com/t.git" }
        c.expect(await m.validateAndPrepare() == nil)
        c.expect(await m.validateAndPrepare() == nil, "repeat call with unchanged inputs must still report success")
        c.expectEqual(rt.calls.filter { $0.args.prefix(2) == ["team", "create"] }.count, 1, "unchanged inputs must not re-run team create")
        await MainActor.run { m.teamName = "Acme Claims 2" }
        c.expect(await m.validateAndPrepare() == nil)
        c.expectEqual(rt.calls.filter { $0.args.prefix(2) == ["team", "create"] }.count, 2, "a changed field must re-run team create")
    },
    Check("join: code goes on stdin; success summary; failure copy is specific") { c in
        let rt = ScriptedRt()
        rt.answers["team join --dry-run"] = (0, #"{"contract":1,"team":{"slug":"acme","name":"Acme","owner":"matt"},"access":"ok","peering":"idle","message":"Joining Acme (owner matt)"}"#)
        rt.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .join; m.inviteCode = "ABCD-EFGH" }
        let err = await m.validateAndPrepare()
        c.expect(err == nil)
        try c.require(!rt.calls.isEmpty, "expected a team join --dry-run call")
        c.expectEqual(rt.calls[0].args, ["team", "join", "--dry-run", "--json"])
        c.expectEqual(rt.calls[0].stdin, "{\"code\":\"ABCD-EFGH\"}")
        c.expect(rt.calls.allSatisfy { !$0.args.contains("ABCD-EFGH") }, "code never on argv")
        await MainActor.run { c.expectEqual(m.joinSummary, "Joining Acme (owner matt)") }
        let denied = ScriptedRt()
        denied.answers["team join --dry-run"] = (0, #"{"contract":1,"team":{"slug":"acme","name":"Acme","owner":"matt"},"access":"denied","peering":"idle","message":"You don't have access yet: ask matt to grant you access to Acme."}"#)
        let m2 = await MainActor.run { TeamChoiceModel(rt: denied, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m2.choice = .join; m2.inviteCode = "X" }
        let e2 = await m2.validateAndPrepare()
        c.expectEqual(e2, "You don't have access yet: ask matt to grant you access to Acme.", "access != ok comes back as an exit-0 result, not a user error")
        let unknown = ScriptedRt()
        unknown.answers["team join --dry-run"] = (2, #"{"contract":1,"error":{"code":"invite-unknown","message":""}}"#)
        let m3 = await MainActor.run { TeamChoiceModel(rt: unknown, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m3.choice = .join; m3.inviteCode = "X" }
        c.expectEqual(await m3.validateAndPrepare(), "Invite not recognized or expired: ask the team owner for a new one.")
        c.expectEqual(TeamChoiceModel.joinFailureCopy(RtUserError(code: "expired", message: ""), owner: "matt", team: nil),
                      "Invite not recognized or expired: ask matt for a new one.")
        c.expectEqual(TeamChoiceModel.joinFailureCopy(RtUserError(code: "wrong-account", message: ""), owner: nil, team: nil),
                      "This code is for a different forge account than you're signed into.")
    },
    Check("join: invite field accepts pasted codes with whitespace/newlines; ~77 chars; no per-char validation") { c in
        let m = await MainActor.run { TeamChoiceModel(rt: ScriptedRt(), pasteboard: FakePasteboard(nil)) }
        await MainActor.run {
            m.choice = .join
            m.inviteCode = " ABCD-EFGH-\nIJKL "
            c.expectEqual(m.normalizedInviteCode, "ABCD-EFGH-IJKL")
            c.expectEqual(m.canContinue, true)
            m.inviteCode = "   "
            c.expectEqual(m.canContinue, false)
            c.expectEqual(TeamChoiceModel.inviteCodeLength, 77)
        }
    },
    Check("restore: repo + key required; rt home restore runs once with the key as plain stdin and records the intent itself") { c in
        let rt = ScriptedRt()
        rt.answers["home restore"] = (0, restoredReply)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .restore; m.restoreRepo = "janedoe/mattstack-home"; c.expectEqual(m.canContinue, false); m.restoreAgeKey = " AGE-SECRET-KEY-1PLACEHOLDER\n"; c.expectEqual(m.canContinue, true) }
        let err = await m.validateAndPrepare()
        c.expect(err == nil)
        c.expectEqual(rt.calls.map(\.args), [["home", "restore", "janedoe/mattstack-home", "--stdin", "--json"]])
        c.expectEqual(rt.calls.first?.stdin, "AGE-SECRET-KEY-1PLACEHOLDER")
        c.expect(rt.calls.allSatisfy { !$0.args.joined().contains("AGE-SECRET-KEY") }, "key never on argv")
    },
    Check("restore: rt's refusal shows its own words, and a failure with no envelope withholds stderr") { c in
        let refused = ScriptedRt()
        refused.answers["home restore"] = (2, #"{"contract":1,"error":{"code":"other-key","message":"This Mac already has a different recovery key"}}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: refused, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .restore; m.restoreRepo = "janedoe/mattstack-home"; m.restoreAgeKey = "AGE-SECRET-KEY-1PLACEHOLDER" }
        c.expectEqual(await m.validateAndPrepare(), "This Mac already has a different recovery key")
        await MainActor.run { c.expectEqual(m.restoreAgeKey, "AGE-SECRET-KEY-1PLACEHOLDER", "a failed restore keeps the key for Retry") }

        let crashed = ScriptedRt()
        crashed.answers["home restore"] = (1, "")
        let n = await MainActor.run { TeamChoiceModel(rt: crashed, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { n.choice = .restore; n.restoreRepo = "janedoe/mattstack-home"; n.restoreAgeKey = "AGE-SECRET-KEY-1PLACEHOLDER" }
        c.expectEqual(await n.validateAndPrepare(), "rt home restore failed (exit 1); details withheld because the command carried a secret.")
    },
    Check("TeamChoice: a restore repo pasted with a newline is trimmed the way Restore's button trims it") { c in
        let rt = ScriptedRt()
        rt.answers["home restore"] = (0, restoredReply)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .restore; m.restoreRepo = "janedoe/mattstack-home\n"; m.restoreAgeKey = "placeholder" }
        c.expect(await m.validateAndPrepare() == nil)
        c.expectEqual(rt.calls.first?.args, ["home", "restore", "janedoe/mattstack-home", "--stdin", "--json"])
        await MainActor.run { c.expect(m.canContinue, "the restored repo matches however it was pasted") }
    },
    Check("a finished restore survives Back→Continue: the wiped key doesn't disable Continue and doesn't re-run the real restore") { c in
        let rt = ScriptedRt()
        rt.answers["home restore"] = (0, restoredReply)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .restore; m.restoreRepo = "janedoe/mattstack-home"; m.restoreAgeKey = "AGE-SECRET-KEY-1PLACEHOLDER" }
        c.expect(await m.validateAndPrepare() == nil)
        let afterFirst = rt.calls.count
        await MainActor.run {
            c.expectEqual(m.restoreAgeKey, "", "the key is wiped once the restore lands")
            c.expectEqual(m.canContinue, true, "Back→Continue must stay live for a repo already restored")
        }
        c.expect(await m.validateAndPrepare() == nil, "Continue again is a no-op, not a failure")
        c.expectEqual(rt.calls.count, afterFirst, "the real restore must not run a second time")
        // A different repo is a different restore: it needs its own key again.
        await MainActor.run {
            m.restoreRepo = "janedoe/other-home"
            c.expectEqual(m.canContinue, false)
        }
    },
    Check("normalizedInviteCode accepts bare codes, deep links, and URLs; leaves other inputs for the CLI") { c in
        let m = await MainActor.run { TeamChoiceModel(rt: ScriptedRt(), pasteboard: FakePasteboard(nil)) }
        await MainActor.run {
            m.inviteCode = "mattstack://join/01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567-89ABC-DEFGH-JKMNP-QRSTV-WXYZ0-12345-6789A-BC"
            c.expectEqual(m.normalizedInviteCode, "0123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABCDEFGHJKMNPQRSTVWXYZ0123456789ABC")
            m.inviteCode = "nope"
            c.expectEqual(m.normalizedInviteCode, "nope")
        }
    },

    Check("a denial warns and lets Continue through; the checklist holds the line") { c in
        let rt = ScriptedRt(); rt.answers["team join --dry-run --json"] = (0, #"{"contract":1,"team":{"slug":"acme","name":"Acme","owner":"matt"},"access":"denied","intent":"written","message":"Joining Acme. Your GitHub account cannot see acme/team yet: ask matt or your org admin to grant read access."}"#)
        rt.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .join; m.inviteCode = "ABCD-EFGH" }
        let err = await m.validateAndPrepare()
        c.expectEqual(err, nil)
        c.expect(await MainActor.run { m.joinWarning?.contains("ask matt") == true })
        c.expectEqual(await MainActor.run { m.joinSummary }, nil, "a denial must never also render as the green summary")
    },

    Check("a complete code is checked before Continue, so the join note is readable on the card") { c in
        let rt = ScriptedRt()
        rt.answers["team join --dry-run --json"] = (0, #"{"contract":1,"team":{"slug":"acme","name":"Acme","owner":"matt"},"access":"no-account","intent":"written","message":"Joining Acme (owner matt). Connect your GitLab account on the next screen so rt can reach gitlab.com/acme/team."}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .join; m.inviteCode = completeInviteCode }
        await m.previewInvite()
        c.expectEqual(await MainActor.run { m.joinWarning }, "Joining Acme (owner matt). Connect your GitLab account on the next screen so rt can reach gitlab.com/acme/team.")
        c.expectEqual(rt.calls.map(\.args), [["team", "join", "--dry-run", "--json"]], "the preview is the dry run alone; home init waits for Continue")
        await m.previewInvite()
        c.expectEqual(rt.calls.count, 1, "an unchanged code is not checked again")
    },

    Check("a partial code is never checked early") { c in
        let rt = ScriptedRt()
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .join; m.inviteCode = "ABCD-EFGH" }
        await m.previewInvite()
        c.expectEqual(rt.calls.count, 0)
        c.expectEqual(await MainActor.run { m.joinWarning }, nil)
    },

    Check("an early check that fails says so on the card, and Continue moves it to the screen error") { c in
        let rt = ScriptedRt(); rt.answers["team join --dry-run"] = (2, #"{"contract":1,"error":{"code":"invite-unknown","message":""}}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .join; m.inviteCode = completeInviteCode }
        await m.previewInvite()
        c.expectEqual(await MainActor.run { m.joinError }, "Invite not recognized or expired: ask the team owner for a new one.")
        c.expect(await m.validateAndPrepare() != nil)
        c.expectEqual(await MainActor.run { m.joinError }, nil, "one failure, one place")
    },

    Check("Continue after an early check keeps the note up while it re-checks") { c in
        let rt = ScriptedRt()
        rt.answers["team join --dry-run --json"] = (0, #"{"contract":1,"team":{"slug":"acme","name":"Acme","owner":"matt"},"access":"no-account","intent":"written","message":"Connect your GitLab account on the next screen."}"#)
        rt.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .join; m.inviteCode = completeInviteCode }
        await m.previewInvite()
        c.expectEqual(await m.validateAndPrepare(), nil)
        c.expectEqual(await MainActor.run { m.joinWarning }, "Connect your GitLab account on the next screen.")
        c.expectEqual(rt.calls.filter { $0.args.starts(with: ["team", "join"]) }.count, 2, "Continue still re-checks access")
    },

    Check("a code edited while Continue checks it never slips through unchecked") { c in
        let rt = ScriptedRt()
        rt.answers["team join --dry-run --json"] = (0, #"{"contract":1,"team":{"slug":"acme","name":"Acme","owner":"matt"},"access":"ok","intent":"written","message":"Joining Acme (owner matt)"}"#)
        rt.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .join; m.inviteCode = "ABCD-EFGH" }
        rt.duringNextRun = { await MainActor.run { m.inviteCode = "WXYZ-1234" } }
        c.expectEqual(await m.validateAndPrepare(), "The invite code changed; press Continue again.")
    },

    Check("editing a checked code clears its verdict, even before the new code is complete") { c in
        let rt = ScriptedRt()
        rt.answers["team join --dry-run --json"] = (0, #"{"contract":1,"team":{"slug":"acme","name":"Acme","owner":"matt"},"access":"no-account","intent":"written","message":"Connect your GitLab account on the next screen."}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .join; m.inviteCode = completeInviteCode }
        await m.previewInvite()
        c.expect(await MainActor.run { m.joinWarning != nil })
        await MainActor.run { m.inviteCode = "01234-56789" }
        await m.previewInvite()
        c.expectEqual(await MainActor.run { m.joinWarning }, nil)
        await MainActor.run { m.inviteCode = completeInviteCode }
        await m.previewInvite()
        c.expectEqual(rt.calls.count, 2, "a code edited away and back is checked again")
    },

    Check("Continue during an early check owns the result: the early check writes no error and leaves isChecking alone") { c in
        let rt = ScriptedRt(); rt.answers["team join --dry-run"] = (2, #"{"contract":1,"error":{"code":"invite-unknown","message":""}}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .join; m.inviteCode = completeInviteCode }
        var continued: String?
        rt.duringNextRun = { continued = await m.validateAndPrepare() }
        await m.previewInvite()
        c.expect(continued != nil, "Continue reports the failure itself")
        c.expectEqual(await MainActor.run { m.joinError }, nil, "one failure, one place")
        c.expectEqual(await MainActor.run { m.isChecking }, false)
    },

    Check("a second attempt renders only its own verdict") { c in
        let rt = ScriptedRt()
        rt.answers["team join --dry-run --json"] = (0, #"{"contract":1,"team":{"slug":"acme","name":"Acme","owner":"matt"},"access":"denied","intent":"written","message":"ask matt or your org admin to grant read access"}"#)
        rt.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .join; m.inviteCode = "ABCD-EFGH" }
        c.expectEqual(await m.validateAndPrepare(), nil)
        c.expect(await MainActor.run { m.joinWarning != nil })
        rt.answers["team join --dry-run --json"] = (0, #"{"contract":1,"team":{"slug":"acme","name":"Acme","owner":"matt"},"access":"ok","intent":"written","message":"Joining Acme (owner matt)"}"#)
        await MainActor.run { m.inviteCode = "WXYZ-1234" }
        c.expectEqual(await m.validateAndPrepare(), nil)
        c.expectEqual(await MainActor.run { m.joinWarning }, nil, "the first code's warning must not survive the second attempt")
        c.expectEqual(await MainActor.run { m.joinSummary }, "Joining Acme (owner matt)")
    },

    Check("an access value this build does not know still lets Continue through") { c in
        let rt = ScriptedRt(); rt.answers["team join --dry-run --json"] = (0, #"{"contract":1,"team":{"slug":"acme","name":"Acme","owner":"matt"},"access":"something-new","intent":"written","message":"Joining Acme."}"#)
        rt.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .join; m.inviteCode = "ABCD-EFGH" }
        c.expectEqual(await m.validateAndPrepare(), nil)
    },

    Check("no intent written still blocks") { c in
        let rt = ScriptedRt(); rt.answers["team join --dry-run --json"] = (0, #"{"contract":1,"access":"unreachable","intent":"not-written","message":"could not reach the invite relay"}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .join; m.inviteCode = "ABCD-EFGH" }
        c.expect(await m.validateAndPrepare() != nil)
    },

    Check("an older CLI with no intent field keeps the old rule") { c in
        let rt = ScriptedRt(); rt.answers["team join --dry-run --json"] = (0, #"{"contract":1,"team":{"slug":"acme","name":"Acme","owner":"matt"},"access":"denied","message":"no access"}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .join; m.inviteCode = "ABCD-EFGH" }
        c.expect(await m.validateAndPrepare() != nil)
    },
    Check("solo: Continue needs no fields, prepare runs home init then setup intent solo, and latches") { c in
        let rt = ScriptedRt()
        rt.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        rt.answers["setup intent solo"] = (0, #"{"contract":1,"mode":"solo"}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .solo }
        c.expectEqual(await MainActor.run { m.canContinue }, true)
        let err = await m.validateAndPrepare()
        c.expect(err == nil, "got \(err ?? "")")
        try c.require(rt.calls.count == 2, "expected home init then setup intent solo, got \(rt.calls.map(\.args))")
        c.expectEqual(rt.calls[0].args.prefix(3), ["home", "init", "--dry-run"])
        c.expectEqual(rt.calls[1].args, ["setup", "intent", "solo", "--json"])
        _ = await m.validateAndPrepare()
        c.expectEqual(rt.calls.count, 2, "an unchanged Back then Continue must not re-run the verbs")
    },
    Check("solo: a failed setup intent solo surfaces rt's message") { c in
        let rt = ScriptedRt()
        rt.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        rt.answers["setup intent solo"] = (2, #"{"contract":1,"error":{"code":"bad-args","message":"cannot record intent"}}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .solo }
        c.expectEqual(await m.validateAndPrepare(), "cannot record intent")
    },
    Check("entering setup picks the requested choice: Create selects create, Join selects join, a join code wins, and an upgrade never lands on Just me") { c in
        let m = await MainActor.run { TeamChoiceModel(rt: ScriptedRt(), pasteboard: FakePasteboard(nil)) }
        await MainActor.run {
            m.choice = .solo
            m.enter(.upgrade, choice: .join, joinCode: nil)
            c.expectEqual(m.choice, .join, "Join a team with no pending code opens on join")
            m.enter(.upgrade, choice: .create, joinCode: nil)
            c.expectEqual(m.choice, .create)
            m.choice = .solo
            m.enter(.upgrade, choice: nil, joinCode: nil)
            c.expectEqual(m.choice, .create, "an upgrade with no stated choice leaves Just me")
            m.enter(.upgrade, choice: .join, joinCode: "CODE")
            c.expectEqual(m.choice, .join)
            c.expectEqual(m.inviteCode, "CODE")
            m.choice = .solo
            m.enter(.firstRun, choice: nil, joinCode: nil)
            c.expectEqual(m.choice, .solo, "a first run keeps what the person picked")
        }
    },
    Check("DoneRole reads the plan over the choice model, which a Full Disk Access relaunch resets to .create") { c in
        let soloPlanTeam = TeamInfo(slug: "", name: nil, mode: .noTeam)
        c.expectEqual(DoneRole.solo(planTeam: soloPlanTeam, choice: .create), true, "relaunch case: choice model reset to .create, plan still says solo")
        c.expectEqual(DoneRole.owner(planTeam: soloPlanTeam, choice: .create), false)
        let createdPlanTeam = TeamInfo(slug: "acme", name: "Acme", mode: .create)
        c.expectEqual(DoneRole.owner(planTeam: createdPlanTeam, choice: .solo), true)
        c.expectEqual(DoneRole.solo(planTeam: createdPlanTeam, choice: .solo), false)
        c.expectEqual(DoneRole.solo(planTeam: nil, choice: .solo), true, "no plan team yet: fall back to the choice")
        c.expectEqual(DoneRole.owner(planTeam: nil, choice: .create), true)
        c.expectEqual(DoneRole.solo(planTeam: nil, choice: .create), false)
        c.expectEqual(DoneRole.owner(planTeam: nil, choice: .join), false)
    },
    Check("TeamChoice: a good preview reads Mithrandir, invited by Jane Doe") { c in
        let rt = ScriptedRt()
        rt.answers["team join --dry-run --json"] = (0, #"{"contract":1,"team":{"slug":"mithrandir","name":"Mithrandir","owner":"Jane Doe"},"access":"no-account","intent":"written","message":"Joining Mithrandir (owner Jane Doe). Connect your GitLab account on the next screen."}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { m.choice = .join }
        c.expectEqual(await MainActor.run { m.inviteLine }, nil, "nothing read yet")
        c.expect(await MainActor.run { !m.hasGoodVerdict })
        await MainActor.run { m.inviteCode = completeInviteCode }
        await m.previewInvite()
        c.expectEqual(await MainActor.run { m.inviteLine }, "Mithrandir, invited by Jane Doe", "a token still to connect is a good read")
        c.expect(await MainActor.run { m.hasGoodVerdict })
        await MainActor.run { m.inviteCode = "ABCD" }
        await m.previewInvite()
        c.expectEqual(await MainActor.run { m.inviteLine }, nil, "an edited code drops the old team's line")
        c.expect(await MainActor.run { !m.hasGoodVerdict }, "an edited code needs a new read")

        let deferred = ScriptedRt()
        deferred.answers["team join --dry-run --json"] = (0, #"{"contract":1,"team":{"slug":"mithrandir","name":"Mithrandir","owner":""},"access":"deferred","intent":"written","message":"rt could not confirm access yet."}"#)
        let unnamed = await MainActor.run { TeamChoiceModel(rt: deferred, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { unnamed.choice = .join; unnamed.inviteCode = completeInviteCode }
        await unnamed.previewInvite()
        c.expectEqual(await MainActor.run { unnamed.inviteLine }, "Mithrandir", "a deferred read is good, and an empty owner leaves the team name alone")
        c.expect(await MainActor.run { unnamed.hasGoodVerdict })

        let bad = ScriptedRt(); bad.answers["team join --dry-run"] = (2, #"{"contract":1,"error":{"code":"invite-unknown","message":""}}"#)
        let failed = await MainActor.run { TeamChoiceModel(rt: bad, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { failed.choice = .join; failed.inviteCode = completeInviteCode }
        await failed.previewInvite()
        c.expectEqual(await MainActor.run { failed.inviteLine }, nil, "a failed read names no team")
        c.expect(await MainActor.run { !failed.hasGoodVerdict })
    },
    Check("TeamChoice: create on GitLab sends forge and group") { c in
        let rt = ScriptedRt()
        rt.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        rt.answers["team create"] = (0, #"{"contract":1,"team":{"slug":"widgets","name":"Widgets"},"remote":"ok"}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await MainActor.run {
            c.expectEqual(m.forge, "gitlab", "GitLab is the default")
            m.choice = .create; m.teamName = "Widgets"; m.group = " acme/platform "
        }
        c.expect(await m.validateAndPrepare() == nil)
        c.expectEqual(rt.calls.last?.args, ["team", "create", "Widgets", "--forge", "gitlab", "--group", "acme/platform", "--others", "--json"])
        await MainActor.run { m.group = "acme" }
        c.expect(await m.validateAndPrepare() == nil)
        c.expectEqual(rt.calls.filter { $0.args.prefix(2) == ["team", "create"] }.count, 2, "a changed group re-runs team create")

        let noGh = ScriptedRt()
        noGh.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        noGh.answers["team create"] = (0, #"{"contract":1,"team":{"slug":"widgets","name":"Widgets"},"remote":"ok"}"#)
        let token = await MainActor.run { TeamChoiceModel(rt: noGh, pasteboard: FakePasteboard(nil)) }
        await MainActor.run { token.choice = .create; token.teamName = "Widgets"; token.forge = "github"; token.group = "acme" }
        c.expect(await token.validateAndPrepare() == nil)
        c.expectEqual(noGh.calls.last?.args, ["team", "create", "Widgets", "--forge", "github", "--group", "acme", "--others", "--json"],
                      "GitHub without a gh sign-in creates the repo with the token")
    },
    Check("TeamChoice: create on GitHub with gh keeps create-repo") { c in
        let rt = ScriptedRt()
        rt.answers["setup github status"] = (0, #"{"contract":1,"status":"ready","handle":"janedoe","owners":["janedoe","acme"]}"#)
        rt.answers["home init --dry-run"] = (0, #"{"contract":1,"ok":true}"#)
        rt.answers["team create"] = (0, #"{"contract":1,"team":{"slug":"widgets","name":"Widgets"},"remote":"ok"}"#)
        let m = await MainActor.run { TeamChoiceModel(rt: rt, pasteboard: FakePasteboard(nil)) }
        await m.loadGitHubStatus()
        await MainActor.run { m.choice = .create; m.teamName = "Widgets"; m.forge = "github"; m.group = "acme" }
        c.expect(await m.validateAndPrepare() == nil)
        c.expectEqual(rt.calls.last?.args, ["team", "create", "Widgets", "--create-repo", "acme", "--others", "--json"])
    },
    Check("TeamChoice: Create team needs a name and a group") { c in
        let m = await MainActor.run { TeamChoiceModel(rt: ScriptedRt(), pasteboard: FakePasteboard(nil)) }
        await MainActor.run {
            c.expect(!m.canCreateTeam, "nothing typed")
            m.teamName = "Widgets"
            c.expect(!m.canCreateTeam, "no group")
            m.group = "   "
            c.expect(!m.canCreateTeam, "a blank group is no group")
            m.group = "acme"
            c.expect(m.canCreateTeam)
            m.teamName = "!!"
            c.expect(!m.canCreateTeam, "a name with no letters makes no slug")
        }
        let done = [FormRow(id: "forge.token", title: "GitLab", subtext: "", state: .done, detail: "Connected")]
        c.expect(FastSetupFlow.createEnabled(nameAndGroup: true, rows: done))
        c.expect(!FastSetupFlow.createEnabled(nameAndGroup: false, rows: done), "the name and group hold Create team")
        c.expect(!FastSetupFlow.createEnabled(nameAndGroup: true, rows: nil), "an unread create section holds Create team")
        c.expect(FastSetupFlow.createEnabled(nameAndGroup: true, rows: []), "gh signed in and git present: nothing to wait on")
    },
]
