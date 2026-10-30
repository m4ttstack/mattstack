import Foundation
import MattstackCore

@MainActor private func flow(_ entry: SetupEntry = .firstRun, on stage: FormStage, requested: TeamChoice? = nil) -> FastSetupFlow {
    let f = FastSetupFlow(entry: entry)
    f.requested = requested
    f.land(on: stage)
    return f
}

let fastSetupFlowChecks: [Check] = [
    Check("FastSetupFlow: each rt stage lands on its screen") { c in
        let pairs: [(FormStage, FastSetupScreen)] = [
            (.macos, .macos), (.path, .path), (.invite, .invite), (.waiting, .waiting), (.connect, .connect),
            (.thisMac, .thisMac), (.running, .running), (.paused, .paused), (.ready, .ready),
        ]
        for (stage, screen) in pairs { c.expectEqual(FastSetupFlow.screen(for: stage), screen, "\(stage)") }
        await MainActor.run {
            let f = FastSetupFlow(entry: .firstRun)
            c.expectEqual(f.screen, .loading, "nothing is on screen before rt's first read")
            for (stage, screen) in pairs { f.land(on: stage); c.expectEqual(f.screen, screen, "\(stage)") }
            f.choose(.join)
            f.land(on: .running)
            c.expectEqual(f.screen, .running, "rt's stage wins over a local move")
            let status = flow(.status, on: .paused)
            c.expectEqual(status.screen, .paused, "Setup status opens wherever rt says setup is")
        }
        c.expectEqual(FastSetupScreen.createTeam.rawValue, "create-team")
        c.expectEqual(FastSetupScreen.thisMac.rawValue, "this-mac")
    },
    Check("FastSetupFlow: macOS done moves on to the four cards") { c in
        await MainActor.run {
            let f = flow(on: .macos)
            f.macosDone()
            c.expectEqual(f.screen, .path)
            let status = flow(.status, on: .macos)
            status.macosDone()
            c.expectEqual(status.screen, .loading, "a finished Mac that lost a permission resumes where rt says, not on the cards")
        }
    },
    Check("FastSetupFlow: an upgrade's Join skips the cards") { c in
        await MainActor.run {
            let join = flow(.upgrade, on: .macos, requested: .join)
            join.macosDone()
            c.expectEqual(join.screen, .invite)
            let create = flow(.upgrade, on: .macos, requested: .create)
            create.macosDone()
            c.expectEqual(create.screen, .createTeam)
            let none = flow(.upgrade, on: .macos)
            none.macosDone()
            c.expectEqual(none.screen, .loading, "an upgrade that asked for nothing waits for rt's stage")
        }
    },
    Check("FastSetupFlow: an upgrade on a ready Mac lands on the requested screen, a join in flight on rt's stage") { c in
        await MainActor.run {
            c.expectEqual(flow(.upgrade, on: .ready, requested: .join).screen, .invite)
            c.expectEqual(flow(.upgrade, on: .ready, requested: .create).screen, .createTeam)
            c.expectEqual(flow(.upgrade, on: .waiting, requested: .join).screen, .waiting, "rt knows the join is in flight")
            c.expectEqual(flow(.upgrade, on: .invite, requested: .create).screen, .invite)
            c.expectEqual(flow(.upgrade, on: .ready).screen, .ready)
            c.expectEqual(flow(.firstRun, on: .ready, requested: .join).screen, .ready, "only an upgrade reads requested")
            c.expectEqual(flow(.status, on: .ready, requested: .join).screen, .ready)
            let upgrade = flow(.upgrade, on: .ready, requested: .create)
            c.expect(!upgrade.canGoBack, "an upgrade has no cards behind it")
            upgrade.created()
            upgrade.continueToThisMac()
            upgrade.startRun()
            upgrade.runEnded(stage: .ready)
            c.expectEqual(upgrade.screen, .ready, "a finished upgrade ends on ready, not back on Create")
            let created = flow(.upgrade, on: .ready, requested: .create)
            created.created()
            created.land(on: .ready)
            c.expectEqual(created.screen, .ready, "a stale read after Create started does not reopen Create")
            let joined = flow(.upgrade, on: .ready, requested: .join)
            joined.joined()
            joined.land(on: .ready)
            c.expectEqual(joined.screen, .ready, "a stale read after Join was sent does not reopen the invite")
        }
    },
    Check("FastSetupFlow: Just me goes straight to accounts") { c in
        await MainActor.run {
            let f = flow(on: .path)
            f.choose(.solo)
            c.expectEqual(f.screen, .connect)
            c.expect(f.canGoBack, "Just me's accounts screen came from the cards")
            f.back()
            c.expectEqual(f.screen, .path)
            f.choose(.create); c.expectEqual(f.screen, .createTeam)
            c.expect(f.canGoBack)
            f.back(); c.expectEqual(f.screen, .path)
            f.choose(.restore); c.expectEqual(f.screen, .restore)
            c.expect(f.canGoBack)
            f.back(); c.expectEqual(f.screen, .path)
            f.choose(.create); f.created()
            c.expectEqual(f.screen, .connect, "Create has no wait")
            c.expect(!f.canGoBack, "a created team cannot be walked back into the cards")
            let resumed = flow(on: .connect)
            c.expect(!resumed.canGoBack, "a relaunch onto accounts has no cards behind it here")
            let landed = flow(on: .path)
            landed.choose(.solo)
            landed.land(on: .connect)
            c.expect(landed.canGoBack, "accounts' own read keeps the pick")
            landed.land(on: .thisMac)
            landed.land(on: .connect)
            c.expect(!landed.canGoBack, "rt's stage past accounts drops the pick")
            let finished = flow(on: .path)
            finished.choose(.solo)
            finished.land(on: .ready)
            finished.land(on: .connect)
            c.expect(!finished.canGoBack, "a ready Mac drops the pick")
            let ran = flow(on: .path)
            ran.choose(.solo)
            ran.startRun()
            ran.runEnded(stage: .connect)
            c.expect(!ran.canGoBack, "a run's end drops the pick")
        }
    },
    Check("FastSetupFlow: a join waits, approval opens accounts") { c in
        await MainActor.run {
            let f = flow(on: .path)
            f.choose(.join)
            c.expectEqual(f.screen, .invite)
            c.expect(f.canGoBack)
            c.expect(!f.hidesOnPrimary)
            f.joined()
            c.expectEqual(f.screen, .waiting)
            c.expect(f.hidesOnPrimary, "Hide on the wait closes the window")
            f.approved()
            c.expectEqual(f.screen, .connect)
            c.expect(!f.canGoBack, "a joined team cannot be walked back into the cards")
            c.expect(!f.hidesOnPrimary)
            c.expect(!flow(.upgrade, on: .invite).canGoBack)
            c.expect(!flow(.status, on: .invite).canGoBack)
        }
    },
    Check("FastSetupFlow: a restore starts the bar") { c in
        await MainActor.run {
            let f = flow(on: .path)
            f.choose(.restore)
            f.restored()
            c.expectEqual(f.screen, .running)
            c.expect(f.hidesOnPrimary)
        }
    },
    Check("FastSetupFlow: a failed run pauses, Retry runs again") { c in
        await MainActor.run {
            let f = flow(on: .thisMac)
            f.startRun()
            c.expectEqual(f.screen, .running)
            f.runEnded(stage: .paused)
            c.expectEqual(f.screen, .paused)
            c.expect(!f.hidesOnPrimary, "Retry is the paused screen's primary")
            f.retry()
            c.expectEqual(f.screen, .running)
            f.runEnded(stage: .ready)
            c.expectEqual(f.screen, .ready)
        }
    },
    Check("FastSetupFlow: no Back from the wait, the bar or ready") { c in
        await MainActor.run {
            for stage in [FormStage.waiting, .running, .paused, .ready, .macos, .path] {
                let f = flow(on: stage)
                c.expect(!f.canGoBack, "\(stage)")
                f.back()
                c.expectEqual(f.screen, FastSetupFlow.screen(for: stage), "Back does nothing on \(stage)")
            }
            c.expect(!FastSetupFlow(entry: .firstRun).canGoBack, "nothing behind loading")
        }
    },
    Check("FastSetupFlow: Back from this Mac returns to accounts") { c in
        await MainActor.run {
            for entry in [SetupEntry.firstRun, .upgrade, .status] {
                let f = flow(entry, on: .connect)
                f.continueToThisMac()
                c.expectEqual(f.screen, .thisMac)
                c.expect(f.canGoBack, "\(entry)")
                f.back()
                c.expectEqual(f.screen, .connect)
            }
            let resumed = flow(on: .thisMac)
            c.expect(resumed.canGoBack, "a relaunch onto this Mac can still step back to accounts")
            resumed.back()
            c.expectEqual(resumed.screen, .connect)
        }
    },
    Check("FastSetupFlow: macOS is done only when all three rows are") { c in
        let done = [macosRow("perm.fda", .done), macosRow("perm.notifications", .done), macosRow("mac.fancy-urls", .done)]
        c.expect(FastSetupFlow.allDone(done))
        c.expect(FastSetupFlow.macosReady(done))
        for (i, state) in [(0, FormRowState.todo), (1, .todo), (2, .waiting), (2, .busy)] {
            var rows = done
            rows[i].state = state
            c.expect(!FastSetupFlow.allDone(rows), "\(rows[i].id) \(state)")
            c.expect(!FastSetupFlow.macosReady(rows), "\(rows[i].id) \(state) holds P1")
        }
        var turnedOff = done
        turnedOff[1].detail = "Turned off"
        turnedOff[1].action = RowAction(type: .openSettings, label: "Open settings", target: "notifications")
        c.expect(FastSetupFlow.macosReady(turnedOff), "rt calls denied notifications done, so P1 moves on")
        var optional = done
        optional[2].state = .todo
        optional[2].optional = true
        c.expect(FastSetupFlow.macosReady(optional), "an optional row never holds P1")
    },
    Check("FastSetupFlow: a macOS section not loaded yet never moves P1 on") { c in
        c.expect(!FastSetupFlow.macosReady(nil))
        c.expect(!FastSetupFlow.macosReady([]), "a loaded but empty macOS section has nothing to show, so it never moves on")
    },
    Check("FastSetupFlow: an empty section holds nothing") { c in
        c.expect(FastSetupFlow.allDone([]))
        c.expect(FastSetupFlow.allDone([macosRow("slack", .todo, optional: true)]))
    },
    Check("FastSetupFlow: Join waits for every invite row, Command Line Tools included") { c in
        let done = [macosRow("tool.clt", .done), macosRow("forge.token", .done)]
        c.expect(FastSetupFlow.joinEnabled(verdictOK: true, rows: done))
        c.expect(!FastSetupFlow.joinEnabled(verdictOK: false, rows: done), "no good read, no Join")
        c.expect(!FastSetupFlow.joinEnabled(verdictOK: false, rows: []), "an empty section never stands in for a read")
        c.expect(FastSetupFlow.joinEnabled(verdictOK: true, rows: []), "gh signed in and git present: nothing to wait on")
        c.expect(!FastSetupFlow.joinEnabled(verdictOK: true, rows: nil), "a good read before rt's invite section arrives holds Join")
        for state in [FormRowState.todo, .busy, .waiting] {
            c.expect(!FastSetupFlow.joinEnabled(verdictOK: true, rows: [macosRow("tool.clt", state), macosRow("forge.token", .done)]),
                     "Command Line Tools \(state) holds Join")
            c.expect(!FastSetupFlow.joinEnabled(verdictOK: true, rows: [macosRow("tool.clt", .done), macosRow("forge.token", state)]),
                     "the token \(state) holds Join")
        }
        c.expect(FastSetupFlow.joinEnabled(verdictOK: true, rows: [macosRow("tool.clt", .done), macosRow("extra", .todo, optional: true)]),
                 "an optional row never holds Join")
    },
    Check("FastSetupFlow: Create team waits for Command Line Tools") { c in
        c.expect(!FastSetupFlow.createEnabled(nameAndGroup: true, rows: [macosRow("tool.clt", .busy), macosRow("forge.token", .done)]),
                 "a busy Command Line Tools row holds Create team")
        for state in [FormRowState.todo, .busy, .waiting] {
            c.expect(!FastSetupFlow.createEnabled(nameAndGroup: true, rows: [macosRow("tool.clt", .done), macosRow("forge.token", state)]),
                     "the token \(state) holds Create team")
        }
        c.expect(FastSetupFlow.createEnabled(nameAndGroup: true, rows: [macosRow("tool.clt", .done), macosRow("forge.token", .done)]))
        c.expect(FastSetupFlow.createEnabled(nameAndGroup: true, rows: [macosRow("forge.token", .done), macosRow("extra", .todo, optional: true)]),
                 "an optional row never holds Create team")
    },
    Check("FastSetupFlow: Restore waits for Command Line Tools") { c in
        for state in [FormRowState.todo, .busy, .waiting] {
            c.expect(!FastSetupFlow.restoreEnabled(repo: "janedoe/mattstack-home", key: "key", rows: [macosRow("tool.clt", state)]),
                     "Command Line Tools \(state) holds Restore")
        }
        c.expect(FastSetupFlow.restoreEnabled(repo: "janedoe/mattstack-home", key: "key", rows: [macosRow("tool.clt", .done)]))
        c.expect(FastSetupFlow.restoreEnabled(repo: "janedoe/mattstack-home", key: "key", rows: []), "git already present: nothing to wait on")
    },
    Check("FastSetupFlow: Restore needs the repo and the key") { c in
        c.expect(!FastSetupFlow.restoreEnabled(repo: "", key: "key", rows: []), "no repo, no Restore")
        c.expect(!FastSetupFlow.restoreEnabled(repo: "janedoe/mattstack-home", key: "", rows: []), "no key, no Restore")
        c.expect(!FastSetupFlow.restoreEnabled(repo: "  ", key: "key", rows: []), "a blank repo is no repo")
        c.expect(!FastSetupFlow.restoreEnabled(repo: "janedoe/mattstack-home", key: " \n", rows: []), "a blank key is no key")
    },
    Check("FastSetupFlow: Restore waits for the restore section to load") { c in
        c.expect(!FastSetupFlow.restoreEnabled(repo: "janedoe/mattstack-home", key: "key", rows: nil),
                 "before rt's restore section arrives nothing says whether git is missing")
    },
    Check("FastSetupFlow: a launch on stage running starts the bar with --resume") { c in
        c.expect(FastSetupLaunch.startsRun(stage: .running, runLive: false))
        c.expect(!FastSetupLaunch.startsRun(stage: .running, runLive: true), "a run already live in this app is never started over")
        for stage in [FormStage.macos, .path, .invite, .waiting, .connect, .thisMac, .paused, .ready] {
            c.expect(!FastSetupLaunch.startsRun(stage: stage, runLive: false), "\(stage) starts nothing")
        }
        c.expect(FastSetupRun.arguments(retryFrom: nil).contains("--resume"))
        let rt = ScriptedRt()
        let stream = FastSetupLaunch.installStream(rt: rt)
        for try await _ in stream(nil) {}
        c.expectEqual(rt.calls.last?.args, FastSetupRun.arguments(retryFrom: nil), "the bar attaches to or resumes rt's run")
        for try await _ in stream("repos.clone") {}
        c.expectEqual(rt.calls.last?.args, FastSetupRun.arguments(retryFrom: "repos.clone"), "Retry runs from the failed step")
    },
    Check("FastSetupFlow: a Retry rt names no step for resumes with a person there") { c in
        c.expectEqual(FastSetupRun.arguments(retryFrom: nil, attended: true), ["setup", "apply", "--resume", "--json"])
        c.expectEqual(FastSetupRun.arguments(retryFrom: "repos.clone", attended: true), FastSetupRun.arguments(retryFrom: "repos.clone"))
        let rt = ScriptedRt()
        final class Flag: @unchecked Sendable { var on = true }
        let flag = Flag()
        let stream = FastSetupLaunch.installStream(rt: rt, attended: { flag.on })
        for try await _ in stream(nil) {}
        c.expectEqual(rt.calls.last?.args, ["setup", "apply", "--resume", "--json"], "a person pressed Retry, so nothing is unattended")
        flag.on = false
        for try await _ in stream(nil) {}
        c.expectEqual(rt.calls.last?.args, FastSetupRun.arguments(retryFrom: nil))
    },
    Check("FastSetupFlow: an approval moves on from the invite or the wait, never from later") { c in
        await MainActor.run {
            let atOnce = flow(on: .invite)
            c.expect(atOnce.joinApproved(), "a join approved at once never sat on the wait")
            c.expectEqual(atOnce.screen, .connect)
            let waited = flow(on: .waiting)
            c.expect(waited.joinApproved())
            c.expectEqual(waited.screen, .connect)
            for stage in [FormStage.thisMac, .running, .paused, .ready, .connect] {
                let past = flow(on: stage)
                c.expect(!past.joinApproved(), "\(stage) stays put")
                c.expectEqual(past.screen, FastSetupFlow.screen(for: stage))
            }
            let upgrade = flow(.upgrade, on: .ready, requested: .join)
            c.expectEqual(upgrade.screen, .invite)
            c.expect(upgrade.joinApproved())
            upgrade.land(on: .ready)
            c.expectEqual(upgrade.screen, .ready, "an approved upgrade never reopens the invite")
        }
    },
    Check("FastSetupFlow: a finish this window owes survives Setup status") { c in
        // Hidden during the run, which ends ready; the banner click reopens a now finished Mac as status.
        var banner = SetupFinishLedger()
        banner.opened(as: .firstRun)
        banner.entered(.running)
        banner.entered(.ready)
        banner.opened(as: .status)
        c.expect(banner.settle(), "closing or Open the board still records Finish")
        c.expect(!banner.settle(), "once")

        var status = SetupFinishLedger()
        status.opened(as: .status)
        status.entered(.loading)
        status.entered(.ready)
        c.expect(!status.settle(), "Setup status on a finished Mac records nothing")

        var stale = SetupFinishLedger()
        stale.opened(as: .firstRun)
        stale.entered(.running)
        stale.opened(as: .status)
        stale.entered(.ready)
        c.expect(!stale.settle(), "an unfinished screen seen in an earlier opening is not this one's")

        var paused = SetupFinishLedger()
        paused.opened(as: .status)
        paused.entered(.paused)
        paused.entered(.running)
        paused.entered(.ready)
        c.expect(paused.settle(), "Setup status that shows a run finish owes Finish")

        var firstRun = SetupFinishLedger()
        firstRun.opened(as: .firstRun)
        firstRun.entered(.ready)
        c.expect(firstRun.settle(), "a first run that lands straight on ready still records Finish")
    },
    Check("FastSetupFlow: a run that ends lands where rt says") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup form --json": (0, wholeForm(stage: "paused", paused: clonePaused))]
        let form = await SetupFormModel(rt: rt)
        let f = await flow(on: .thisMac)
        await f.startRun()
        let paused = await f.landAfterRun(reading: form)
        c.expectEqual(await f.screen, .paused)
        c.expectEqual(rt.calls.last?.args, ["setup", "form", "--json"], "a run's end reads the whole form")
        c.expectEqual(FastSetupLaunch.runEndNotice(stage: .paused, paused: paused?.paused),
                      SetupNotice(title: "Setup paused", body: "Couldn't clone your repos"))
        await f.retry()
        rt.answers = ["setup form --json": (0, wholeForm(stage: "ready"))]
        _ = await f.landAfterRun(reading: form)
        c.expectEqual(await f.screen, .ready)
        c.expectEqual(FastSetupLaunch.runEndNotice(stage: .ready, paused: nil),
                      SetupNotice(title: "This Mac is ready", body: "Go make something cool"))
        c.expectEqual(FastSetupLaunch.runEndNotice(stage: .running, paused: nil), nil, "a run rt still holds says nothing")
        c.expectEqual(FastSetupLaunch.runEndNotice(stage: .thisMac, paused: nil), nil)

        let upgrade = await flow(.upgrade, on: .ready, requested: .join)
        await upgrade.joined()
        _ = await upgrade.landAfterRun(reading: form)
        c.expectEqual(await upgrade.screen, .ready, "an upgrade's run ends on ready, not back on the invite")

        let stays = await flow(on: .running)
        rt.answers = ["setup form --json": (1, "")]
        c.expectEqual(await stays.landAfterRun(reading: form), nil)
        c.expectEqual(await stays.screen, .running, "a read rt could not answer moves nothing")
        rt.answers = ["setup form --json": (0, wholeForm(stage: nil))]
        c.expectEqual(await stays.landAfterRun(reading: form), nil)
        c.expectEqual(await stays.screen, .running, "a read without a stage moves nothing")
    },
    Check("FastSetupFlow: a whole read lands, and loading asks for one") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup form --json": (0, wholeForm(stage: "connect"))]
        let form = await SetupFormModel(rt: rt)
        let status = await flow(.status, on: .macos)
        await status.macosDone()
        c.expectEqual(await status.screen, .loading)
        _ = await status.land(reading: form)
        c.expectEqual(await status.screen, .connect, "a finished Mac that got macOS back resumes where rt says")
        c.expectEqual(rt.calls.last?.args, ["setup", "form", "--json"])
    },
    Check("FastSetupFlow: Setup status on an unfinished Mac is the first run") { c in
        c.expectEqual(FastSetupLaunch.entry(.status, finished: false), .firstRun, "an unfinished Mac still offers Just me")
        c.expectEqual(FastSetupLaunch.entry(.status, finished: true), .status)
        c.expectEqual(FastSetupLaunch.entry(.firstRun, finished: true), .status, "a finished Mac opens as status")
        c.expectEqual(FastSetupLaunch.entry(.firstRun, finished: false), .firstRun)
        c.expectEqual(FastSetupLaunch.entry(.upgrade, finished: true), .upgrade)
    },
    Check("FastSetupFlow: the bar times a run rt still holds from when it started") { c in
        let live = Data(#"{"v":2,"run":{"startedAt":"2026-10-30T10:00:00.000Z","done":["org.pull"]}}"#.utf8)
        let ended = Data(#"{"v":2,"run":{"startedAt":"2026-10-30T10:00:00.000Z","done":[],"endedAt":"2026-10-30T10:05:00.000Z","ok":false}}"#.utf8)
        c.expectEqual(FastSetupLaunch.runStartedAt(stateJSON: live), Date(timeIntervalSince1970: 1_793_354_400))
        c.expectEqual(FastSetupLaunch.runStartedAt(stateJSON: ended), nil, "an ended run is not the one the bar shows")
        c.expectEqual(FastSetupLaunch.runStartedAt(stateJSON: Data(#"{"v":2}"#.utf8)), nil)
        c.expectEqual(FastSetupLaunch.runStartedAt(stateJSON: nil), nil)
    },
    Check("FastSetupFlow: each screen reads its own section") { c in
        let pairs: [(FastSetupScreen, String?)] = [
            (.macos, "macos"), (.invite, "invite"), (.createTeam, "create"), (.restore, "restore"),
            (.connect, "connect"), (.thisMac, "this-mac"), (.loading, nil), (.path, nil), (.waiting, nil),
            (.running, nil), (.paused, nil), (.ready, nil),
        ]
        for (screen, section) in pairs { c.expectEqual(screen.section, section, "\(screen)") }
    },
]

private let clonePaused = #"{"step":"repos.clone","title":"Couldn't clone your repos","detail":"GitLab says your token can't see acme/acme-api","log":[]}"#

private func wholeForm(stage: String?, paused: String = "null") -> String {
    let stage = stage.map { "\"\($0)\"" } ?? "null"
    return #"{"path":"join","team":{"slug":"widgets","name":"Widgets","invitedBy":"Jane Doe"},"stage":\#(stage),"sections":{"macos":[]},"continueReady":false,"startReady":false,"paused":\#(paused),"home":{"label":"Open the board","url":"https://board.mattstack"}}"#
}

private func macosRow(_ id: String, _ state: FormRowState, optional: Bool = false) -> FormRow {
    FormRow(id: id, title: id, subtext: "", state: state, detail: "", optional: optional)
}
