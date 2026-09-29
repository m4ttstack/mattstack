import Foundation
import MattstackCore

/// An admin dialog that stays up until the check answers it.
private final class HeldPrivileged: PrivilegedInstalling, @unchecked Sendable {
    private let lock = NSLock()
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var answer: NeedResult?
    private(set) var installs = 0
    private(set) var trusts = 0

    func proxyInstall() async -> NeedResult { bump { installs += 1 }; return await held() }
    func proxyTrust() async -> NeedResult { bump { trusts += 1 }; return await held() }
    func proxyRemove() async -> NeedResult { NeedResult(ok: true, detail: "") }

    func answerAll(_ result: NeedResult) {
        lock.lock(); answer = result; let w = waiters; waiters = []; lock.unlock()
        w.forEach { $0.resume() }
    }
    private func bump(_ f: () -> Void) { lock.lock(); f(); lock.unlock() }
    private func held() async -> NeedResult {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            lock.lock()
            if answer != nil { lock.unlock(); c.resume() } else { waiters.append(c); lock.unlock() }
        }
        lock.lock(); defer { lock.unlock() }; return answer!
    }
}

private let installReq = NeedRequest(type: "app-privileged", plists: nil, op: "proxy-install")
private let trustReq = NeedRequest(type: "app-privileged", plists: nil, op: "proxy-trust")

private func settle() async throws { try await Task.sleep(nanoseconds: 30_000_000) }

let needBrokerChecks: [Check] = [
    Check("NeedBroker: a call forgotten mid-flight never writes its outcome over the retry's") { c in
        let pr = HeldPrivileged()
        let broker = NeedBroker(services: FakeServices(), privileged: pr)
        let first = Task { await broker.perform(id: "proxy.install", request: installReq) }
        try await settle()
        await broker.forget(id: "proxy.install")
        pr.answerAll(NeedResult(ok: false, detail: "cancelled"))
        _ = await first.value
        c.expectEqual(await broker.outcome(id: "proxy.install").state, "pending", "rt's retry poll must not read the forgotten run's answer")
    },
    Check("NeedBroker: Retry while the admin dialog is still up joins it instead of raising a second one") { c in
        let pr = HeldPrivileged()
        let broker = NeedBroker(services: FakeServices(), privileged: pr)
        let first = Task { await broker.perform(id: "proxy.install", request: installReq) }
        try await settle()
        await broker.forgetAll()
        let retry = Task { await broker.perform(id: "proxy.install", request: installReq) }
        try await settle()
        c.expectEqual(pr.installs, 1, "one dialog on screen at a time")
        pr.answerAll(NeedResult(ok: true, detail: "proxy installed"))
        _ = await first.value
        c.expectEqual(await retry.value.detail, "proxy installed")
        c.expectEqual(pr.installs, 1)
        c.expectEqual(await broker.outcome(id: "proxy.install").state, "done")
    },
    Check("NeedBroker: a different privileged op waits for the open dialog to close before raising its own") { c in
        let pr = HeldPrivileged()
        let broker = NeedBroker(services: FakeServices(), privileged: pr)
        let first = Task { await broker.perform(id: "proxy.install", request: installReq) }
        try await settle()
        await broker.forgetAll()
        let trust = Task { await broker.perform(id: "proxy.install", request: trustReq) }
        try await settle()
        c.expectEqual(pr.trusts, 0, "the trust dialog must not open over the install dialog")
        pr.answerAll(NeedResult(ok: true, detail: "MATTSTACK_TRUST=ok"))
        _ = await first.value
        _ = await trust.value
        c.expectEqual(pr.trusts, 1)
        c.expectEqual(await broker.outcome(id: "proxy.install").state, "done")
    },
    Check("NeedBroker: forget(ids:) clears only the named ids") { c in
        let broker = NeedBroker(services: FakeServices(), privileged: FakePrivileged())
        _ = await broker.perform(id: "services.register", request: NeedRequest(type: "app-register-services", plists: [], op: nil))
        _ = await broker.perform(id: "proxy.install", request: installReq)
        await broker.forget(ids: ["proxy.install"])
        c.expectEqual(await broker.outcome(id: "proxy.install").state, "pending")
        c.expectEqual(await broker.outcome(id: "services.register").state, "done", "another run's outcome must survive a row's scoped forget")
    },
]
