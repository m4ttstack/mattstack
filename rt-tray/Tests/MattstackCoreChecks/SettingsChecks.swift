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

let settingsChecks: [Check] = [
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

        await m.mintInvite(handle: "bob")
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
