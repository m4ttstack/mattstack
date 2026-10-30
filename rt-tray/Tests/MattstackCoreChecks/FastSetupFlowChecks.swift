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
            c.expect(!landed.canGoBack, "rt's stage past the cards drops the pick")
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
]
