import Foundation
@testable import MattstackCore

private let up = AppHealth(answering: true, token: "a", buildId: "b1")
private let upNewProcess = AppHealth(answering: true, token: "b", buildId: "b1")
private let down = AppHealth(answering: false, token: nil, buildId: nil)

private func run(_ events: [TabEvent], from start: TabState = TabState()) -> (TabState, [TabEffect]) {
    var state = start
    var effects: [TabEffect] = []
    for event in events {
        let (next, emitted) = TabReadiness.reduce(state, event)
        state = next
        effects = emitted
    }
    return (state, effects)
}

private func reloads(_ events: [TabEvent], from start: TabState = TabState()) -> Int {
    var state = start
    var count = 0
    for event in events {
        let (next, emitted) = TabReadiness.reduce(state, event)
        state = next
        count += emitted.filter { $0 == .reload }.count
    }
    return count
}

private let readyTab = run([.navigationStarted(byRecovery: false), .signal(.booting),
                            .navigationFinished, .signal(.ready(buildId: "b1"))]).0

private let failedTab = run([.navigationStarted(byRecovery: false),
                             .navigationFailed(reason: "502")]).0

let tabReadinessChecks: [Check] = [
    Check("tab readiness: a navigation start goes to loading and resets what the last page said") { c in
        var dirty = readyTab
        dirty.stale = true
        let (state, effects) = TabReadiness.reduce(dirty, .navigationStarted(byRecovery: false))
        c.expectEqual(state.phase, .loading)
        c.expect(!state.speaksProtocol)
        c.expectEqual(state.buildId, nil)
        c.expect(!state.stale)
        c.expectEqual(effects, [.cancelBackstop])
    },
    Check("tab readiness: a recovery navigation keeps the reload credit; any other clears it") { c in
        var credited = TabState()
        credited.reloadCredit = true
        c.expect(TabReadiness.reduce(credited, .navigationStarted(byRecovery: true)).0.reloadCredit)
        c.expect(!TabReadiness.reduce(credited, .navigationStarted(byRecovery: false)).0.reloadCredit)
    },
    Check("tab readiness: booting marks the page as speaking the protocol") { c in
        let (state, effects) = run([.navigationStarted(byRecovery: false), .signal(.booting)])
        c.expect(state.speaksProtocol)
        c.expectEqual(state.phase, .loading)
        c.expectEqual(effects, [])
    },
    Check("tab readiness: WebKit finishing a page that does not speak the protocol makes it ready") { c in
        let (state, effects) = run([.navigationStarted(byRecovery: false), .navigationFinished])
        c.expectEqual(state.phase, .ready)
        c.expectEqual(effects, [])
    },
    Check("tab readiness: WebKit finishing a speaking page that is still loading starts the backstop") { c in
        let (state, effects) = run([.navigationStarted(byRecovery: false), .signal(.booting), .navigationFinished])
        c.expectEqual(state.phase, .loading)
        c.expectEqual(effects, [.startBackstop])
    },
    Check("tab readiness: WebKit finishing after ready changes nothing") { c in
        let (state, effects) = run([.navigationStarted(byRecovery: false), .signal(.booting),
                                    .signal(.ready(buildId: "b1")), .navigationFinished])
        c.expectEqual(state.phase, .ready)
        c.expectEqual(effects, [])
    },
    Check("tab readiness: ready makes the tab ready with its build id and cancels the backstop") { c in
        let (state, effects) = run([.navigationStarted(byRecovery: false), .signal(.booting),
                                    .navigationFinished, .signal(.ready(buildId: "b1"))])
        c.expectEqual(state.phase, .ready)
        c.expectEqual(state.buildId, "b1")
        c.expectEqual(effects, [.cancelBackstop])
    },
    Check("tab readiness: a failed signal, a failed navigation or the backstop while loading makes the tab not ready") { c in
        let failures: [TabEvent] = [.signal(.failed(reason: "stylesheet x")), .navigationFailed(reason: "502"),
                                    .backstopElapsed]
        for failure in failures {
            var start = TabState()
            start.lastHealth = up
            let (state, effects) = run([.navigationStarted(byRecovery: false), .signal(.booting), failure],
                                       from: start)
            guard case .notReady = state.phase else { c.fail("\(failure) gave \(state.phase)"); continue }
            c.expectEqual(state.lastHealth, nil, "\(failure)")
            c.expect(state.reloadCredit, "\(failure) sets the credit")
            c.expectEqual(effects, [.cancelBackstop], "\(failure)")
        }
        let (named, _) = run([.navigationStarted(byRecovery: false), .navigationFailed(reason: "502")])
        c.expectEqual(named.phase, .notReady(reason: "502"))
    },
    Check("tab readiness: a failed recovery navigation sets no credit and keeps the last health") { c in
        var start = TabState()
        start.lastHealth = up
        let (state, _) = run([.navigationStarted(byRecovery: true), .navigationFailed(reason: "502")], from: start)
        c.expectEqual(state.phase, .notReady(reason: "502"))
        c.expect(!state.reloadCredit)
        c.expectEqual(state.lastHealth, up)
    },
    Check("tab readiness: fatal makes the tab fatal with the same credit rule") { c in
        let (state, _) = run([.navigationStarted(byRecovery: false), .signal(.booting), .signal(.fatal)])
        c.expectEqual(state.phase, .fatal)
        c.expect(state.reloadCredit)
        let (recovered, _) = run([.navigationStarted(byRecovery: true), .signal(.booting), .signal(.fatal)])
        c.expectEqual(recovered.phase, .fatal)
        c.expect(!recovered.reloadCredit)
    },
    Check("tab readiness: a not-ready tab with credit reloads once its app answers, and spends the credit") { c in
        let (state, effects) = TabReadiness.reduce(failedTab, .health(up))
        c.expectEqual(effects, [.reload])
        c.expect(!state.reloadCredit)
        c.expectEqual(state.lastHealth, up)
    },
    Check("tab readiness: a not-ready tab never reloads while its app does not answer, but remembers it") { c in
        let (state, effects) = TabReadiness.reduce(failedTab, .health(down))
        c.expectEqual(effects, [])
        c.expectEqual(state.lastHealth, down)
    },
    Check("tab readiness: a not-ready tab reloads when its app goes from not answering to answering") { c in
        var start = failedTab
        start.reloadCredit = false
        start.lastHealth = down
        c.expectEqual(TabReadiness.reduce(start, .health(up)).1, [.reload])
    },
    Check("tab readiness: a not-ready tab reloads when its app's token changes") { c in
        var start = failedTab
        start.reloadCredit = false
        start.lastHealth = up
        c.expectEqual(TabReadiness.reduce(start, .health(up)).1, [])
        c.expectEqual(TabReadiness.reduce(start, .health(upNewProcess)).1, [.reload])
    },
    Check("tab readiness: no last health never counts as the app having been down") { c in
        var start = failedTab
        start.reloadCredit = false
        start.lastHealth = nil
        c.expectEqual(TabReadiness.reduce(start, .health(up)).1, [])
    },
    Check("tab readiness: a fatal tab follows the same reload rule") { c in
        let fatal = run([.navigationStarted(byRecovery: false), .signal(.booting), .signal(.fatal)]).0
        c.expectEqual(TabReadiness.reduce(fatal, .health(up)).1, [.reload])
    },
    Check("tab readiness: a ready tab is stale only when both build ids exist and differ") { c in
        let (newer, effects) = TabReadiness.reduce(readyTab, .health(AppHealth(answering: true, token: "a", buildId: "b2")))
        c.expect(newer.stale)
        c.expectEqual(effects, [])
        let (same, _) = TabReadiness.reduce(newer, .health(up))
        c.expect(!same.stale)
    },
    Check("tab readiness: the backstop after the page settled does nothing") { c in
        let (ready, readyEffects) = TabReadiness.reduce(readyTab, .backstopElapsed)
        c.expectEqual(ready, readyTab)
        c.expectEqual(readyEffects, [])
        let (failed, failedEffects) = TabReadiness.reduce(failedTab, .backstopElapsed)
        c.expectEqual(failed, failedTab)
        c.expectEqual(failedEffects, [])
    },
    Check("tab readiness: the overlay follows the phase") { c in
        var state = TabState()
        c.expectEqual(TabReadiness.overlay(state), .loading)
        state.phase = .ready
        c.expectEqual(TabReadiness.overlay(state), TabOverlay.none)
        state.phase = .notReady(reason: "x")
        c.expectEqual(TabReadiness.overlay(state), .failure)
        state.phase = .fatal
        c.expectEqual(TabReadiness.overlay(state), TabOverlay.none)
    },
    Check("tab readiness: an app that is up but serves a broken page gets one reload, then waits") { c in
        let events: [TabEvent] = [
            .navigationStarted(byRecovery: false), .signal(.booting), .signal(.failed(reason: "stylesheet")),
            .health(up),
            .navigationStarted(byRecovery: true), .signal(.booting), .signal(.failed(reason: "stylesheet")),
            .health(up), .health(up), .health(up),
        ]
        c.expectEqual(reloads(events), 1)
        let (state, _) = run(events)
        c.expectEqual(state.phase, .notReady(reason: "stylesheet"))
    },
    Check("tab readiness: a tab that failed during an outage reloads each time the app comes back") { c in
        let events: [TabEvent] = [
            .navigationStarted(byRecovery: false), .navigationFailed(reason: "502"),
            .health(down), .health(down), .health(up),
            .navigationStarted(byRecovery: true), .navigationFailed(reason: "502"),
            .health(down), .health(up),
            .navigationStarted(byRecovery: true), .navigationFailed(reason: "502"),
            .health(up), .health(down), .health(down), .health(up),
        ]
        c.expectEqual(reloads(events), 3)
    },
    Check("tab readiness: a new process token reloads a tab that already used its credit") { c in
        let events: [TabEvent] = [
            .navigationStarted(byRecovery: false), .signal(.booting), .signal(.failed(reason: "stylesheet")),
            .health(up),
            .navigationStarted(byRecovery: true), .signal(.booting), .signal(.failed(reason: "stylesheet")),
            .health(up), .health(upNewProcess),
        ]
        c.expectEqual(reloads(events), 2)
    },
    Check("tab readiness: a full navigation from a ready tab goes back to loading and ready again") { c in
        let (loading, startEffects) = TabReadiness.reduce(readyTab, .navigationStarted(byRecovery: false))
        c.expectEqual(loading.phase, .loading)
        c.expectEqual(startEffects, [.cancelBackstop])
        c.expectEqual(TabReadiness.overlay(loading), .loading)
        let (ready, _) = run([.signal(.booting), .navigationFinished, .signal(.ready(buildId: "b2"))], from: loading)
        c.expectEqual(ready.phase, .ready)
        c.expectEqual(ready.buildId, "b2")
    },
    Check("tab readiness: a page that never sends booting is ready when WebKit finishes") { c in
        let (state, effects) = run([.navigationStarted(byRecovery: false), .navigationFinished])
        c.expectEqual(state.phase, .ready)
        c.expect(!effects.contains(.startBackstop))
        c.expectEqual(TabReadiness.overlay(state), TabOverlay.none)
    },
    Check("tab readiness: a missing build id on either side never marks the tab stale") { c in
        let noPageBuild = run([.navigationStarted(byRecovery: false), .signal(.booting),
                               .signal(.ready(buildId: nil))]).0
        c.expect(!TabReadiness.reduce(noPageBuild, .health(up)).0.stale)
        var stale = readyTab
        stale.stale = true
        c.expect(TabReadiness.reduce(stale, .health(AppHealth(answering: true, token: "a", buildId: nil))).0.stale,
                 "a missing server build id leaves stale as it was")
        c.expect(!TabReadiness.reduce(readyTab, .health(AppHealth(answering: true, token: "a", buildId: nil))).0.stale)
    },
    Check("tab readiness: the health loop runs while any tab is not ready or fatal") { c in
        var fatal = TabState()
        fatal.phase = .fatal
        var loading = TabState()
        loading.phase = .loading
        c.expect(!TabReadiness.needsHealthLoop([]))
        c.expect(!TabReadiness.needsHealthLoop([readyTab, loading]))
        c.expect(TabReadiness.needsHealthLoop([readyTab, failedTab]))
        c.expect(TabReadiness.needsHealthLoop([readyTab, fatal]))
    },
    Check("tab readiness: ready, failed or fatal before the new page's booting changes nothing") { c in
        let (loading, _) = TabReadiness.reduce(readyTab, .navigationStarted(byRecovery: false))
        let leftovers: [TabEvent] = [.signal(.ready(buildId: "b1")), .signal(.failed(reason: "x")), .signal(.fatal)]
        for leftover in leftovers {
            let (state, effects) = TabReadiness.reduce(loading, leftover)
            c.expectEqual(state, loading, "\(leftover)")
            c.expectEqual(effects, [], "\(leftover)")
        }
    },
    Check("tab readiness: a failed signal or a failed navigation on a ready tab is ignored") { c in
        for event in [TabEvent.signal(.failed(reason: "x")), .navigationFailed(reason: "502")] {
            let (state, effects) = TabReadiness.reduce(readyTab, event)
            c.expectEqual(state, readyTab, "\(event)")
            c.expectEqual(effects, [], "\(event)")
        }
    },
    Check("tab readiness: WebKit finishing a not-ready or fatal tab changes nothing") { c in
        let fatal = run([.navigationStarted(byRecovery: false), .signal(.booting), .signal(.fatal)]).0
        for start in [failedTab, fatal] {
            let (state, effects) = TabReadiness.reduce(start, .navigationFinished)
            c.expectEqual(state, start)
            c.expectEqual(effects, [])
        }
    },
    Check("tab readiness: fatal cancels the backstop") { c in
        let (_, effects) = run([.navigationStarted(byRecovery: false), .signal(.booting), .navigationFinished,
                                .signal(.fatal)])
        c.expectEqual(effects, [.cancelBackstop])
    },
    Check("tab readiness: the reload credit survives an app that does not answer") { c in
        let (state, _) = run([.health(down), .health(down)], from: failedTab)
        c.expect(state.reloadCredit)
        c.expectEqual(TabReadiness.reduce(state, .health(up)).1, [.reload])
    },
    Check("host signal: parses the four messages and rejects anything else") { c in
        c.expectEqual(HostSignal.parse(["type": "booting"]), .booting)
        c.expectEqual(HostSignal.parse(["type": "ready", "buildId": "abc"]), .ready(buildId: "abc"))
        c.expectEqual(HostSignal.parse(["type": "ready", "buildId": NSNull()]), .ready(buildId: nil))
        c.expectEqual(HostSignal.parse(["type": "ready"]), .ready(buildId: nil))
        c.expectEqual(HostSignal.parse(["type": "failed", "reason": "stylesheet x"]), .failed(reason: "stylesheet x"))
        c.expectEqual(HostSignal.parse(["type": "fatal"]), .fatal)
        c.expectEqual(HostSignal.parse(["type": "ready", "buildId": 42]), nil)
        c.expectEqual(HostSignal.parse(["type": "failed"]), nil)
        c.expectEqual(HostSignal.parse(["type": "hello"]), nil)
        c.expectEqual(HostSignal.parse(["kind": "booting"]), nil)
        c.expectEqual(HostSignal.parse("booting"), nil)
        c.expectEqual(HostSignal.parse(NSNull()), nil)
    },
]
