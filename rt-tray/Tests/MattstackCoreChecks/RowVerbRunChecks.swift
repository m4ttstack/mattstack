import Foundation
import MattstackCore

private final class WaitingLog: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [String?] = []
    func append(_ s: String?) { lock.lock(); entries.append(s); lock.unlock() }
    var all: [String?] { lock.lock(); defer { lock.unlock() }; return entries }
}

private final class StuckPrivileged: PrivilegedInstalling, @unchecked Sendable {
    func proxyInstall() async -> NeedResult { try? await Task.sleep(nanoseconds: 3_000_000_000); return NeedResult(ok: false, detail: "late") }
    func proxyRemove() async -> NeedResult { NeedResult(ok: true, detail: "") }
    func proxyTrust() async -> NeedResult { NeedResult(ok: true, detail: "") }
}

/// Behaves like rt: after emitting a need it polls the broker, and only reports the step once the app recorded an outcome.
private final class PollingRt: RtRunning, @unchecked Sendable {
    let broker: NeedBroker
    var runs = 0
    var streams: [[String]] = []
    init(broker: NeedBroker) { self.broker = broker }
    func run(_ args: [String], stdin: Data?) async throws -> RtResult { runs += 1; return RtResult(exitCode: 1, stdout: Data(), stderr: Data()) }
    func stream(_ args: [String], stdin: Data?) -> AsyncThrowingStream<String, Error> {
        streams.append(args)
        let broker = self.broker
        return AsyncThrowingStream { cont in
            Task {
                cont.yield(proxyPlan)
                cont.yield(#"{"event":"step","id":"proxy.install","state":"running"}"#)
                cont.yield(proxyNeed)
                for _ in 0..<100 {
                    if await broker.outcome(id: "proxy.install").state == "done" {
                        cont.yield(#"{"event":"step","id":"proxy.install","state":"done","detail":"proxy installed"}"#)
                        cont.yield(#"{"event":"done","ok":true,"failedStep":null}"#)
                        cont.finish()
                        return
                    }
                    try? await Task.sleep(nanoseconds: 10_000_000)
                }
                cont.yield(#"{"event":"step","id":"proxy.install","state":"failed","detail":"timed out waiting for mattstack.app"}"#)
                cont.yield(#"{"event":"done","ok":false,"failedStep":"proxy.install"}"#)
                cont.finish()
            }
        }
    }
}

private let proxyOnly = ["setup", "apply", "--only", "proxy.install", "--json"]
private let proxyPlan = #"{"event":"plan","steps":[{"id":"proxy.install","title":"Install the local HTTPS proxy","kind":"privileged"}]}"#
private let proxyNeed = #"{"event":"need","id":"proxy.install","request":{"type":"app-privileged","op":"proxy-install"}}"#

let rowVerbRunChecks: [Check] = [
    Check("only setup apply rows stream apply events; every other row verb keeps the buffered run") { c in
        c.expect(RowVerbRun.streamsApplyEvents(proxyOnly))
        c.expect(RowVerbRun.streamsApplyEvents(["setup", "apply", "--only", "path.link", "--json"]))
        c.expect(!RowVerbRun.streamsApplyEvents(["setup", "status", "--json"]))
        c.expect(!RowVerbRun.streamsApplyEvents(["tools", "setup", "herdr", "--json"]))
    },
    Check("a proxy.install row run answers its need through the broker and says it is waiting on the admin password meanwhile") { c in
        let privileged = FakePrivileged()
        let broker = NeedBroker(services: FakeServices(), privileged: privileged)
        let rt = PollingRt(broker: broker)
        let waiting = WaitingLog()
        let failure = await RowVerbRun.apply(proxyOnly, rt: rt, needs: broker) { waiting.append($0) }
        c.expectEqual(failure, nil)
        c.expectEqual(rt.streams, [proxyOnly], "the apply verb is streamed once")
        c.expectEqual(rt.runs, 0, "never also run buffered")
        c.expectEqual(privileged.calls, 1, "the admin prompt must actually be raised; a buffered run never raised it")
        c.expectEqual(await broker.outcome(id: "proxy.install").state, "done", "rt polls this outcome until it is recorded")
        c.expect(waiting.all.contains(NeedRequest(type: "app-privileged", plists: nil, op: "proxy-install").waitingCopy),
                 "the row must say it is waiting on the user while the prompt is up; got \(waiting.all)")
        c.expectEqual(waiting.all.last, .some(nil), "the waiting line clears once rt moves on")
    },
    Check("a timed-out need fails the row with rt's own detail and remedy instead of spinning") { c in
        let rt = ScriptedRt()
        rt.streamLines = [
            proxyPlan,
            proxyNeed,
            #"{"event":"step","id":"proxy.install","state":"failed","detail":"timed out waiting for mattstack.app","remedy":"Retry with mattstack.app running"}"#,
            #"{"event":"done","ok":false,"failedStep":"proxy.install"}"#,
        ]
        let broker = NeedBroker(services: FakeServices(), privileged: StuckPrivileged())
        let started = Date()
        let failure = await RowVerbRun.apply(proxyOnly, rt: rt, needs: broker) { _ in }
        c.expectEqual(failure, "timed out waiting for mattstack.app. Retry with mattstack.app running")
        c.expect(Date().timeIntervalSince(started) < 1.5, "a prompt still open when rt gives up must not hold the row past rt's done")
    },
    Check("an exit-2 envelope before any event fails the row with rt's message") { c in
        let rt = ScriptedRt()
        rt.streamLines = [#"{"contract":1,"error":{"code":"unknown-step","message":"unknown --only step id \"x\""}}"#]
        let broker = NeedBroker(services: FakeServices(), privileged: FakePrivileged())
        let failure = await RowVerbRun.apply(["setup", "apply", "--only", "x", "--json"], rt: rt, needs: broker) { _ in }
        c.expectEqual(failure, #"unknown --only step id "x""#)
    },
    Check("a stream that ends without a done event is a failure, not a success") { c in
        let rt = ScriptedRt()
        rt.streamLines = [proxyPlan]
        let broker = NeedBroker(services: FakeServices(), privileged: FakePrivileged())
        let failure = await RowVerbRun.apply(proxyOnly, rt: rt, needs: broker) { _ in }
        c.expect(failure != nil)
    },
]
