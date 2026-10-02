import Foundation
@testable import MattstackCore

private func policy(_ ticks: [(healthy: Bool, hold: DeckHealHold?, at: TimeInterval)]) -> [DeckHealDecision] {
    var p = DeckHealPolicy()
    return ticks.map { p.observe(healthy: $0.healthy, hold: $0.hold, now: $0.at) }
}

private func down(_ at: TimeInterval, hold: DeckHealHold? = nil) -> (healthy: Bool, hold: DeckHealHold?, at: TimeInterval) {
    (false, hold, at)
}

private func up(_ at: TimeInterval) -> (healthy: Bool, hold: DeckHealHold?, at: TimeInterval) { (true, nil, at) }

let deckHealChecks: [Check] = [
    Check("deck heal: one missed probe waits, the second restarts") { c in
        c.expectEqual(policy([down(0), down(10)]), [.waiting, .heal])
    },
    Check("deck heal: a healthy probe between misses starts the count over") { c in
        c.expectEqual(policy([down(0), up(10), down(20), down(30)]), [.waiting, .healthy, .waiting, .heal])
    },
    Check("deck heal: after a restart deck gets two more polls to come back") { c in
        c.expectEqual(policy([down(0), down(10), down(20), down(30)]), [.waiting, .heal, .waiting, .heal])
    },
    Check("deck heal: gives up after three restarts inside ten minutes") { c in
        let ticks = (0..<9).map { down(TimeInterval($0 * 10)) }
        c.expectEqual(policy(ticks), [.waiting, .heal, .waiting, .heal, .waiting, .heal, .waiting, .gaveUp, .gaveUp])
    },
    Check("deck heal: a deck that flaps up between restarts still hits the cap") { c in
        let ticks = [down(0), down(10), up(20), down(30), down(40), up(50), down(60), down(70), up(80), down(90), down(100)]
        c.expectEqual(policy(ticks).filter { $0 != .healthy && $0 != .waiting }, [.heal, .heal, .heal, .gaveUp])
    },
    Check("deck heal: restarts older than the window stop counting") { c in
        var p = DeckHealPolicy()
        for t in stride(from: 0.0, through: 60, by: 10) { _ = p.observe(healthy: false, hold: nil, now: t) }
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 70), .gaveUp)
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 615), .heal, "the restart at 10s has aged out")
        c.expectEqual(p.attemptCount(now: 615), 3)
    },
    Check("deck heal: a healthy deck clears gave-up") { c in
        var p = DeckHealPolicy()
        for t in stride(from: 0.0, through: 70, by: 10) { _ = p.observe(healthy: false, hold: nil, now: t) }
        c.expectEqual(p.observe(healthy: true, hold: nil, now: 80), .healthy)
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 90), .waiting)
    },
    Check("deck heal: a hold never restarts and never spends an attempt") { c in
        var p = DeckHealPolicy()
        for t in stride(from: 0.0, through: 100, by: 10) {
            c.expectEqual(p.observe(healthy: false, hold: .awaitingApproval, now: t), .held(.awaitingApproval))
        }
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 110), .heal, "misses during a hold still count")
        c.expectEqual(p.attemptCount(now: 110), 1)
    },
    Check("deck heal: a manual restart clears the cap and the miss count") { c in
        var p = DeckHealPolicy()
        for t in stride(from: 0.0, through: 70, by: 10) { _ = p.observe(healthy: false, hold: nil, now: t) }
        p.manualRestart()
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 80), .waiting)
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 90), .heal)
    },
    Check("deck status: running is quiet and names the pid; dev adds the run mode") { c in
        let prod = DeckStatusLines.status(for: .healthy, pid: "4242", runMode: nil)
        c.expectEqual(prod, "Deck: running · pid 4242")
        c.expect(DeckStatusLines.isQuiet(prod))
        c.expectEqual(DeckStatusLines.status(for: .healthy, pid: "4242", runMode: "pinned"),
                      "Deck: running · pid 4242 · pinned")
    },
    Check("deck status: every unhealthy state reads at full contrast") { c in
        let lines = [DeckHealDecision.waiting, .heal, .gaveUp, .held(.awaitingApproval), .held(.notRegistered),
                     .held(.servedAppsRestarting), .held(.restartInFlight)]
            .map { DeckStatusLines.status(for: $0, pid: nil, runMode: nil) }
        c.expectEqual(lines, [
            "Deck: not responding",
            "Deck: not responding, restarting",
            "Deck: down, stopped restarting it automatically",
            "Deck: waiting for Login Items approval",
            "Deck: not registered",
            "Deck: restarting apps",
            "Deck: restarting",
        ])
        c.expect(lines.allSatisfy { !DeckStatusLines.isQuiet($0) })
    },
    Check("deck status: run mode is read from deck's api.json") { c in
        c.expectEqual(DeckStatusLines.runMode(apiJSON: Data(#"{"port":7940,"pid":1,"runMode":"source"}"#.utf8)), "source")
        c.expectEqual(DeckStatusLines.runMode(apiJSON: Data(#"{"port":7940,"pid":1}"#.utf8)), nil)
        c.expectEqual(DeckStatusLines.runMode(apiJSON: Data("not json".utf8)), nil)
    },
]
