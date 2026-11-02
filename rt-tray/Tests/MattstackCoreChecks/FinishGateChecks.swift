import Foundation
import MattstackCore

/// A plan source the check releases by hand, so a fetch can be observed
/// while it is still in flight. Requests are held in arrival order and can
/// be answered oldest- or newest-first, which is how out-of-order replies
/// are staged. An answer given before any request is waiting is kept for
/// the next one, so a release can never be lost to a timing gap.
final class HeldPlans: PlanSource, @unchecked Sendable {
    private let lock = NSLock()
    private var waiters: [CheckedContinuation<Plan, Error>] = []
    private var pending: [Result<Plan, Error>] = []
    private var fetchCount = 0
    var fetches: Int { lock.lock(); defer { lock.unlock() }; return fetchCount }
    func fetchPlan() async throws -> Plan {
        try await withCheckedThrowingContinuation { cont in
            lock.lock()
            fetchCount += 1
            if !pending.isEmpty {
                let answer = pending.removeFirst()
                lock.unlock()
                cont.resume(with: answer)
                return
            }
            waiters.append(cont)
            lock.unlock()
        }
    }
    /// Answers every waiting request (or the next one to arrive).
    func release(_ plan: Plan) {
        lock.lock()
        let ws = waiters; waiters = []
        if ws.isEmpty { pending.append(.success(plan)) }
        lock.unlock()
        ws.forEach { $0.resume(returning: plan) }
    }
    func releaseOldest(_ plan: Plan) { answer(.success(plan), newest: false) }
    func releaseNewest(_ plan: Plan) { answer(.success(plan), newest: true) }
    func failOldest(_ error: Error) { answer(.failure(error), newest: false) }
    private func answer(_ result: Result<Plan, Error>, newest: Bool) {
        lock.lock()
        guard !waiters.isEmpty else { pending.append(result); lock.unlock(); return }
        let w = newest ? waiters.removeLast() : waiters.removeFirst()
        lock.unlock()
        w.resume(with: result)
    }
}

/// True once `cond` held; false when it never did within the budget, so a
/// caller can fail its check instead of releasing into a waiter that never
/// registered and hanging on the task it spawned.
func waitUntil(_ cond: @escaping @MainActor () -> Bool, tries: Int = 200) async -> Bool {
    for _ in 0..<tries {
        if await MainActor.run(body: cond) { return true }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
    return false
}

let finishGateChecks: [Check] = [
    Check("finish gate copy is pinned byte for byte") { c in
        c.expectEqual(NeedBadge.beforeFinish.rawValue, "Before you finish")
        c.expectEqual(FinishGate.skipRowButton, "Skip")
    },
    Check("WaiverClient.waive runs rt setup waive <id> --json; a refusal comes back as rt's message") { c in
        let rt = ScriptedRt()
        rt.answers["setup waive tool.fast-browser-extension --json"] = (0, #"{"contract":1,"at":"t","ok":true,"id":"tool.fast-browser-extension","waived":["tool.fast-browser-extension"]}"#)
        rt.answers["setup waive tool.proxy --json"] = (2, #"{"contract":1,"at":"t","error":{"code":"not-finish-gated","message":"nope"}}"#)
        let waivers = await MainActor.run { WaiverClient(rt: rt) }
        c.expectEqual(await waivers.waive("tool.fast-browser-extension"), nil)
        c.expectEqual(await waivers.waive("tool.proxy"), "nope")
        c.expectEqual(rt.calls.map(\.args), [["setup", "waive", "tool.fast-browser-extension", "--json"], ["setup", "waive", "tool.proxy", "--json"]])
    },
    Check("WaiverClient.unwaive runs rt setup unwaive <id> --json and nothing else: the caller owns the re-read") { c in
        let rt = ScriptedRt()
        rt.answers["setup unwaive tool.fast-browser-extension --json"] = (0, #"{"contract":1,"at":"t","ok":true,"id":"tool.fast-browser-extension","waived":[]}"#)
        let plans = FakePlans([makeManualPlan(extensionStatus: .needsYou, waived: true), makeManualPlan(extensionStatus: .needsYou)])
        let readiness = await MainActor.run { ReadinessModel(plans: plans, permissions: FakePermissions(), ticker: FakeTicker()) }
        await readiness.load()
        let waivers = await MainActor.run { WaiverClient(rt: rt) }
        let err = await waivers.unwaive("tool.fast-browser-extension")
        c.expectEqual(err, nil)
        c.expectEqual(rt.calls.map(\.args), [["setup", "unwaive", "tool.fast-browser-extension", "--json"]])
        c.expectEqual(plans.fetches, 1, "no unbounded refresh hides inside the verb")
        await MainActor.run { c.expectEqual(readiness.finishBlockedBy, [], "the plan is untouched until the caller re-reads it") }
    },
    Check("ChoiceClient: nil on success; the exit-2 envelope's message on refusal") { c in
        let rt = ScriptedRt()
        rt.answers["skills writing-style use a"] = (0, #"{"contract":1,"at":"x","skill":"a","scope":"user"}"#)
        rt.answers["skills writing-style use -rf"] = (2, #"{"contract":1,"at":"x","error":{"code":"bad-id","message":"\"-rf\" is not a skill id"}}"#)
        let client = await ChoiceClient(rt: rt)
        c.expect(await client.choose(verb: ["skills", "writing-style", "use"], id: "a") == nil)
        c.expectEqual(await client.choose(verb: ["skills", "writing-style", "use"], id: "-rf"), "\"-rf\" is not a skill id")
        c.expectEqual(rt.calls.last?.args, ["skills", "writing-style", "use", "-rf", "--json"])
    },
    Check("ChoiceClient: an empty verb refuses without spawning rt") { c in
        let rt = ScriptedRt()
        let client = await ChoiceClient(rt: rt)
        let failure = await client.choose(verb: [], id: "a")
        c.expect(failure != nil, "a nonconforming rt with no verb on the row must never be run")
        c.expectEqual(rt.calls.count, 0, "must not spawn rt <id> --json when the verb is empty")
    },
]
