import Foundation
@testable import MattstackCore

private let check = "tools stale herdr --json"
private let restart = "tools restart herdr --server work --json"

private final class Clock: @unchecked Sendable {
    var now = Date(timeIntervalSince1970: 1_000)
}

@MainActor
private func model(_ rt: ScriptedRt, _ clock: Clock = Clock()) -> HerdrRestartModel {
    HerdrRestartModel(rt: rt, now: { clock.now })
}

let herdrRestartChecks: [Check] = [
    Check("a server older than the installed herdr needs a restart, by name") { c in
        let rt = ScriptedRt()
        rt.answers[check] = (0, #"{"contract":1,"stale":["work","side"]}"#)
        let m = await model(rt)
        let found = await m.refresh()
        c.expectEqual(found, .stale(["work", "side"]))
        let stale = await m.stale
        c.expectEqual(stale, ["work", "side"])
        c.expectEqual(rt.calls.map(\.args), [["tools", "stale", "herdr", "--json"]])
    },
    Check("no older server needs none") { c in
        let rt = ScriptedRt()
        rt.answers[check] = (0, #"{"stale":[]}"#)
        let m = await model(rt)
        let found = await m.refresh()
        c.expectEqual(found, .current)
        let needs = await m.needsRestart
        c.expect(!needs, "offered a restart with nothing stale")
    },
    Check("a failed check offers no restart and keeps rt's reason") { c in
        let rt = ScriptedRt()
        rt.sequences[check] = [(0, #"{"stale":["work"]}"#), (2, #"{"stale":[],"error":{"code":"herdr-check-failed","message":"herdr could not list its sessions"}}"#)]
        let m = await model(rt)
        _ = await m.refresh()
        let found = await m.refresh()
        c.expectEqual(found, .failed("herdr could not list its sessions"))
        let needs = await m.needsRestart
        c.expect(!needs, "kept offering a restart it could not confirm")
    },
    Check("an rt too old for the check offers no restart") { c in
        let rt = ScriptedRt()
        rt.answers[check] = (1, "")
        let m = await model(rt)
        let found = await m.refresh()
        c.expectEqual(found, .failed("rt tools stale failed (exit 1)."))
    },
    Check("opening the menu checks again only after ten minutes") { c in
        let rt = ScriptedRt(), clock = Clock()
        rt.answers[check] = (0, #"{"stale":[]}"#)
        let m = await model(rt, clock)
        await m.refreshIfDue()
        clock.now += 599
        await m.refreshIfDue()
        c.expectEqual(rt.calls.count, 1)
        clock.now += 1
        await m.refreshIfDue()
        c.expectEqual(rt.calls.count, 2)
    },
    Check("an older check that answers late never overwrites a newer one") { c in
        let rt = ScriptedRt()
        rt.sequences[check] = [(0, #"{"stale":[]}"#), (0, #"{"stale":["work"]}"#)]
        let m = await model(rt)
        // The second check starts and finishes while the first waits on rt, so it takes the first answer.
        rt.duringNextRun = { _ = await m.refresh() }
        _ = await m.refresh()
        let stale = await m.stale
        c.expectEqual(stale, [])
    },
    Check("a restart runs rt's restart, then checks again") { c in
        let rt = ScriptedRt()
        rt.sequences[check] = [(0, #"{"stale":["work"]}"#), (0, #"{"stale":[]}"#)]
        rt.sequences[restart] = [(0, #"{"stopped":["work"],"failed":[]}"#)]
        let m = await model(rt)
        _ = await m.refresh()
        let error = await m.restart(["work"])
        c.expectEqual(error, nil)
        let needs = await m.needsRestart
        c.expect(!needs, "still offered after the restart")
        c.expectEqual(rt.calls.map { $0.args.joined(separator: " ") }, [check, restart, check])
    },
    Check("a restart names every confirmed server, and none restarts without a name") { c in
        let rt = ScriptedRt()
        rt.sequences[check] = [(0, #"{"stale":["work","side","late"]}"#)]
        rt.answers["tools restart herdr"] = (0, #"{"stopped":["work","side"],"failed":[]}"#)
        let m = await model(rt)
        _ = await m.restart(["work", "side"])
        c.expectEqual(rt.calls.first?.args ?? [], ["tools", "restart", "herdr", "--server", "work", "--server", "side", "--json"])
        rt.calls = []
        _ = await m.restart([])
        c.expect(!rt.calls.contains { $0.args.contains("restart") }, "an empty list would restart every stale server")
    },
    Check("a restart that failed says why and stays offered") { c in
        let rt = ScriptedRt()
        rt.sequences[check] = [(0, #"{"stale":["work"]}"#)]
        rt.sequences[restart] = [(2, #"{"stopped":[],"failed":["work"],"error":{"code":"herdr-restart-failed","message":"herdr did not stop: work"}}"#)]
        let m = await model(rt)
        _ = await m.refresh()
        let error = await m.restart(["work"])
        c.expectEqual(error, "herdr did not stop: work")
        let needs = await m.needsRestart
        c.expect(needs, "gave up the offer after a failed restart")
    },
    Check("a second press while a restart runs does nothing") { c in
        let rt = ScriptedRt()
        rt.sequences[check] = [(0, #"{"stale":[]}"#)]
        rt.sequences[restart] = [(0, #"{"stopped":["work"],"failed":[]}"#)]
        let m = await model(rt)
        rt.duringNextRun = { _ = await m.restart(["work"]) }
        _ = await m.restart(["work"])
        c.expectEqual(rt.calls.filter { $0.args.joined(separator: " ") == restart }.count, 1)
    },
    Check("the confirmation names the servers and says their panes end") { c in
        c.expectEqual(HerdrRestartCopy.confirmBody(["work"]),
                      "1 herdr server still runs the older version: work. Restarting ends every pane in it, and any agent still working there stops. Open herdr again to start on the new version.")
        c.expectEqual(HerdrRestartCopy.confirmBody(["work", "side"]),
                      "2 herdr servers still run the older version: work, side. Restarting ends every pane in them, and any agent still working there stops. Open herdr again to start on the new version.")
    },
]
