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

/// Fails every buffered run with the same exit and stderr.
private final class EchoRt: RtRunning, @unchecked Sendable {
    let exitCode: Int32
    let stderr: String
    init(exitCode: Int32, stderr: String) { self.exitCode = exitCode; self.stderr = stderr }
    func run(_ args: [String], stdin: Data?) async throws -> RtResult {
        RtResult(exitCode: exitCode, stdout: Data(), stderr: Data(stderr.utf8))
    }
    func stream(_ args: [String], stdin: Data?) -> AsyncThrowingStream<String, Error> { AsyncThrowingStream { $0.finish() } }
}

/// Answers every buffered run after a delay.
private final class SlowRt: RtRunning, @unchecked Sendable {
    let after: TimeInterval
    let stdout: String
    private let lock = NSLock()
    private var count = 0
    init(after: TimeInterval, stdout: String) { self.after = after; self.stdout = stdout }
    var answered: Int { lock.withLock { count } }
    func run(_ args: [String], stdin: Data?) async throws -> RtResult {
        try? await Task.sleep(nanoseconds: UInt64(after * 1_000_000_000))
        lock.withLock { count += 1 }
        return RtResult(exitCode: 0, stdout: Data(stdout.utf8), stderr: Data())
    }
    func stream(_ args: [String], stdin: Data?) -> AsyncThrowingStream<String, Error> { AsyncThrowingStream { $0.finish() } }
}

