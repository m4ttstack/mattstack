import Foundation
import MattstackCore

/// One broker per model, over the same fakes TrayRoutesChecks uses: the
/// uninstall stream's `need` events are performed on it.
@MainActor
private func makeTeamSettings(_ rt: RtRunning, services: FakeServices = FakeServices(),
                              privileged: FakePrivileged = FakePrivileged()) -> (TeamSettingsModel, NeedBroker) {
    let broker = NeedBroker(services: services, privileged: privileged)
    return (TeamSettingsModel(rt: rt, needs: broker), broker)
}

@MainActor
private final class HookCounter { var count = 0 }

/// Holds the first caller of `arrive()` until `release()`, so a check can
/// look at a model while its rt verb is still running.
private actor AsyncGate {
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

    func release() {
        held?.resume()
        held = nil
    }
}

/// `apps list` always answers board off; the first enable/disable waits on
/// `gate` (consumed, so a second flip never blocks) and every flip is counted.
private final class GatedRt: RtRunning, @unchecked Sendable {
    var gate: AsyncGate?
    var flips = 0
    var throwOnFlip = false

    func run(_ args: [String], stdin: Data?) async throws -> RtResult {
        if args.starts(with: ["apps", "list"]) {
            return RtResult(exitCode: 0, stdout: Data(#"{"contract":1,"apps":[{"name":"board","displayName":"Board","enabled":false,"requiresTeam":true}]}"#.utf8), stderr: Data())
        }
        flips += 1
        if throwOnFlip { throw RtClientError.spawnFailed("no rt") }
        let g = gate
        gate = nil
        if let g { await g.arrive() }
        return RtResult(exitCode: 0, stdout: Data(#"{"contract":1,"name":"board","enabled":true}"#.utf8), stderr: Data())
    }

    func stream(_ args: [String], stdin: Data?) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { $0.finish() }
    }
}

private actor GatedTeamRt: RtRunning {
    struct Call: Sendable { let args: [String]; let stdin: Data? }
    let mutationGate: AsyncGate
    let reloadGate: AsyncGate
    private(set) var calls: [Call] = []
    private var mutations = 0
    private var statuses = 0

    init(mutationGate: AsyncGate, reloadGate: AsyncGate) {
        self.mutationGate = mutationGate
        self.reloadGate = reloadGate
    }

    func run(_ args: [String], stdin: Data?) async throws -> RtResult {
        calls.append(Call(args: args, stdin: stdin))
        let json: String
        if args.starts(with: ["team", "use"]) {
            mutations += 1
            guard mutations == 1 else { return RtResult(exitCode: 1, stdout: Data(), stderr: Data()) }
            await mutationGate.arrive()
            json = #"{"contract":1,"team":"gadgets"}"#
        } else {
            statuses += 1
            if statuses == 2 { await reloadGate.arrive() }
            json = statuses == 1
                ? #"{"contract":1,"activeTeam":"widgets","teams":["widgets","gadgets"]}"#
                : #"{"contract":1,"activeTeam":"gadgets","teams":["widgets","gadgets"]}"#
        }
        return RtResult(exitCode: 0, stdout: Data(json.utf8), stderr: Data())
    }

    nonisolated func stream(_ args: [String], stdin: Data?) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { $0.finish() }
    }
}

let settingsChecks: [Check] = [
    Check("team switch ignores another selection during the mutation and status reload") { c in
        let mutation = AsyncGate(), reload = AsyncGate()
        let rt = GatedTeamRt(mutationGate: mutation, reloadGate: reload)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        let first = Task { await m.useTeam("gadgets") }
        await mutation.waitForArrival()
        c.expect(await MainActor.run { m.isSwitchingTeam })
        await m.useTeam("widgets")
        c.expectEqual(await rt.calls.map(\.args), [["team", "status", "--json"], ["team", "use", "gadgets", "--json"]])
        await mutation.release()
        await reload.waitForArrival()
        c.expect(await MainActor.run { m.isSwitchingTeam })
        await m.useTeam("widgets")
        c.expectEqual(await rt.calls.map(\.args), [["team", "status", "--json"], ["team", "use", "gadgets", "--json"], ["team", "status", "--json"]])
        await reload.release()
        await first.value
        c.expect(await MainActor.run { !m.isSwitchingTeam })
        c.expectEqual(await MainActor.run { m.info?.activeTeam }, "gadgets")
        await m.useTeam("widgets")
        c.expectEqual(await rt.calls.map(\.args), [["team", "status", "--json"], ["team", "use", "gadgets", "--json"], ["team", "status", "--json"], ["team", "use", "widgets", "--json"]])
        c.expect(await rt.calls.allSatisfy { $0.stdin == nil })
    },
    Check("team switch releases its busy state after nonzero, malformed and reload failures so you can retry") { c in
        for answer in [(Int32(1), ""), (Int32(0), "not json"), (Int32(0), #"{"contract":1}"#), (Int32(0), #"{"contract":1,"team":"gadgets"}"#)] {
            let rt = ScriptedRt()
            rt.answers["team status"] = (0, #"{"contract":1,"activeTeam":"widgets"}"#)
            rt.answers["team use"] = answer
            let m = await MainActor.run { makeTeamSettings(rt).0 }
            await m.load()
            rt.answers["team status"] = (1, "")
            await m.useTeam("gadgets")
            await MainActor.run {
                c.expect(!m.isSwitchingTeam)
                c.expect(m.error != nil)
                c.expectEqual(m.info?.activeTeam, "widgets")
            }
            rt.answers["team use"] = (0, #"{"contract":1,"team":"gadgets"}"#)
            rt.answers["team status"] = (0, #"{"contract":1,"activeTeam":"gadgets"}"#)
            await m.useTeam("gadgets")
            await MainActor.run {
                c.expect(!m.isSwitchingTeam)
                c.expectEqual(m.error, nil)
                c.expectEqual(m.info?.activeTeam, "gadgets")
            }
            c.expect(rt.calls.allSatisfy { $0.stdin == nil })
        }
    },
    Check("team switch reloads a partial pack outcome and keeps nonfatal guidance until a successful retry") { c in
        for installed in [false, true] {
            for retryPack in [#", "pack":{"installed":true,"enabled":true,"detail":""}"#, ""] {
                let rt = ScriptedRt()
                rt.answers["team status"] = (0, #"{"contract":1,"activeTeam":"widgets"}"#)
                rt.answers["team use gadgets"] = (0, "{\"contract\":1,\"team\":\"gadgets\",\"pack\":{\"installed\":\(installed),\"enabled\":false,\"detail\":\"raw installer diagnostic\"}}")
                let m = await MainActor.run { makeTeamSettings(rt).0 }
                await m.load()
                rt.answers["team status"] = (0, #"{"contract":1,"activeTeam":"gadgets"}"#)
                await m.useTeam("gadgets")
                await MainActor.run {
                    c.expectEqual(m.info?.activeTeam, "gadgets")
                    c.expectEqual(m.error, nil)
                    c.expect(m.packNotice != nil)
                    c.expect(!(m.packNotice ?? "").contains("raw installer diagnostic"))
                    c.expect(!(m.packNotice ?? "").contains("rt setup pack"))
                    c.expect(!m.isSwitchingTeam)
                }
                c.expectEqual(rt.calls.map(\.args), [["team", "status", "--json"], ["team", "use", "gadgets", "--json"], ["team", "status", "--json"]])
                rt.answers["team use gadgets"] = (0, "{\"contract\":1,\"team\":\"gadgets\"\(retryPack)}")
                await m.useTeam("gadgets")
                await MainActor.run {
                    c.expectEqual(m.packNotice, nil)
                    c.expectEqual(m.error, nil)
                    c.expectEqual(m.info?.activeTeam, "gadgets")
                }
                c.expect(rt.calls.allSatisfy { $0.stdin == nil })
            }
        }
    },
    Check("team switch keeps partial pack guidance and the reload error when the actual team cannot be refreshed") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"activeTeam":"widgets"}"#)
        rt.answers["team use gadgets"] = (0, #"{"contract":1,"team":"gadgets","pack":{"installed":true,"enabled":false,"detail":"raw installer diagnostic"}}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        rt.answers["team status"] = (1, "")
        await m.useTeam("gadgets")
        await MainActor.run {
            c.expectEqual(m.info?.activeTeam, "widgets")
            c.expectEqual(m.error, "rt team status failed (exit 1).")
            c.expect(m.packNotice != nil)
            c.expect(!(m.packNotice ?? "").contains("changed"))
            c.expect(!m.isSwitchingTeam)
        }
        c.expectEqual(rt.calls.map(\.args), [["team", "status", "--json"], ["team", "use", "gadgets", "--json"], ["team", "status", "--json"]])
    },
    Check("TeamSettingsInfo decodes role, activeTeam and teams, and reads nil from an rt that predates them") { c in
        let new = try JSONDecoder().decode(TeamSettingsInfo.self, from: Data(#"{"contract":1,"name":"Acme","slug":"acme","remote":null,"lastPush":null,"members":[{"username":"dev1"}],"role":"admin","activeTeam":"widgets","teams":["widgets","gadgets"],"orgTeams":["gadgets","widgets"]}"#.utf8))
        c.expectEqual(new.role, "admin")
        c.expectEqual(new.activeTeam, "widgets")
        c.expectEqual(new.teams, ["widgets", "gadgets"])
        c.expectEqual(new.orgTeams, ["gadgets", "widgets"])
        let old = try JSONDecoder().decode(TeamSettingsInfo.self, from: Data(#"{"contract":1,"name":"Acme","slug":"acme","remote":null,"lastPush":null,"members":[]}"#.utf8))
        c.expectEqual(old.role, nil)
        c.expectEqual(old.activeTeam, nil)
        c.expectEqual(old.teams, nil)
        c.expectEqual(old.orgTeams, nil)
        c.expectEqual(old.myTeams, [])
        c.expect(!old.canSwitchTeam)
    },
    Check("an admin with two teams can switch and gets a team picker on invite; a member sees neither") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"name":"Acme","slug":"acme","remote":null,"lastPush":null,"members":[],"role":"admin","activeTeam":"widgets","teams":["widgets","gadgets"],"orgTeams":["gadgets","widgets"]}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        await MainActor.run {
            c.expect(m.isAdmin)
            c.expect(m.canSwitchTeam)
            c.expectEqual(m.inviteTeamChoices, ["gadgets", "widgets"])
        }
        rt.answers["team status"] = (0, #"{"contract":1,"name":"Acme","slug":"acme","remote":null,"lastPush":null,"members":[],"role":"member","activeTeam":"widgets","teams":["widgets"],"orgTeams":["gadgets","widgets"]}"#)
        await m.load()
        await MainActor.run {
            c.expect(!m.isAdmin)
            c.expect(!m.canSwitchTeam)
        }
    },
    Check("an rt that reports no role keeps the Invite section, as the app showed before") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"name":"Acme","slug":"acme","remote":null,"lastPush":null,"members":[]}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        await MainActor.run {
            c.expect(m.isAdmin)
            c.expectEqual(m.inviteTeamChoices, [])
        }
    },
    Check("useTeam runs rt team use and reloads; mintInvite passes --teams only when a team was picked") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"name":"Acme","slug":"acme","remote":null,"lastPush":null,"members":[],"role":"admin","activeTeam":"widgets","teams":["widgets","gadgets"],"orgTeams":["gadgets","widgets"]}"#)
        rt.answers["team use gadgets"] = (0, #"{"contract":1,"team":"gadgets","previous":"widgets","pack":{"installed":true,"enabled":true,"detail":""},"disabled":"widgets@acme","restarted":["board"]}"#)
        rt.answers["team invite"] = (0, #"{"contract":1,"code":"ABCD","expiresAt":"2026-10-08T00:00:00Z","pasteBlock":"x","forgeAccess":"skipped"}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        await m.useTeam("gadgets")
        try c.requireEqual(rt.calls.count, 3)
        c.expectEqual(rt.calls[1].args, ["team", "use", "gadgets", "--json"])
        c.expectEqual(rt.calls[2].args, ["team", "status", "--json"])
        await m.mintInvite(handle: "dev2", team: "gadgets")
        try c.requireEqual(rt.calls.count, 4)
        c.expectEqual(rt.calls[3].args, ["team", "invite", "--handle", "dev2", "--teams", "gadgets", "--json"])
        await m.mintInvite(handle: "dev2", team: nil)
        try c.requireEqual(rt.calls.count, 5)
        c.expectEqual(rt.calls[4].args, ["team", "invite", "--handle", "dev2", "--json"])
    },
    Check("a refused team switch shows rt's message and leaves the pane on the old team") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"name":"Acme","slug":"acme","remote":null,"lastPush":null,"members":[],"role":"member","activeTeam":"widgets","teams":["widgets","gadgets"],"orgTeams":["gadgets","widgets"]}"#)
        rt.answers["team use"] = (2, #"{"contract":1,"ok":false,"error":{"code":"not-on-team","message":"The roster does not list you on the sprockets team"}}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        await m.useTeam("sprockets")
        c.expectEqual(rt.calls.map(\.args), [["team", "status", "--json"], ["team", "use", "sprockets", "--json"]])
        await MainActor.run {
            c.expectEqual(m.error, "The roster does not list you on the sprockets team")
            c.expectEqual(m.info?.activeTeam, "widgets")
        }
    },
    Check("owner, member and unknown roles never gain Invite from forge access, and membership alone controls switching") { c in
        for role in ["owner", "member", "unknown"] {
            let json = "{\"contract\":1,\"role\":\"\(role)\",\"activeTeam\":\"widgets\",\"teams\":[\"widgets\",\"gadgets\"],\"orgTeams\":[\"gadgets\",\"widgets\"],\"forgeAccess\":\"granted\"}"
            let info = try JSONDecoder().decode(TeamSettingsInfo.self, from: Data(json.utf8))
            c.expect(!info.isAdmin, "\(role) is not an org admin")
            c.expectEqual(info.myTeams, ["widgets", "gadgets"])
            c.expect(info.canSwitchTeam, "\(role) can choose among their own teams")
            c.expectEqual(info.inviteTeamChoices, ["gadgets", "widgets"])
            let rt = ScriptedRt()
            rt.answers["team status"] = (0, json)
            let m = await MainActor.run { makeTeamSettings(rt).0 }
            await m.load()
            await MainActor.run {
                c.expect(!m.isAdmin)
                c.expect(m.canSwitchTeam)
            }
        }
    },
    Check("null status fields keep legacy defaults and a single org team needs no invite picker") { c in
        let info = try JSONDecoder().decode(TeamSettingsInfo.self, from: Data(#"{"contract":1,"role":null,"activeTeam":null,"teams":null,"orgTeams":null}"#.utf8))
        c.expect(info.isAdmin)
        c.expectEqual(info.myTeams, [])
        c.expect(!info.canSwitchTeam)
        c.expectEqual(info.inviteTeamChoices, [])
        for teams in ["[]", "[\"widgets\"]"] {
            let one = try JSONDecoder().decode(TeamSettingsInfo.self, from: Data("{\"contract\":1,\"role\":\"admin\",\"teams\":\(teams),\"orgTeams\":\(teams)}".utf8))
            c.expect(!one.canSwitchTeam)
            c.expectEqual(one.inviteTeamChoices, [])
        }
        let m = await MainActor.run { makeTeamSettings(ScriptedRt()).0 }
        await MainActor.run {
            c.expect(m.isAdmin)
            c.expect(!m.canSwitchTeam)
            c.expectEqual(m.inviteTeamChoices, [])
        }
    },
    Check("a successful switch replaces status from the reload and clears an earlier refusal") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"role":"member","activeTeam":"widgets","teams":["widgets","gadgets"]}"#)
        rt.answers["team use"] = (2, #"{"contract":1,"error":{"code":"not-on-team","message":"Choose a team that lists you"}}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        await m.useTeam("sprockets")
        c.expectEqual(await MainActor.run { m.error }, "Choose a team that lists you")
        rt.answers["team use gadgets"] = (0, #"{"contract":1,"team":"gadgets","previous":"widgets","pack":{"installed":true,"enabled":true,"detail":""},"disabled":"widgets@acme","restarted":["board","boxscore"]}"#)
        rt.answers["team status"] = (0, #"{"contract":1,"role":"owner","activeTeam":"gadgets","teams":["widgets","gadgets"],"orgTeams":["gadgets","widgets"]}"#)
        await m.useTeam("gadgets")
        await MainActor.run {
            c.expectEqual(m.error, nil)
            c.expectEqual(m.info?.activeTeam, "gadgets")
            c.expectEqual(m.info?.role, "owner")
            c.expect(!m.isAdmin)
        }
        c.expectEqual(rt.calls.map(\.args), [["team", "status", "--json"], ["team", "use", "sprockets", "--json"], ["team", "use", "gadgets", "--json"], ["team", "status", "--json"]])
        c.expect(rt.calls.allSatisfy { $0.stdin == nil })
    },
    Check("failed or malformed switches keep old status without reloading, and a failed reload surfaces its own error") { c in
        for answer in [(Int32(1), ""), (Int32(0), "not json"), (Int32(0), #"{"contract":1}"#)] {
            let rt = ScriptedRt()
            rt.answers["team status"] = (0, #"{"contract":1,"role":"member","activeTeam":"widgets"}"#)
            rt.answers["team use"] = answer
            let m = await MainActor.run { makeTeamSettings(rt).0 }
            await m.load()
            await m.useTeam("gadgets")
            await MainActor.run {
                c.expect(m.error != nil)
                c.expectEqual(m.info?.activeTeam, "widgets")
            }
            c.expectEqual(rt.calls.map(\.args), [["team", "status", "--json"], ["team", "use", "gadgets", "--json"]])
        }
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"activeTeam":"widgets"}"#)
        rt.answers["team use gadgets"] = (0, #"{"contract":1,"team":"gadgets"}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        rt.answers["team status"] = (1, "")
        await m.useTeam("gadgets")
        await MainActor.run {
            c.expectEqual(m.error, "rt team status failed (exit 1).")
            c.expectEqual(m.info?.activeTeam, "widgets")
        }
        c.expectEqual(rt.calls.map(\.args), [["team", "status", "--json"], ["team", "use", "gadgets", "--json"], ["team", "status", "--json"]])
    },
    Check("a failed invite preserves its previous result and rt's error until a successful retry") { c in
        let rt = ScriptedRt()
        rt.answers["team invite"] = (0, #"{"contract":1,"code":"ABCD","expiresAt":"2026-10-08T00:00:00Z","pasteBlock":"x","forgeAccess":"skipped"}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.mintInvite(handle: "dev2", team: "gadgets")
        for answer in [(Int32(2), #"{"contract":1,"error":{"code":"not-admin","message":"Only an org admin invites"}}"#), (Int32(1), ""), (Int32(0), "not json")] {
            rt.answers["team invite"] = answer
            await m.mintInvite(handle: "dev2", team: "gadgets")
            await MainActor.run {
                c.expect(m.error != nil)
                c.expectEqual(m.invite?.code, "ABCD")
                if answer.0 == 2 { c.expectEqual(m.error, "Only an org admin invites") }
            }
        }
        rt.answers["team invite"] = (0, #"{"contract":1,"code":"EFGH","expiresAt":"2026-10-08T00:00:00Z","pasteBlock":"y","forgeAccess":"skipped"}"#)
        await m.mintInvite(handle: "dev2", team: nil)
        await MainActor.run {
            c.expectEqual(m.error, nil)
            c.expectEqual(m.invite?.code, "EFGH")
        }
        c.expectEqual(rt.calls.count, 5)
        c.expect(rt.calls.allSatisfy { $0.stdin == nil })
    },
    Check("RemoteMasker shows host + repo only, and never leaks stripped credentials on a path-less fallback") { c in
        c.expectEqual(RemoteMasker.mask("git@gitlab.example.com:tools/mattstack-team.git"), "gitlab.example.com/tools/mattstack-team")
        c.expectEqual(RemoteMasker.mask("https://user:token@github.com/m4ttheweric/mattstack-home.git"), "github.com/m4ttheweric/mattstack-home")
        c.expectEqual(RemoteMasker.mask("ssh://git@github.com:22/o/r"), "github.com/o/r")
        c.expectEqual(RemoteMasker.mask("weird"), "weird")
        let pathless = RemoteMasker.mask("https://oauth2:glpat-TOPSECRET@gitlab.host")
        c.expectEqual(pathless, "gitlab.host", "a path-less remote still masks to the bare host, not the raw string")
        c.expect(!pathless.contains("glpat-TOPSECRET"), "credentials must never survive masking, even on the no-\"/\" fallback path")
    },
    Check("TeamSettingsModel loads status, mints invites through rt, loads the uninstall dry-run — exact argv, no stdin") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"name":"Acme","slug":"acme","remote":"git@github.com:acme/mattstack-team-acme.git","lastPush":"2026-08-21T03:00:00Z","members":[{"username":"matt"},{"username":"bob"}]}"#)
        rt.answers["team invite --handle bob"] = (0, #"{"contract":1,"code":"ABCD","link":"https://mattstack.dev/join#ABCD","expiresAt":"2026-08-28T00:00:00Z","pasteBlock":"Install mattstack…","forgeAccess":"granted","manualSteps":[]}"#)
        rt.answers["uninstall --dry-run"] = (0, #"{"contract":1,"actions":[{"id":"services.unregister","title":"Stop services"}]}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        await MainActor.run {
            c.expectEqual(m.info?.name, "Acme")
            c.expectEqual(m.maskedRemote, "github.com/acme/mattstack-team-acme")
        }
        try c.require(rt.calls.count >= 1, "expected a team status call")
        c.expectEqual(rt.calls[0].args, ["team", "status", "--json"])
        c.expectEqual(rt.calls[0].stdin, nil)

        await m.mintInvite(handle: "bob", team: nil)
        await MainActor.run { c.expectEqual(m.invite?.code, "ABCD") }
        c.expectEqual(await MainActor.run { m.invite?.link }, "https://mattstack.dev/join#ABCD")
        try c.require(rt.calls.count >= 2, "expected team status then team invite, got \(rt.calls.map(\.args))")
        c.expectEqual(rt.calls[1].args, ["team", "invite", "--handle", "bob", "--json"])

        await m.loadUninstallPlan()
        await MainActor.run {
            let plan = m.uninstallPlan
            c.expect(plan != nil, "expected an uninstall plan")
            c.expectEqual(plan?.actions.first?.id, "services.unregister")
        }
        try c.require(rt.calls.count >= 3, "expected a third call for uninstall --dry-run, got \(rt.calls.map(\.args))")
        c.expectEqual(rt.calls[2].args, ["uninstall", "--dry-run", "--json"])
        c.expectEqual(rt.calls[2].stdin, nil)
    },
    Check("loadUninstallPlan clears a stale plan on a failed reload — Cancel then a failed reopen must not leave the sheet armable") { c in
        let rt = ScriptedRt()
        rt.answers["uninstall --dry-run"] = (0, #"{"contract":1,"actions":[{"id":"services.unregister","title":"Stop services"}]}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.loadUninstallPlan()
        await MainActor.run { c.expectEqual(m.uninstallPlan?.actions.first?.id, "services.unregister") }
        // User cancels the confirmation sheet here — no model call, uninstallPlan stays set.
        rt.answers["uninstall --dry-run"] = (1, "")
        await m.loadUninstallPlan()
        await MainActor.run {
            c.expectEqual(m.uninstallPlan, nil, "a failed reload must clear the earlier plan, not leave it armable on stale actions")
            c.expect(m.error != nil, "the failure must be surfaced")
        }
    },
    Check("TeamSettingsModel.uninstall(keepData:) streams the exact argv for keep vs delete, no stdin") { c in
        let rt = ScriptedRt()
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        _ = await MainActor.run { m.uninstall(keepData: true) }
        _ = await MainActor.run { m.uninstall(keepData: false) }
        try c.require(rt.calls.count >= 2, "expected two streamed uninstall calls, got \(rt.calls.map(\.args))")
        c.expectEqual(rt.calls[0].args, ["uninstall", "--keep-data", "--yes", "--json"])
        c.expectEqual(rt.calls[0].stdin, nil)
        c.expectEqual(rt.calls[1].args, ["uninstall", "--delete-data", "--yes", "--json"])
        c.expectEqual(rt.calls[1].stdin, nil)
    },
    Check("TeamSettingsModel surfaces a non-2 exit as rt's own failureCopy, and clears it once a later call succeeds") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (1, "")
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        await MainActor.run {
            c.expectEqual(m.error, "rt team status failed (exit 1).", "a non-2 exit must surface rt's failureCopy, never fall through to a generic \"unexpected reply\"")
            c.expect(m.info == nil)
        }
        rt.answers["team status"] = (0, #"{"contract":1,"name":"Acme"}"#)
        await m.load()
        await MainActor.run {
            c.expectEqual(m.error, nil, "a later success must clear the earlier failure")
            c.expectEqual(m.info?.name, "Acme")
        }
    },
    Check("the uninstall stream performs its need events on the shared NeedBroker — rt polls those outcomes and would otherwise time out") { c in
        let rt = ScriptedRt()
        let services = FakeServices(), privileged = FakePrivileged()
        rt.streamLines = [
            #"{"event":"plan","steps":[{"id":"services.unregister","title":"Stop services","kind":"app"},{"id":"proxy.remove","title":"Remove the proxy","kind":"privileged"}]}"#,
            #"{"event":"step","id":"services.unregister","state":"running"}"#,
            #"{"event":"need","id":"services.unregister","request":{"type":"app-unregister-services","plists":["com.mattstack.daemon.plist"]}}"#,
            #"{"event":"step","id":"services.unregister","state":"done","detail":"done by the app"}"#,
            #"{"event":"need","id":"proxy.remove","request":{"type":"app-privileged","op":"proxy-remove"}}"#,
            #"{"event":"done","ok":true,"failedStep":null}"#,
        ]
        let (m, broker) = await MainActor.run { makeTeamSettings(rt, services: services, privileged: privileged) }
        // An outcome left by an earlier run must not answer this run's poll.
        _ = await broker.perform(id: "services.unregister", request: NeedRequest(type: "stale-need", plists: nil, op: nil))

        var lines: [String] = []
        for try await line in await MainActor.run(body: { m.uninstall(keepData: true) }) { lines.append(line) }

        c.expectEqual(lines, rt.streamLines, "every line still reaches the consumer, unchanged and in order")
        c.expectEqual(services.unregistered, [["com.mattstack.daemon.plist"]], "the app-unregister-services need must reach the services provider")
        c.expectEqual(services.registered, [], "an uninstall must never register anything")
        c.expectEqual(privileged.removes, 1, "proxy.remove must raise the privileged removal, not sit pending")
        let unreg = await broker.outcome(id: "services.unregister")
        let proxy = await broker.outcome(id: "proxy.remove")
        c.expectEqual(unreg.state, "done", "rt polls GET /setup/need/services.unregister until this says done")
        c.expectEqual(proxy.state, "done")
        c.expect(!unreg.detail.contains("stale-need"), "the pre-run ledger entry must be forgotten, not replayed as this run's outcome")
    },
    Check("an invite that could not carry board peering decodes its warning, and an older CLI's reply still decodes without one") { c in
        let rt = ScriptedRt()
        rt.answers["team invite --handle bob"] = (0, #"{"contract":1,"code":"ABCD","expiresAt":"2026-08-28T00:00:00Z","pasteBlock":"p","forgeAccess":"skipped","manualSteps":[],"peering":"missing","peeringWarning":"board peering was not embedded in this invite (no admin token)"}"#)
        rt.answers["team invite --handle carol"] = (0, #"{"contract":1,"code":"EFGH","expiresAt":"2026-08-28T00:00:00Z","pasteBlock":"p","forgeAccess":"skipped","manualSteps":[]}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }

        await m.mintInvite(handle: "bob", team: nil)
        c.expectEqual(await MainActor.run { m.invite?.peering }, "missing")
        c.expectEqual(await MainActor.run { m.invite?.peeringWarning }, "board peering was not embedded in this invite (no admin token)")

        await m.mintInvite(handle: "carol", team: nil)
        c.expectEqual(await MainActor.run { m.invite?.code }, "EFGH")
        c.expect(await MainActor.run { m.invite?.peeringWarning == nil }, "an older CLI's reply carries no warning")
    },
    Check("TeamSettingsModel reads mode solo from team status") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"mode":"solo","slug":null,"name":null,"remote":null,"lastPush":null,"members":[]}"#)
        let m = await MainActor.run { makeTeamSettings(rt).0 }
        await m.load()
        c.expectEqual(await MainActor.run { m.isSolo }, true)
        c.expect(await MainActor.run { m.info?.remote == nil }, "a solo status carries no remote")
    },
    Check("AppsSettingsModel lists rt apps and flips one through rt, exact argv") { c in
        let rt = ScriptedRt()
        rt.answers["apps list"] = (0, #"{"contract":1,"apps":[{"name":"board","displayName":"Board","enabled":false,"requiresTeam":true},{"name":"chat","displayName":"Chat","enabled":true,"requiresTeam":false}]}"#)
        rt.answers["apps enable board"] = (0, #"{"contract":1,"name":"board","enabled":true}"#)
        let m = await MainActor.run { AppsSettingsModel(rt: rt) }
        let hookCalls = await MainActor.run { HookCounter() }
        await MainActor.run { m.onAppsChanged = { hookCalls.count += 1 } }
        c.expectEqual(await MainActor.run { m.loaded }, false, "nothing reads as an empty list before the first load")
        await m.load()
        c.expectEqual(await MainActor.run { m.loaded }, true)
        c.expectEqual(await MainActor.run { m.apps.map(\.name) }, ["board", "chat"])
        await m.setEnabled("board", true)
        try c.require(rt.calls.count == 3, "expected list, enable, list; got \(rt.calls.map(\.args))")
        c.expectEqual(rt.calls[1].args, ["apps", "enable", "board", "--json"])
        c.expectEqual(rt.calls[2].args, ["apps", "list", "--json"])
        c.expectEqual(await MainActor.run { hookCalls.count }, 1, "a successful flip fires the catalog hook exactly once")
        c.expectEqual(await MainActor.run { m.inFlight }, [], "nothing is in flight once the flip and reload return")
    },
    Check("AppsSettingsModel keeps rt's error and the last list on a failed flip") { c in
        let rt = ScriptedRt()
        rt.answers["apps list"] = (0, #"{"contract":1,"apps":[{"name":"board","displayName":"Board","enabled":true,"requiresTeam":true}]}"#)
        rt.answers["apps disable board"] = (2,#"{"contract":1,"error":{"code":"deck-not-running","message":"deck is not running; open mattstack.app, then retry"}}"#)
        let m = await MainActor.run { AppsSettingsModel(rt: rt) }
        let hookCalls = await MainActor.run { HookCounter() }
        await MainActor.run { m.onAppsChanged = { hookCalls.count += 1 } }
        await m.load()
        await m.setEnabled("board", false)
        c.expectEqual(await MainActor.run { m.error }, "deck is not running; open mattstack.app, then retry")
        c.expectEqual(await MainActor.run { m.apps.count }, 1)
        c.expectEqual(await MainActor.run { hookCalls.count }, 0, "a failed flip must not refresh the window's tabs")
        c.expectEqual(await MainActor.run { m.apps[0].enabled }, true, "a failed flip reverts the optimistic switch to its prior value")
        c.expectEqual(await MainActor.run { m.inFlight }, [], "a failed flip clears its in-flight guard")
    },
    Check("AppsSettingsModel stays unloaded when apps list fails, so the pane shows the error and no empty-list hint") { c in
        let rt = ScriptedRt()
        rt.answers["apps list"] = (1, "")
        let m = await MainActor.run { AppsSettingsModel(rt: rt) }
        await m.load()
        await MainActor.run {
            c.expectEqual(m.loaded, false)
            c.expectEqual(m.error, "rt apps list failed (exit 1).")
        }
    },
    Check("AppsSettingsModel flips the switch before rt answers and refuses a second flip of the same app while one is in flight") { c in
        let rt = GatedRt()
        let m = await MainActor.run { AppsSettingsModel(rt: rt) }
        await m.load()
        let gate = AsyncGate()
        rt.gate = gate
        let first = Task { await m.setEnabled("board", true) }
        await gate.waitForArrival()
        await MainActor.run {
            c.expectEqual(m.apps[0].enabled, true, "the switch flips before rt answers")
            c.expectEqual(m.inFlight, ["board"])
        }
        await m.setEnabled("board", false)
        c.expectEqual(rt.flips, 1, "a second click while the first is in flight must not send another verb")
        await gate.release()
        await first.value
        await MainActor.run { c.expectEqual(m.inFlight, []) }
    },
    Check("AppsSettingsModel reverts the optimistic flip on a non-2 exit, an undecodable reply and a spawn failure") { c in
        for answer in [(Int32(1), ""), (Int32(0), "not json")] {
            let rt = ScriptedRt()
            rt.answers["apps list"] = (0, #"{"contract":1,"apps":[{"name":"board","displayName":"Board","enabled":false,"requiresTeam":true}]}"#)
            rt.answers["apps enable board"] = answer
            let m = await MainActor.run { AppsSettingsModel(rt: rt) }
            await m.load()
            await m.setEnabled("board", true)
            await MainActor.run {
                c.expectEqual(m.apps[0].enabled, false, "reply \(answer) must revert the switch")
                c.expectEqual(m.inFlight, [])
                c.expect(m.error != nil, "reply \(answer) must surface an error")
            }
        }
        let rt = GatedRt()
        let m = await MainActor.run { AppsSettingsModel(rt: rt) }
        await m.load()
        rt.throwOnFlip = true
        await m.setEnabled("board", true)
        await MainActor.run {
            c.expectEqual(m.apps[0].enabled, false, "a thrown spawn error must revert the switch")
            c.expectEqual(m.inFlight, [])
            c.expect(m.error != nil)
        }
    },
    Check("SettingsRefresher reloads team and apps on every show, so an already-open Settings window refreshes") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"mode":"solo"}"#)
        rt.answers["apps list"] = (0, #"{"contract":1,"apps":[]}"#)
        let refresher = await MainActor.run {
            SettingsRefresher(team: makeTeamSettings(rt).0, apps: AppsSettingsModel(rt: rt))
        }
        await refresher.reload()
        await refresher.reload()
        c.expectEqual(rt.calls.filter { $0.args == ["team", "status", "--json"] }.count, 2, "a second show must run team status again")
        c.expectEqual(rt.calls.filter { $0.args == ["apps", "list", "--json"] }.count, 2, "a second show must run apps list again")
    },
    Check("SettingsRefresher reloads after an upgrade's setup window closes on a finished apply, never on a first run or an unfinished apply") { c in
        let rt = ScriptedRt()
        rt.answers["team status"] = (0, #"{"contract":1,"name":"Acme"}"#)
        rt.answers["apps list"] = (0, #"{"contract":1,"apps":[]}"#)
        let refresher = await MainActor.run {
            SettingsRefresher(team: makeTeamSettings(rt).0, apps: AppsSettingsModel(rt: rt))
        }
        await refresher.setupWindowClosed(entry: .firstRun, applied: true)
        await refresher.setupWindowClosed(entry: .upgrade, applied: false)
        c.expectEqual(rt.calls.count, 0, "a first run or an unfinished upgrade must not reload Settings")
        await refresher.setupWindowClosed(entry: .upgrade, applied: true)
        c.expectEqual(rt.calls.map(\.args), [["team", "status", "--json"], ["apps", "list", "--json"]])
    },
]
