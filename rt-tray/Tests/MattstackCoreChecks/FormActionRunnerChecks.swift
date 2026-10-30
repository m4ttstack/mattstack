import Foundation
import MattstackCore

/// One ordered log the effects and the reload both write to, so a check can see a reload came last.
private final class EventLog: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [String] = []
    func append(_ s: String) { lock.lock(); entries.append(s); lock.unlock() }
    var all: [String] { lock.lock(); defer { lock.unlock() }; return entries }
}

private final class FakeEffects: FormEffects, @unchecked Sendable {
    let log: EventLog
    var granted = true
    init(log: EventLog) { self.log = log }
    @MainActor func openURL(_ url: URL) { log.append("open \(url.absoluteString)") }
    @MainActor func openSettings(_ target: String) { log.append("settings \(target)") }
    func requestPermission(_ which: String) async -> Bool { log.append("permission \(which)"); return granted }
}

/// Never answers a buffered run in time.
private final class SilentRt: RtRunning, @unchecked Sendable {
    func run(_ args: [String], stdin: Data?) async throws -> RtResult {
        try? await Task.sleep(nanoseconds: 3_000_000_000)
        return RtResult(exitCode: 0, stdout: Data(), stderr: Data())
    }
    func stream(_ args: [String], stdin: Data?) -> AsyncThrowingStream<String, Error> { AsyncThrowingStream { $0.finish() } }
}

@MainActor
private func makeRunner(_ rt: RtRunning, log: EventLog, signInTimeout: TimeInterval = FormActionRunner.signInTimeout) -> (FormActionRunner, FakeEffects) {
    let effects = FakeEffects(log: log)
    let runner = FormActionRunner(rt: rt, needs: NeedBroker(services: FakeServices(), privileged: FakePrivileged()),
                                  effects: effects, signInTimeout: signInTimeout) { log.append("reload") }
    return (runner, effects)
}

private func connectJSON(_ integration: String, _ status: String, _ detail: String) -> String {
    #"{"contract":1,"integration":"\#(integration)","status":"\#(status)","detail":"\#(detail)"}"#
}

private let slackRow = FormRow(id: "account.slack", title: "Connect Slack", subtext: "Lets mattstack track and post PRs in Slack",
                               state: .todo, detail: "",
                               action: RowAction(type: .oauth, label: "Connect Slack", integration: "slack", verb: ["setup", "slack", "connect"]),
                               waiting: "Finish connecting in your browser")

private let proxyOnly = ["setup", "apply", "--only", "proxy.install", "--json"]

