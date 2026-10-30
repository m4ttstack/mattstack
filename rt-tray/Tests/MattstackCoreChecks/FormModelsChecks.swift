import Foundation
import MattstackCore

private func row(_ id: String, state: String = "todo", watch: Bool = false, action: String = "null", extra: String = "") -> String {
    #"{"id":"\#(id)","title":"T","subtext":"S","state":"\#(state)","detail":"D","action":\#(action),"waiting":null,"watch":\#(watch),"optional":false\#(extra)}"#
}

private let wholeFormJSON = #"""
{"contract":1,"at":"2026-10-30T10:00:00.000Z","path":"join",
 "team":{"slug":"widgets","name":"Widgets","invitedBy":"janedoe"},
 "stage":"this-mac",
 "sections":{
  "macos":[
   {"id":"perm.fda","title":"Full Disk Access","subtext":"Reads your repos and Chrome's profile","state":"todo","detail":"Not granted","action":{"type":"open-settings","label":"Open settings","target":"fda"},"waiting":null,"watch":true,"optional":false},
   {"id":"perm.notifications","title":"Notifications","subtext":"Tells you when setup is done","state":"todo","detail":"Not asked yet","action":{"type":"request-permission","label":"Allow","which":"notifications"},"waiting":null,"watch":false,"optional":false},
   {"id":"mac.fancy-urls","title":"Fancy URLs","subtext":"Grant mattstack apps permission to use .mattstack","state":"done","detail":"Done","action":null,"waiting":"Waiting for your admin password in the macOS dialog…","watch":true,"optional":false}],
  "invite":[
   {"id":"tool.clt","title":"Command Line Tools","subtext":"Git and the build tools setup needs","state":"todo","detail":"Not installed yet","action":{"type":"install","label":"Install","tool":"apple-clt","via":"apple-clt"},"waiting":null,"watch":true,"optional":false},
   {"id":"forge.token","title":"GitLab","subtext":"Lets mattstack reach the team's repo and open MRs","state":"todo","detail":"","action":{"type":"connect","label":"Connect","integration":"gitlab","fields":[{"name":"token","label":"Personal access token","secret":true,"hint":"scopes: api"}],"create":{"label":"Create token","url":"https://gitlab.example.com/-/user_settings/personal_access_tokens"}},"waiting":null,"watch":false,"optional":false}],
  "restore":[],
  "connect":[
   {"id":"slack","title":"Slack","subtext":"Lets mattstack track and post MRs in Slack","state":"todo","detail":"","action":{"type":"oauth","label":"Connect Slack","integration":"slack","verb":["setup","slack","connect"]},"waiting":"Waiting for Slack…","watch":true,"optional":false},
   {"id":"claude","title":"Claude","subtext":"You know, to do agentic stuff.","state":"waiting","detail":"Finish signing in in your browser","action":{"type":"form","label":"Paste code","verb":["setup","claude","code"],"fields":[{"name":"code","label":"Code from your browser","secret":true}]},"waiting":null,"watch":true,"optional":false},
   {"id":"signin.doppler","title":"doppler","subtext":"For running your dev servers","state":"todo","detail":"","action":{"type":"run","label":"Sign in","verb":["setup","doppler","connect"]},"waiting":null,"watch":true,"optional":true},
   {"id":"fast-browser","title":"Fast Browser","subtext":"Lets agents drive your real Chrome","state":"todo","detail":"","action":{"type":"open-url","label":"Add to Chrome","url":"https://chromewebstore.google.com/detail/fast-browser","waiting":"Waiting for Chrome…","again":"Open again","primary":true},"waiting":"Waiting for Chrome…","watch":true,"optional":false}],
  "thisMac":[
   {"id":"repos.place:github.com/acme/acme-api","title":"acme-api","subtext":"The board starts here","state":"done","detail":"~/code/acme-api","action":{"type":"place-repo","label":"Locate…","identity":"github.com/acme/acme-api","repo":"acme/acme-api","mode":"checkout","checkoutPath":"/fake-home/code/acme-api","clonePath":"/fake-home/code/acme-api","note":"n","problem":null,"then":null,"oneClick":null,"segmentRecords":false,"board":"The board starts here","awaitsRun":true},"waiting":null,"watch":false,"optional":false},
   {"id":"repos.root","title":"Your repos","subtext":"Where new clones go","state":"todo","detail":"","action":{"type":"choose-folder","label":"Choose…","startAt":null},"waiting":null,"watch":false,"optional":false},
   {"id":"settings.backup","title":"Your settings","subtext":"s","state":"done","detail":"Keep on this Mac","action":{"type":"choose","label":"Change","verb":["setup","home-backup"],"options":[{"id":"local","label":"Keep on this Mac","detail":""},{"id":"remote","label":"Store in a remote repo","detail":""}],"selected":"local"},"waiting":null,"watch":false,"optional":false},
   {"id":"settings.remote","title":"Remote repo","subtext":"Where the private copy lives","state":"todo","detail":"","action":{"type":"form","label":"Use this repo","verb":["home","remote","set"],"fields":[{"name":"url","label":"Repo URL","secret":false,"hint":"git@github.com:janedoe/mattstack-home.git"}],"alternatives":[{"id":"create","label":"Create a private GitHub repo"}]},"waiting":null,"watch":false,"optional":false}]},
 "continueReady":false,"startReady":false,
 "paused":{"step":"daemon.start","title":"Starting the background service","detail":"It did not start","remedy":null,"log":["line one","line two"],"action":{"type":"open-settings","label":"Open settings","target":"login-items"}},
 "home":{"label":"Open the board","url":"https://board.mattstack"}}
