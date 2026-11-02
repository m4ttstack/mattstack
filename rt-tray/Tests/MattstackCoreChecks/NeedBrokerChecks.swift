import Foundation
import MattstackCore

/// An admin dialog that stays up until the check answers it.
private final class HeldPrivileged: PrivilegedInstalling, @unchecked Sendable {
    private let lock = NSLock()
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var answer: NeedResult?
    private(set) var installs = 0
    private(set) var trusts = 0
    private(set) var installFlags: [Bool] = []

    func proxyInstall(homebrew: Bool) async -> NeedResult { bump { installs += 1; installFlags.append(homebrew) }; return await held() }
    func proxyTrust(homebrew: Bool) async -> NeedResult { bump { trusts += 1 }; return await held() }
    func proxyRemove() async -> NeedResult { NeedResult(ok: true, detail: "") }
    func homebrew() async -> NeedResult { await held() }

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
        return answered()
    }
    private func answered() -> NeedResult { lock.lock(); defer { lock.unlock() }; return answer! }
}

private let installReq = NeedRequest(type: "app-privileged", plists: nil, op: "proxy-install")
private let trustReq = NeedRequest(type: "app-privileged", plists: nil, op: "proxy-trust")
private let installWithBrewReq = NeedRequest(type: "app-privileged", plists: nil, op: "proxy-install", homebrew: true)

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
    // A terminal `rt setup apply` reaches the privileged routes directly, and
    // may do so while the app's own Install already has the dialog up.
    Check("TrayRoutes: the direct privileged routes share the broker's one admin dialog") { c in
        let pr = HeldPrivileged()
        let services = FakeServices()
        let broker = NeedBroker(services: services, privileged: pr)
        let routes = TrayRoutes(permissions: FakePerms(), services: services, needs: broker, updater: FakeUpdater(),
                                version: FakeVersion(), window: FakeWindowOpener())
        let need = Task { await broker.perform(id: "proxy.install", request: installReq) }
        try await settle()
        let direct = Task { await routes.handle(method: "POST", path: "/privileged/proxy-install", body: nil) }
        let trust = Task { await routes.handle(method: "POST", path: "/privileged/proxy-trust", body: nil) }
        try await settle()
        c.expectEqual(pr.installs, 1, "the direct install joins the open dialog")
        c.expectEqual(pr.trusts, 0, "the direct trust waits for the open dialog to close")
        pr.answerAll(NeedResult(ok: true, detail: "proxy installed"))
        _ = await need.value
        let reply = try c.requireSome(await direct.value)
        c.expectEqual(json(reply.body)["detail"] as? String, "proxy installed")
        _ = await trust.value
        c.expectEqual(pr.trusts, 1)
        c.expectEqual(await broker.outcome(id: "proxy.install").state, "done", "a direct call never touches a need id's outcome")
    },
    Check("NeedBroker: a proxy install with homebrew passes the flag") { c in
        let pr = FakePrivileged()
        let broker = NeedBroker(services: FakeServices(), privileged: pr)
        _ = await broker.perform(id: "proxy.install", request: installWithBrewReq)
        _ = await broker.perform(id: "proxy.trust", request: NeedRequest(type: "app-privileged", plists: nil, op: "proxy-trust", homebrew: true))
        _ = await broker.perform(id: "proxy.plain", request: installReq)
        c.expectEqual(pr.installFlags, [true, false], "absent reads as not asked")
        c.expectEqual(pr.trustFlags, [true])
        c.expectEqual(pr.homebrews, 0, "the flag rides the proxy op's own prompt, never a second one")
    },
    // rt reads a refusal of op homebrew as the person declining Homebrew, so
    // the op must reach the helper rather than the unknown-need answer.
    Check("NeedBroker: the homebrew op runs the helper's homebrew verb") { c in
        let pr = FakePrivileged()
        let broker = NeedBroker(services: FakeServices(), privileged: pr)
        let result = await broker.perform(id: "proxy.install", request: NeedRequest(type: "app-privileged", plists: nil, op: "homebrew"))
        c.expectEqual(pr.homebrews, 1)
        c.expectEqual(pr.calls, 0, "Homebrew alone never reinstalls the proxy")
        c.expectEqual(pr.trusts, 0)
        c.expectEqual(result, NeedResult(ok: true, detail: "homebrew: ok\nMATTSTACK_HOMEBREW=ok"))
        c.expectEqual(await broker.outcome(id: "proxy.install").state, "done")
    },
    // Joining would hand back a reply with no Homebrew line, which rt records
    // as a Homebrew failure and never asks about again.
    Check("NeedBroker: an install that asks for Homebrew waits out an open one that does not") { c in
        let pr = HeldPrivileged()
        let broker = NeedBroker(services: FakeServices(), privileged: pr)
        let plain = Task { await broker.perform(id: "proxy.install", request: installReq) }
        try await settle()
        await broker.forgetAll()
        let withBrew = Task { await broker.perform(id: "proxy.install", request: installWithBrewReq) }
        try await settle()
        c.expectEqual(pr.installs, 1, "one dialog on screen at a time")
        pr.answerAll(NeedResult(ok: true, detail: "MATTSTACK_TRUST=ok"))
        _ = await plain.value
        _ = await withBrew.value
        c.expectEqual(pr.installFlags, [false, true])
    },
    Check("NeedBroker: a retry without Homebrew joins an open install that already asks for it") { c in
        let pr = HeldPrivileged()
        let broker = NeedBroker(services: FakeServices(), privileged: pr)
        let withBrew = Task { await broker.perform(id: "proxy.install", request: installWithBrewReq) }
        try await settle()
        await broker.forgetAll()
        let plain = Task { await broker.perform(id: "proxy.install", request: installReq) }
        try await settle()
        pr.answerAll(NeedResult(ok: true, detail: "MATTSTACK_HOMEBREW=ok\nMATTSTACK_TRUST=ok"))
        _ = await withBrew.value
        c.expectEqual(await plain.value.detail, "MATTSTACK_HOMEBREW=ok\nMATTSTACK_TRUST=ok")
        c.expectEqual(pr.installFlags, [true])
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
