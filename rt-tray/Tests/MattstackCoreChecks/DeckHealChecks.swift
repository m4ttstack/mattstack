import Foundation
@testable import MattstackCore

private typealias Tick = (healthy: Bool, hold: DeckHealHold?, at: TimeInterval)

private func policy(_ ticks: [Tick]) -> [DeckHealDecision] {
    var p = DeckHealPolicy()
    return ticks.map { p.observe(healthy: $0.healthy, hold: $0.hold, now: $0.at) }
}

private func down(_ at: TimeInterval, hold: DeckHealHold? = nil) -> Tick { (false, hold, at) }
private func up(_ at: TimeInterval) -> Tick { (true, nil, at) }
private func downEvery10s(_ range: StrideThrough<TimeInterval>) -> [Tick] { range.map { down($0) } }

let deckHealChecks: [Check] = [
    Check("deck heal: deck gets the launch settle's 30s to answer before a restart") { c in
        c.expectEqual(policy(downEvery10s(stride(from: 0, through: 30, by: 10))),
                      [.waiting, .waiting, .waiting, .heal])
    },
    Check("deck heal: a healthy probe between misses starts the clock over") { c in
        c.expectEqual(policy([down(0), down(20), up(25), down(30), down(50), down(60)]),
                      [.waiting, .waiting, .healthy, .waiting, .waiting, .heal])
    },
    Check("deck heal: after a restart deck gets another 30s to come back") { c in
        let decisions = policy(downEvery10s(stride(from: 0, through: 70, by: 10)))
        c.expectEqual(decisions, [.waiting, .waiting, .waiting, .heal, .waiting, .waiting, .waiting, .heal])
    },
    Check("deck heal: gives up after three restarts inside ten minutes") { c in
        let decisions = policy(downEvery10s(stride(from: 0, through: 160, by: 10)))
        c.expectEqual(decisions.filter { $0 == .heal }.count, 3)
        c.expectEqual(decisions.last, .gaveUp)
        c.expectEqual(decisions.firstIndex(of: .gaveUp), 15, "the fourth heal turns into gave-up")
    },
    Check("deck heal: a deck that flaps up between restarts still hits the cap") { c in
        var ticks: [Tick] = []
        for cycle in 0..<4 {
            let base = TimeInterval(cycle * 50)
            ticks += [down(base), down(base + 30), up(base + 40)]
        }
        c.expectEqual(policy(ticks).filter { $0 == .heal || $0 == .gaveUp }, [.heal, .heal, .heal, .gaveUp])
    },
    Check("deck heal: restarts older than the window stop counting") { c in
        var p = DeckHealPolicy()
        for t in stride(from: 0.0, through: 150, by: 10) { _ = p.observe(healthy: false, hold: nil, now: t) }
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 160), .gaveUp)
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 631), .heal, "the restart at 30s has aged out")
        c.expectEqual(p.attemptCount(now: 631), 3)
    },
    Check("deck heal: a healthy deck clears gave-up") { c in
        var p = DeckHealPolicy()
        for t in stride(from: 0.0, through: 160, by: 10) { _ = p.observe(healthy: false, hold: nil, now: t) }
        c.expectEqual(p.observe(healthy: true, hold: nil, now: 170), .healthy)
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 180), .waiting)
    },
    Check("deck heal: a hold never restarts, never spends an attempt, and stops the clock") { c in
        var p = DeckHealPolicy()
        for t in stride(from: 0.0, through: 100, by: 10) {
            c.expectEqual(p.observe(healthy: false, hold: .awaitingApproval, now: t), .held(.awaitingApproval))
        }
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 110), .waiting, "a lifted hold starts a fresh 30s")
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 140), .heal)
        c.expectEqual(p.attemptCount(now: 140), 1)
    },
    Check("deck heal: a manual restart clears the cap and the clock") { c in
        var p = DeckHealPolicy()
        for t in stride(from: 0.0, through: 160, by: 10) { _ = p.observe(healthy: false, hold: nil, now: t) }
        p.manualRestart()
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 170), .waiting)
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 200), .heal)
    },
    Check("deck heal: a finished restart gives deck a fresh 30s") { c in
        var p = DeckHealPolicy()
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 0), .waiting)
        p.restartFinished()
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 25), .waiting)
        c.expectEqual(p.observe(healthy: false, hold: nil, now: 55), .heal)
    },
    Check("deck status: running is quiet and names the pid; dev adds the run mode") { c in
        let prod = DeckStatusLines.status(for: .healthy, pid: "4242", runMode: nil)
        c.expectEqual(prod, "Deck: running · pid 4242")
        c.expect(DeckStatusLines.isQuiet(prod))
        c.expectEqual(DeckStatusLines.status(for: .healthy, pid: "4242", runMode: "pinned"),
                      "Deck: running · pid 4242 · pinned")
    },
    Check("deck status: deck up behind a proxy that is not answering is not quiet") { c in
        let line = DeckStatusLines.proxyDown(pid: "4242")
        c.expectEqual(line, "Deck: up (pid 4242), but deck.mattstack is not answering")
        c.expect(!DeckStatusLines.isQuiet(line))
    },
    Check("deck status: every unhealthy state reads at full contrast") { c in
        let lines = [DeckHealDecision.waiting, .heal, .gaveUp, .held(.launchSettling), .held(.awaitingApproval),
                     .held(.notRegistered), .held(.servedAppsRestarting), .held(.restartInFlight)]
            .map { DeckStatusLines.status(for: $0, pid: nil, runMode: nil) }
        c.expectEqual(lines, [
            "Deck: not responding",
            "Deck: not responding, restarting",
            "Deck: down, stopped restarting it automatically",
            "Deck: starting",
            "Deck: waiting for Login Items approval",
            "Deck: not registered",
            "Deck: restarting apps",
            "Deck: restarting",
        ])
        c.expect(lines.allSatisfy { !DeckStatusLines.isQuiet($0) })
    },
    Check("deck status: deck's api.json gives the run mode and the loopback port") { c in
        let json = Data(#"{"port":7940,"pid":1,"runMode":"source"}"#.utf8)
        c.expectEqual(DeckStatusLines.runMode(apiJSON: json), "source")
        c.expectEqual(DeckStatusLines.loopbackHealthURL(apiJSON: json), "http://127.0.0.1:7940/healthz")
        c.expectEqual(DeckStatusLines.runMode(apiJSON: Data(#"{"port":7940,"pid":1}"#.utf8)), nil)
        c.expectEqual(DeckStatusLines.runMode(apiJSON: Data("not json".utf8)), nil)
        c.expectEqual(DeckStatusLines.loopbackHealthURL(apiJSON: Data(#"{"pid":1}"#.utf8)), nil)
    },
]