@MainActor
private final class RunnerBox { var runner: FormActionRunner? }

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
    Check("FormActionRunner: a verb that carried a secret on stdin never shows rt's stderr, which could echo it") { c in
        let secret = "glpat-placeholder-secret"
        let row = FormRow(id: "forge", title: "GitLab", subtext: "s", state: .todo, detail: "",
                          action: RowAction(type: .connect, label: "Connect", integration: "gitlab",
                                            fields: [ActionField(name: "token", label: "Token", secret: true)]))
        for code: Int32 in [1, 2] {
            let rt = EchoRt(exitCode: code, stderr: "rejected token \(secret)")
            let (runner, _) = await makeRunner(rt, log: EventLog())
            await runner.perform(row, values: ["token": secret])
            let shown = await MainActor.run { runner.errors["forge"] } ?? ""
            c.expect(!shown.isEmpty, "exit \(code) still says it failed")
            c.expect(!shown.contains(secret), "exit \(code) showed: \(shown)")
        }
        let plain = FormRow(id: "doppler", title: "Doppler", subtext: "s", state: .todo, detail: "",
                            action: RowAction(type: .run, label: "Sign in", verb: ["tools", "install", "doppler"]))
        let (runner, _) = await makeRunner(EchoRt(exitCode: 1, stderr: "download failed"), log: EventLog())
        await runner.perform(plain)
        c.expect((await MainActor.run { runner.errors["doppler"] } ?? "").contains("download failed"), "a verb with nothing on stdin keeps rt's own words")
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
    Check("FormActionRunner: Sign in to GitHub opens the device page rt names, once") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup github sign-in --json": (0, #"{"contract":1,"integration":"github","status":"needs-you","userCode":"ABCD-1234","url":"https://github.com/login/device"}"#)]
        let log = EventLog()
        let (runner, _) = await makeRunner(rt, log: log)
        let row = FormRow(id: "settings.remote", title: "Remote repo", subtext: "s", state: .todo, detail: "",
                          action: RowAction(type: .run, label: "Sign in to GitHub", verb: ["setup", "github", "sign-in"]))
        await runner.perform(row)
        c.expectEqual(log.all, ["open https://github.com/login/device", "reload"])
        c.expectEqual(await MainActor.run { runner.errors["settings.remote"] }, nil)
    },
    Check("FormActionRunner: a GitHub sign-in rt never answers stops waiting after the sign-in timeout") { c in
        let log = EventLog()
        let (runner, _) = await makeRunner(SilentRt(), log: log, signInTimeout: 0.05)
        let row = FormRow(id: "settings.remote", title: "Remote repo", subtext: "s", state: .todo, detail: "",
                          action: RowAction(type: .run, label: "Sign in to GitHub", verb: ["setup", "github", "sign-in"]))
        let started = Date()
        await runner.perform(row)
        c.expect(Date().timeIntervalSince(started) < 1, "the GitHub sign-in waited past its timeout")
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
        let row = FormRow(id: "claude", title: "Claude", subtext: "s", state: .todo, detail: "",
                          action: RowAction(type: .run, label: "Sign in to Claude", verb: ["setup", "claude", "connect"]), waiting: "Signing in…")
        let started = Date()
        await runner.perform(row)
        c.expect(Date().timeIntervalSince(started) < 1, "the row waited past its timeout")
        c.expectEqual(await MainActor.run { runner.waiting["claude"] }, nil)
        c.expectEqual(log.all, ["reload"])
    },
    Check("FormActionRunner: Connect Slack outlasts the sign-in timeout, since rt listens for 5 minutes") { c in
        c.expect(FormActionRunner.oauthTimeout > 300, "longer than rt's own 5-minute callback listener")
        let rt = SlowRt(after: 0.3, stdout: connectJSON("slack", "ready", "Connected as janedoe"))
        let log = EventLog()
        let effects = FakeEffects(log: log)
        let runner = await FormActionRunner(rt: rt, needs: NeedBroker(services: FakeServices(), privileged: FakePrivileged()),
                                            effects: effects, signInTimeout: 0.05, oauthTimeout: 5) { log.append("reload") }
        await runner.perform(slackRow)
        c.expectEqual(await MainActor.run { runner.waiting["account.slack"] }, nil)
        c.expectEqual(await MainActor.run { runner.errors["account.slack"] }, nil, "Slack's answer landed instead of being dropped at the sign-in timeout")
        c.expectEqual(rt.answered, 1)

        let silent = await FormActionRunner(rt: SilentRt(), needs: NeedBroker(services: FakeServices(), privileged: FakePrivileged()),
                                            effects: effects, signInTimeout: 5, oauthTimeout: 0.05) { log.append("reload") }
        let started = Date()
        await silent.perform(slackRow)
        c.expect(Date().timeIntervalSince(started) < 1, "an oauth verb still has a timeout of its own")
    },
    Check("FormActionRunner: a second press while a verb runs starts nothing, so Slack never opens a second listener") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup slack connect --json": (0, connectJSON("slack", "ready", "Connected as janedoe"))]
        let log = EventLog()
        let (runner, _) = await makeRunner(rt, log: log)
        let during = EventLog()
        rt.duringNextRun = {
            during.append(await MainActor.run { runner.running.contains("account.slack") } ? "running" : "idle")
            await runner.perform(slackRow)
        }
        await runner.perform(slackRow)
        c.expectEqual(rt.calls.count, 1, "the press during the run was not a second setup slack connect")
        c.expectEqual(during.all, ["running"])
        c.expectEqual(await MainActor.run { runner.running }, [], "the row is free once rt answers")
        c.expectEqual(log.all, ["reload"], "the ignored press reloads nothing")
        await runner.perform(slackRow)
        c.expectEqual(rt.calls.count, 2, "a press after the answer runs again")
    },
    Check("FormActionRunner: every action type but unknown has a control on the fast screens that does something") { c in
        for type in ActionType.allCases {
            let action: RowAction
            let expected: FormActionControl
            switch type {
            case .openSettings: action = RowAction(type: type, label: "Open settings", target: "fda"); expected = .press
            case .requestPermission: action = RowAction(type: type, label: "Allow", which: "notifications"); expected = .press
            case .connect: action = RowAction(type: type, label: "Connect", integration: "gitlab", fields: [ActionField(name: "token", label: "Token", secret: true)]); expected = .inRow
            case .oauth: action = RowAction(type: type, label: "Connect Slack", integration: "slack", verb: ["setup", "slack", "connect"]); expected = .press
            case .install: action = RowAction(type: type, label: "Install", tool: "apple-clt", via: "apple-clt"); expected = .press
            case .steps: action = RowAction(type: type, label: "Show steps…", steps: ["Run: rt setup gitlab connect --host gitlab.example.com"]); expected = .sheet
            case .run: action = RowAction(type: type, label: "Sign in", verb: ["setup", "doppler", "connect"]); expected = .press
            case .choose:
                action = RowAction(type: type, label: "Change", verb: ["setup", "home-backup"], options: [
                    ChooseOption(id: "a", label: "A", detail: ""), ChooseOption(id: "b", label: "B", detail: ""), ChooseOption(id: "c", label: "C", detail: ""),
                ])
                expected = .sheet
            case .form: action = RowAction(type: type, label: "Paste code", fields: [ActionField(name: "code", label: "Code", secret: true)], verb: ["setup", "claude", "code"]); expected = .inRow
            case .ownerOnce: action = RowAction(type: type, label: "Create", integration: "slack", fields: [ActionField(name: "secret", label: "Secret", secret: true)]); expected = .inRow
            case .linkBundled: action = RowAction(type: type, label: "Link", tool: "herdr"); expected = .press
            case .openURL: action = RowAction(type: type, label: "Add to Chrome", url: "https://chromewebstore.google.com/detail/fast-browser"); expected = .press
            case .chooseFolder: action = RowAction(type: type, label: "Choose…"); expected = .inRow
            case .placeRepo: action = RowAction(type: type, label: "Locate…", identity: "github.com/acme/acme-api", mode: "checkout"); expected = .inRow
            case .unknown: action = RowAction(type: type, label: "Something new"); expected = .none
            }
            c.expectEqual(FormActionRunner.control(for: action), expected, "\(type)")
        }
        c.expectEqual(FormActionRunner.control(for: RowAction(type: .run, label: "Sign in")), .none, "a verb rt left out leaves nothing to run")
        c.expectEqual(FormActionRunner.control(for: RowAction(type: .connect, label: "Connect", integration: "gitlab", fields: [])), .none,
                      "a connect with no field to fill has nothing the row can draw")
    },
    Check("FormActionRunner: Show steps presents rt's steps, runs nothing, and reloads once the sheet closes") { c in
        let rt = ScriptedRt()
        let log = EventLog()
        let (runner, _) = await makeRunner(rt, log: log)
        let row = FormRow(id: "tool.fast-browser-extension", title: "Fast Browser", subtext: "Lets agents drive your real Chrome", state: .todo,
                          detail: "Fast Browser can't read Chrome's profile yet",
                          action: RowAction(type: .steps, label: "Show steps…", steps: ["Quit Chrome", "Run: fast-browser doctor"]))
        await runner.perform(row)
        c.expectEqual(await MainActor.run { runner.sheet }, .steps(row, ["Quit Chrome", "Run: fast-browser doctor"]))
        c.expect(rt.calls.isEmpty, "showing steps runs no verb")
        c.expectEqual(log.all, [], "nothing to re-read until the person has done the steps")
        await runner.sheetClosed()
        c.expectEqual(await MainActor.run { runner.sheet }, nil)
        c.expectEqual(log.all, ["reload"])
    },
    Check("FormActionRunner: a failed row's read drops the app's error for good") { c in
        let rt = ScriptedRt()
        let (runner, _) = await makeRunner(rt, log: EventLog())
        var row = FormRow(id: "tool.team.doppler", title: "Doppler", subtext: "", state: .todo, detail: "",
                          action: RowAction(type: .install, label: "Install", tool: "doppler", via: "download"))
        await runner.perform(row)
        c.expect(await MainActor.run { runner.errors[row.id] } != nil, "rt's exit 1 is the app's error until the next read")
        await MainActor.run { runner.reconcile(with: [row]) }
        c.expect(await MainActor.run { runner.errors[row.id] } != nil, "a plain row keeps it")
        row.tone = .failed
        await MainActor.run { runner.reconcile(with: [row]) }
        c.expectEqual(await MainActor.run { runner.errors[row.id] }, nil)
    },
    Check("FormActionRunner: a failed install press keeps Installing until rt's read, and a row that reads failed never shows the app's error") { c in
        let rt = ScriptedRt()
        let seen = EventLog()
        let box = await MainActor.run { RunnerBox() }
        let id = "tool.team.doppler"
        let readBack = FormRow(id: id, title: "Doppler", subtext: "", state: .todo, tone: .failed, detail: "Homebrew could not install it",
                               action: RowAction(type: .install, label: "Retry", tool: "doppler", via: "brew"))
        let runner = await MainActor.run {
            FormActionRunner(rt: rt, needs: NeedBroker(services: FakeServices(), privileged: FakePrivileged()), effects: FakeEffects(log: EventLog())) {
                seen.append("error=\(box.runner?.errors[id] ?? "nil") waiting=\(box.runner?.waiting[id] ?? "nil")")
                box.runner?.reconcile(with: [readBack])
            }
        }
        await MainActor.run { box.runner = runner }
        let row = FormRow(id: id, title: "Doppler", subtext: "", state: .todo, detail: "",
                          action: RowAction(type: .install, label: "Install", tool: "doppler", via: "brew"), waiting: "Installing…")
        await runner.perform(row)
        c.expectEqual(seen.all, ["error=nil waiting=Installing…"], "the read sees Installing, not an amber error")
        c.expectEqual(await MainActor.run { runner.errors[id] }, nil, "rt's failed row carries the failure")
        c.expectEqual(await MainActor.run { runner.waiting[id] }, nil)
    },
    Check("FormActionRunner: a failed install press whose read comes back done shows no error") { c in
        let rt = ScriptedRt()
        let box = await MainActor.run { RunnerBox() }
        let id = "tool.team.doppler"
        let readBack = FormRow(id: id, title: "Doppler", subtext: "", state: .done, detail: "doppler 3.75.3")
        let runner = await MainActor.run {
            FormActionRunner(rt: rt, needs: NeedBroker(services: FakeServices(), privileged: FakePrivileged()), effects: FakeEffects(log: EventLog())) {
                box.runner?.reconcile(with: [readBack])
            }
        }
        await MainActor.run { box.runner = runner }
        let row = FormRow(id: id, title: "Doppler", subtext: "", state: .todo, detail: "",
                          action: RowAction(type: .install, label: "Install", tool: "doppler", via: "brew"), waiting: "Installing…")
        await runner.perform(row)
        c.expectEqual(await MainActor.run { runner.errors[id] }, nil)
        c.expectEqual(await MainActor.run { runner.waiting[id] }, nil)
    },
    Check("FormActionRunner: a press of a row's second action shows its steps, and the row's own action still runs its install") { c in
        let rt = ScriptedRt()
        let (runner, _) = await makeRunner(rt, log: EventLog())
        let row = FormRow(id: "tool.team.doppler", title: "Doppler", subtext: "", state: .todo, tone: .failed, detail: "The download failed",
                          action: RowAction(type: .install, label: "Retry", tool: "doppler", via: "download"),
                          secondary: RowAction(type: .steps, label: "Show steps…", steps: ["Download it from https://docs.doppler.com/docs/install-cli"]))
        let press = try c.requireSome(row.secondaryPress)
        await runner.perform(press)
        c.expectEqual(await MainActor.run { runner.sheet }, .steps(press, ["Download it from https://docs.doppler.com/docs/install-cli"]))
        c.expect(rt.calls.isEmpty, "showing steps runs no install")
        await runner.perform(row)
        c.expectEqual(rt.calls.map(\.args), [["tools", "install", "doppler", "--json"]])
    },
    Check("FormActionRunner: a choose wider than a segment opens a sheet whose pick runs rt's verb and hands back a refusal") { c in
        let rt = ScriptedRt()
        let log = EventLog()
        let (runner, _) = await makeRunner(rt, log: log)
        let action = RowAction(type: .choose, label: "Change", verb: ["setup", "pick"], options: [
            ChooseOption(id: "a", label: "A", detail: ""), ChooseOption(id: "b", label: "B", detail: ""), ChooseOption(id: "c", label: "C", detail: ""),
        ])
        let row = FormRow(id: "pick", title: "Pick one", subtext: "s", state: .todo, detail: "", action: action)
        await runner.perform(row)
        c.expectEqual(await MainActor.run { runner.sheet }, .choose(row))
        c.expect(rt.calls.isEmpty)
        rt.answers = ["setup pick c --json": (2, #"{"contract":1,"error":{"code":"nope","message":"C is not on offer here"}}"#)]
        c.expectEqual(await runner.choose(row, id: "c"), "C is not on offer here")
        rt.answers = ["setup pick b --json": (0, "{}")]
        c.expectEqual(await runner.choose(row, id: "b"), nil)
        c.expectEqual(rt.calls.map(\.args), [["setup", "pick", "c", "--json"], ["setup", "pick", "b", "--json"]])
    },
]