let formActionRunnerChecks: [Check] = [
    Check("FormActionRunner: Connect Slack waits with rt's line, then reloads") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup slack connect --json": (0, connectJSON("slack", "ready", "Connected as janedoe"))]
        let log = EventLog()
        let (runner, _) = await makeRunner(rt, log: log)
        let seen = EventLog()
        rt.duringNextRun = { seen.append(await MainActor.run { runner.waiting["account.slack"] } ?? "nil") }
        await runner.perform(slackRow)
        c.expectEqual(rt.calls.map(\.args), [["setup", "slack", "connect", "--json"]])
        c.expectEqual(seen.all, ["Finish connecting in your browser"], "the row shows rt's waiting line while the verb runs")
        c.expectEqual(await MainActor.run { runner.waiting["account.slack"] }, nil, "a connected row stops waiting")
        c.expectEqual(await MainActor.run { runner.errors["account.slack"] }, nil)
        c.expectEqual(log.all, ["reload"])
    },
    Check("FormActionRunner: Allow runs proxy.install through the apply stream") { c in
        let rt = ScriptedRt()
        rt.streamLines = [
            #"{"event":"plan","steps":[{"id":"proxy.install","title":"Install the local HTTPS proxy","kind":"privileged"}]}"#,
            #"{"event":"step","id":"proxy.install","state":"running"}"#,
            #"{"event":"step","id":"proxy.install","state":"done"}"#,
            #"{"event":"done","ok":true,"failedStep":null}"#,
        ]
        let log = EventLog()
        let (runner, _) = await makeRunner(rt, log: log)
        let row = FormRow(id: "mac.proxy", title: "Fancy URLs", subtext: "Grant mattstack apps permission to use .mattstack",
                          state: .todo, detail: "", action: RowAction(type: .run, label: "Allow", verb: ["setup", "apply", "--only", "proxy.install"]))
        await runner.perform(row)
        c.expectEqual(rt.calls.map(\.args), [proxyOnly], "streamed once, never run buffered")
        c.expectEqual(await MainActor.run { runner.errors["mac.proxy"] }, nil)
        c.expectEqual(await MainActor.run { runner.waiting["mac.proxy"] }, nil)
        c.expectEqual(log.all, ["reload"])
    },
    Check("FormActionRunner: a failed apply step shows rt's detail on the row") { c in
        let rt = ScriptedRt()
        rt.streamLines = [
            #"{"event":"step","id":"proxy.install","state":"failed","detail":"The admin prompt was cancelled"}"#,
            #"{"event":"done","ok":false,"failedStep":"proxy.install"}"#,
        ]
        let log = EventLog()
        let (runner, _) = await makeRunner(rt, log: log)
        let row = FormRow(id: "mac.proxy", title: "Fancy URLs", subtext: "s", state: .todo, detail: "",
                          action: RowAction(type: .run, label: "Allow", verb: ["setup", "apply", "--only", "proxy.install"]))
        await runner.perform(row)
        c.expectEqual(await MainActor.run { runner.errors["mac.proxy"] }, "The admin prompt was cancelled")
        c.expectEqual(log.all, ["reload"])
    },
    Check("FormActionRunner: a rejected token shows rt's detail on the row") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup gitlab connect --json": (0, connectJSON("gitlab", "invalid", "GitLab rejected that token"))]
        let log = EventLog()
        let (runner, _) = await makeRunner(rt, log: log)
        let row = FormRow(id: "access.team-repo", title: "Create token", subtext: "s", state: .todo, detail: "",
                          action: RowAction(type: .connect, label: "Join", integration: "gitlab",
                                            fields: [ActionField(name: "token", label: "Token", secret: true)]))
        await runner.perform(row, values: ["token": "glpat-bad"])
        c.expectEqual(rt.calls.first?.stdin, #"{"token":"glpat-bad"}"#, "the token travels on stdin")
        c.expectEqual(await MainActor.run { runner.errors["access.team-repo"] }, "GitLab rejected that token")
        c.expectEqual(await MainActor.run { runner.waiting["access.team-repo"] }, nil)
        c.expectEqual(log.all, ["reload"])

        rt.answers = ["setup gitlab connect --json": (2, #"{"contract":1,"error":{"code":"bad-token","message":"That token has expired"}}"#)]
        await runner.perform(row, values: ["token": "glpat-old"])
        c.expectEqual(await MainActor.run { runner.errors["access.team-repo"] }, "That token has expired", "a user error shows its message")

        rt.answers = ["setup gitlab connect --json": (0, connectJSON("gitlab", "ready", "Connected as janedoe"))]
        await runner.perform(row, values: ["token": "glpat-good"])
        c.expectEqual(await MainActor.run { runner.errors["access.team-repo"] }, nil, "a retry that lands clears the error")
    },
    Check("FormActionRunner: a sign-in still open keeps the row waiting") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup claude connect --json": (0, connectJSON("claude", "needs-you", "Finish signing in in your browser"))]
        let log = EventLog()
        let (runner, _) = await makeRunner(rt, log: log)
        let row = FormRow(id: "account.claude", title: "Sign in to Claude", subtext: "You know, to do agentic stuff.", state: .todo, detail: "",
                          action: RowAction(type: .run, label: "Sign in to Claude", verb: ["setup", "claude", "connect"]),
                          waiting: "Signing in…", watch: true)
        await runner.perform(row)
        c.expectEqual(await MainActor.run { runner.waiting["account.claude"] }, "Finish signing in in your browser", "rt's detail is the waiting line")
        c.expectEqual(await MainActor.run { runner.errors["account.claude"] }, nil)
        c.expectEqual(log.all, ["reload"])
    },
    Check("FormActionRunner: a needs-you ConnectResult decodes") { c in
        let result = try JSONDecoder().decode(ConnectResult.self, from: Data(connectJSON("claude", "needs-you", "Finish signing in in your browser").utf8))
        c.expectEqual(result.status, .needsYou)
        c.expectEqual(result.detail, "Finish signing in in your browser")
    },
    Check("FormActionRunner: Add to Chrome opens the store and waits") { c in
        let rt = ScriptedRt()
        let log = EventLog()
        let (runner, _) = await makeRunner(rt, log: log)
        let store = "https://chromewebstore.google.com/detail/fast-browser/abc"
        let row = FormRow(id: "tool.fast-browser-extension", title: "Add to Chrome", subtext: "Lets agents drive your real Chrome",
                          state: .todo, detail: "", action: RowAction(type: .openURL, label: "Add to Chrome", url: store),
                          waiting: "Waiting for Chrome…", watch: true)
        await runner.perform(row)
        c.expectEqual(log.all, ["open \(store)", "reload"])
        c.expectEqual(await MainActor.run { runner.waiting["tool.fast-browser-extension"] }, "Waiting for Chrome…")
        c.expect(rt.calls.isEmpty, "opening a page runs no verb")
    },
    Check("FormActionRunner: a done row loses its waiting line") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup gitlab connect --json": (0, connectJSON("gitlab", "invalid", "GitLab rejected that token"))]
        let log = EventLog()
        let (runner, _) = await makeRunner(rt, log: log)
        let chrome = FormRow(id: "tool.fast-browser-extension", title: "Add to Chrome", subtext: "s", state: .todo, detail: "",
                             action: RowAction(type: .openURL, label: "Add to Chrome", url: "https://chromewebstore.google.com/x"),
                             waiting: "Waiting for Chrome…")
        let token = FormRow(id: "access.team-repo", title: "Create token", subtext: "s", state: .todo, detail: "",
                            action: RowAction(type: .connect, label: "Join", integration: "gitlab"))
        await runner.perform(chrome)
        await runner.perform(token, values: ["token": "x"])
        await MainActor.run {
            var stillWaiting = chrome
            stillWaiting.state = .waiting
            runner.reconcile(with: [stillWaiting, token])
        }
        c.expectEqual(await MainActor.run { runner.waiting["tool.fast-browser-extension"] }, "Waiting for Chrome…", "a row rt has not finished keeps waiting")
        c.expectEqual(await MainActor.run { runner.errors["access.team-repo"] }, "GitLab rejected that token")
        await MainActor.run {
            var added = chrome, connected = token
            added.state = .done; added.detail = "Added"
            connected.state = .done
            runner.reconcile(with: [added, connected])
        }
        c.expectEqual(await MainActor.run { runner.waiting["tool.fast-browser-extension"] }, nil)
        c.expectEqual(await MainActor.run { runner.errors["access.team-repo"] }, nil)
    },
    Check("FormActionRunner: notifications Allow asks macOS, then reloads") { c in
        let rt = ScriptedRt()
        let log = EventLog()
        let (runner, _) = await makeRunner(rt, log: log)
        let row = FormRow(id: "mac.notifications", title: "Notifications", subtext: "Tells you when setup is done", state: .todo, detail: "",
                          action: RowAction(type: .requestPermission, label: "Allow", which: "notifications"))
        await runner.perform(row)
        c.expectEqual(log.all, ["permission notifications", "reload"])
        c.expect(rt.calls.isEmpty)

        let fda = FormRow(id: "mac.fda", title: "Full Disk Access", subtext: "Reads your repos and Chrome's profile", state: .todo, detail: "",
                          action: RowAction(type: .openSettings, label: "Open settings", target: "fda"))
        await runner.perform(fda)
        c.expectEqual(log.all, ["permission notifications", "reload", "settings fda", "reload"])
    },
    Check("FormActionRunner: a placed repo runs rt's follow-up through the apply stream") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup repo place --json": (0, #"{"contract":1,"ok":true}"#)]
        rt.streamLines = [#"{"event":"step","id":"repos.clone","state":"done"}"#, #"{"event":"done","ok":true,"failedStep":null}"#]
        let log = EventLog()
        let (runner, _) = await makeRunner(rt, log: log)
        let row = FormRow(id: "repos.place:acme-api", title: "acme-api", subtext: "s", state: .todo, detail: "",
                          action: RowAction(type: .placeRepo, label: "Choose…", identity: "acme-api", then: ["setup", "apply", "--only", "repos.clone"]))
        await runner.perform(row, values: ["mode": "clone", "path": "/Users/janedoe/code/acme-api"])
        c.expectEqual(rt.calls.map(\.args), [["setup", "repo", "place", "--json"], ["setup", "apply", "--only", "repos.clone", "--json"]])
        c.expectEqual(log.all, ["reload"])

        rt.calls = []
        rt.answers = ["setup repo place --json": (2, #"{"contract":1,"error":{"code":"clash","message":"Another repo already lives there"}}"#)]
        await runner.perform(row, values: ["mode": "clone", "path": "/Users/janedoe/code/acme-api"])
        c.expectEqual(rt.calls.map(\.args), [["setup", "repo", "place", "--json"]], "a place rt refused runs no follow-up")
        c.expectEqual(await MainActor.run { runner.errors["repos.place:acme-api"] }, "Another repo already lives there")
    },
    Check("FormActionRunner: a sign-in rt never answers stops waiting after the timeout") { c in
        c.expect(FormActionRunner.signInTimeout > 30, "rt itself waits up to 30 s on a Claude code")
        let log = EventLog()
        let (runner, _) = await makeRunner(SilentRt(), log: log, signInTimeout: 0.05)
        let started = Date()
        await runner.perform(slackRow)
        c.expect(Date().timeIntervalSince(started) < 1, "the row waited past its timeout")
        c.expectEqual(await MainActor.run { runner.waiting["account.slack"] }, nil)
        c.expectEqual(log.all, ["reload"])
    },
]