"""#

private func sectionJSON(_ key: String, _ rows: [String], stage: String = "null") -> String {
    #"{"contract":1,"at":"2026-10-30T10:00:00.000Z","path":"join","team":null,"stage":\#(stage),"sections":{"\#(key)":[\#(rows.joined(separator: ","))]},"continueReady":false,"startReady":false,"paused":null,"home":{"label":"Open the board","url":"https://board.mattstack"}}"#
}

private func decodeForm(_ json: String) throws -> SetupForm {
    try JSONDecoder().decode(SetupForm.self, from: Data(json.utf8))
}

/// Sleeps that return at once, after running `onSleep` with how many sleeps came before.
private final class CountingSleep: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    let onSleep: @Sendable (Int) -> Void
    init(onSleep: @escaping @Sendable (Int) -> Void = { _ in }) { self.onSleep = onSleep }
    var sleep: @Sendable (TimeInterval) async -> Void {
        { [self] _ in
            let n = lock.withLock { () -> Int in defer { count += 1 }; return count }
            onSleep(n)
            await Task.yield()
        }
    }
}

@MainActor
private func waitUntilIdle(_ m: SetupFormModel) async {
    for _ in 0..<500 where m.isWatching { try? await Task.sleep(nanoseconds: 1_000_000) }
}

let formModelsChecks: [Check] = [
    Check("FormModels: a whole form decodes") { c in
        let form = try decodeForm(wholeFormJSON)
        c.expectEqual(form.path, "join")
        c.expectEqual(form.team, FormTeam(slug: "widgets", name: "Widgets", invitedBy: "janedoe"))
        c.expectEqual(form.stage, .thisMac)
        c.expectEqual(form.sections.macos?.map(\.id), ["perm.fda", "perm.notifications", "mac.fancy-urls"])
        c.expectEqual(form.sections.invite?.count, 2)
        c.expectEqual(form.sections.restore, [], "an empty section stays empty, not nil")
        c.expectEqual(form.sections.connect?.count, 4)
        c.expectEqual(form.sections.thisMac?.count, 4, "thisMac decodes from rt's camelCase key")
        c.expectEqual(form.sections.create, nil)
        c.expectEqual(form.sections.rows(for: "this-mac")?.first?.id, "repos.place:github.com/acme/acme-api")
        let claude = try c.requireSome(form.sections.connect?.first { $0.id == "claude" })
        c.expectEqual(claude.state, .waiting)
        c.expect(claude.watch)
        let fancy = try c.requireSome(form.sections.macos?.last)
        c.expectEqual(fancy.waiting, "Waiting for your admin password in the macOS dialog…")
        c.expectEqual(form.paused?.log, ["line one", "line two"])
        c.expectEqual(form.paused?.action?.target, "login-items")
        c.expectEqual(form.home, FormHome(label: "Open the board", url: "https://board.mattstack"))
        c.expect(!form.continueReady && !form.startReady)
    },
    Check("FormModels: every action a form row carries decodes through RowAction") { c in
        let form = try decodeForm(wholeFormJSON)
        let actions = form.sections.all.compactMap(\.action)
        c.expect(actions.allSatisfy { $0.type != .unknown }, "\(actions.filter { $0.type == .unknown })")
        let types = Set(actions.map(\.type))
        for t: ActionType in [.openSettings, .requestPermission, .install, .connect, .oauth, .form, .run, .openURL, .placeRepo, .chooseFolder, .choose] {
            c.expect(types.contains(t), "fixture covers \(t)")
        }
        let install = try c.requireSome(actions.first { $0.type == .install })
        c.expectEqual(install.tool, "apple-clt")
        c.expectEqual(install.via, "apple-clt")
        let connect = try c.requireSome(actions.first { $0.type == .connect })
        c.expectEqual(connect.create?.label, "Create token")
        c.expectEqual(connect.fields?.first?.secret, true)
        let place = try c.requireSome(actions.first { $0.type == .placeRepo })
        c.expectEqual(place.awaitsRun, true)
        let folder = try c.requireSome(actions.first { $0.type == .chooseFolder })
        c.expectEqual(folder.startAt, nil)
        let choose = try c.requireSome(actions.first { $0.type == .choose })
        c.expectEqual(choose.selected, "local")
        c.expectEqual(choose.options?.map(\.id), ["local", "remote"])
        let remote = try c.requireSome(form.sections.thisMac?.last?.action)
        c.expectEqual(remote.alternatives?.map(\.id), ["create"])
        let openURL = try c.requireSome(actions.first { $0.type == .openURL })
        c.expectEqual(openURL.primary, true)
        c.expectEqual(openURL.again, "Open again")
    },
    Check("FormModels: an unknown row state reads todo") { c in
        let form = try decodeForm(sectionJSON("connect", [row("claude", state: "pondering")]))
        c.expectEqual(form.sections.connect?.first?.state, .todo)
    },
    Check("FormModels: a section rt left out reads nil") { c in
        let form = try decodeForm(sectionJSON("connect", [row("claude")]))
        c.expectEqual(form.sections.connect?.count, 1)
        c.expectEqual(form.sections.macos, nil)
        c.expectEqual(form.sections.thisMac, nil)
        c.expectEqual(form.sections.rows(for: "invite"), nil)
        c.expectEqual(form.stage, nil, "a section read carries no stage")
        c.expectEqual(form.paused, nil)
    },
    Check("FormModels: an unknown stage reads nil, and a paused without log reads none") { c in
        c.expectEqual(try decodeForm(sectionJSON("macos", [], stage: "\"somewhere-new\"")).stage, nil)
        let paused = try JSONDecoder().decode(FormPaused.self, from: Data(#"{"step":"s","title":"t","detail":"d","remedy":"r","action":null}"#.utf8))
        c.expectEqual(paused.log, [])
        c.expectEqual(paused.remedy, "r")
    },
    Check("SetupForm: load runs setup form with the section") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup form": (0, sectionJSON("connect", [row("claude")]))]
        let m = await SetupFormModel(rt: rt)
        await m.load(section: "connect")
        await m.load(section: nil)
        await m.load(section: "create", extra: ["--forge", "gitlab", "--host", "gitlab.example.com"])
        c.expectEqual(rt.calls.map(\.args), [
            ["setup", "form", "--section", "connect", "--json"],
            ["setup", "form", "--json"],
            ["setup", "form", "--section", "create", "--forge", "gitlab", "--host", "gitlab.example.com", "--json"],
        ])
        c.expectEqual(await m.form?.sections.connect?.first?.id, "claude")
        c.expectEqual(await m.error, nil)
        c.expect(await !m.isLoading)
    },
    Check("SetupForm: a failed read keeps the last form and sets the error") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup form": (0, sectionJSON("connect", [row("claude")]))]
        let m = await SetupFormModel(rt: rt)
        await m.load(section: "connect")
        let first = await m.form
        rt.answers = ["setup form": (2, #"{"error":{"code":"bad-section","message":"nowhere is not a part of setup"}}"#)]
        await m.load(section: "connect")
        c.expectEqual(await m.form, first)
        c.expectEqual(await m.error, "nowhere is not a part of setup", "a user error shows rt's own message")
        rt.answers = ["setup form": (0, "not json")]
        await m.load(section: "connect")
        c.expectEqual(await m.form, first)
        c.expectEqual(await m.error, "rt setup form returned an unexpected reply.")
        rt.answers = ["setup form": (0, sectionJSON("connect", [row("claude", state: "done")]))]
        await m.load(section: "connect")
        c.expectEqual(await m.error, nil, "the next good read clears the error")
        c.expectEqual(await m.form?.sections.connect?.first?.state, .done)
    },
    Check("SetupForm: watching stops once nothing waits") { c in
        let rt = ScriptedRt()
        let waiting = sectionJSON("connect", [row("claude", state: "waiting", watch: true), row("fast-browser", state: "busy", watch: true)])
        let settled = sectionJSON("connect", [row("claude", state: "done", watch: true), row("fast-browser", state: "busy", watch: false)])
        rt.answers = ["setup form": (0, waiting)]
        let sleeps = CountingSleep { n in if n == 2 { rt.answers = ["setup form": (0, settled)] } }
        let m = await SetupFormModel(rt: rt, sleep: sleeps.sleep)
        await m.load(section: "connect")
        await m.watch(section: "connect")
        c.expect(await m.isWatching)
        await waitUntilIdle(m)
        c.expect(await !m.isWatching, "a busy row rt does not watch keeps nothing going")
        c.expectEqual(rt.calls.count, 4, "one load, then three re-reads, the last of them settled")
        c.expect(rt.calls.allSatisfy { $0.args == ["setup", "form", "--section", "connect", "--json"] })
        c.expectEqual(await m.form?.sections.connect?.first?.state, .done)
    },
    Check("SetupForm: a section read keeps the other sections, and hands back its own read") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup form --json": (0, wholeFormJSON)]
        let m = await SetupFormModel(rt: rt)
        let whole = await m.load(section: nil)
        c.expectEqual(whole?.stage, .thisMac, "a whole read hands back its stage")
        rt.answers = ["setup form --section connect --json": (0, sectionJSON("connect", [row("claude", state: "done")]))]
        let section = await m.load(section: "connect")
        c.expectEqual(section?.stage, nil)
        c.expectEqual(await m.rows(for: "connect")?.map(\.state), [.done], "the newest connect rows")
        c.expectEqual(await m.rows(for: "this-mac")?.count, 4, "the connect read never blanks this Mac's rows")
        c.expectEqual(await m.read(carrying: "this-mac")?.startReady, false)
        c.expectEqual(await m.whole?.stage, .thisMac, "the last whole read stays for what only it carries")
        c.expectEqual(await m.whole?.paused?.step, "daemon.start")
        await m.forget(section: "invite")
        c.expectEqual(await m.rows(for: "invite"), nil, "a forgotten section reads as not loaded")
        rt.answers = ["setup form --json": (1, "")]
        c.expectEqual(await m.load(section: nil), nil, "a read rt could not answer hands back nothing")
        c.expectEqual(await m.rows(for: "connect")?.map(\.state), [.done])
    },
    Check("SetupForm: a watch keeps going while the app still waits on a row rt calls todo") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup form": (0, sectionJSON("connect", [row("fast-browser", watch: true)]))]
        final class Waiting: @unchecked Sendable { var on = true }
        let waiting = Waiting()
        let sleeps = CountingSleep { n in if n == 3 { waiting.on = false } }
        let m = await SetupFormModel(rt: rt, sleep: sleeps.sleep)
        await m.watch(section: "connect", alsoWhile: { waiting.on })
        await waitUntilIdle(m)
        c.expectEqual(rt.calls.count, 4, "re-reads until the app's own wait ends")
        c.expect(await !m.isWatching)
    },
    Check("SetupForm: another section's read never ends a watch early") { c in
        let rt = ScriptedRt()
        let waiting = sectionJSON("connect", [row("claude", state: "waiting", watch: true)])
        let settled = sectionJSON("connect", [row("claude", state: "done", watch: true)])
        rt.sequences = ["setup form --section connect --json": [(0, waiting), (0, waiting), (0, settled)]]
        rt.answers = ["setup form --section macos --json": (0, sectionJSON("macos", [row("perm.fda", state: "done")]))]
        let m = await SetupFormModel(rt: rt, sleep: CountingSleep().sleep)
        // The macOS read is issued while the watch's first connect read is in flight, and lands first.
        rt.duringNextRun = { await m.load(section: "macos") }
        await m.watch(section: "connect")
        await waitUntilIdle(m)
        c.expectEqual(rt.calls.filter { $0.args.contains("connect") }.count, 3, "the watch reads connect until it settles")
        c.expectEqual(await m.rows(for: "connect")?.first?.state, .done)
    },
    Check("SetupForm: stopWatching ends the re-reads") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup form": (0, sectionJSON("macos", [row("perm.fda", state: "busy", watch: true)]))]
        let m = await SetupFormModel(rt: rt, sleep: { _ in try? await Task.sleep(nanoseconds: 50_000_000) })
        await m.watch(section: "macos")
        await m.stopWatching()
        c.expect(await !m.isWatching)
        try? await Task.sleep(nanoseconds: 120_000_000)
        c.expectEqual(rt.calls.count, 0, "a stopped watch never reads again")
    },
]
