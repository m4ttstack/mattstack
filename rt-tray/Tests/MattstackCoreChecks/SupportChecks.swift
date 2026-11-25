import Foundation
import MattstackCore

private final class FakeSupport: SupportCommanding, @unchecked Sendable {
    var view: SupportReply<SupportHostView>
    var enableReply: SupportReply<Void> = .value(())
    var acceptReply: SupportReply<Void> = .value(())
    var calls: [String] = []
    init(_ view: SupportHostView) { self.view = .value(view) }
    func host() async -> SupportReply<SupportHostView> { view }
    func enable(on: Bool, host: String?) async -> SupportReply<Void> { calls.append("enable \(on) \(host ?? "saved")"); return enableReply }
    func accept(on: Bool) async -> SupportReply<Void> { calls.append("accept \(on)"); return acceptReply }
}

private let people = [SupportPerson(username: "alex", name: "Alex Moreau"), SupportPerson(username: "ada")]
private func org(_ host: String?, hasKey: Bool = true) -> SupportOrg { SupportOrg(host: host, hasKey: hasKey, people: people, answering: nil) }

@MainActor
private func settings(_ view: SupportHostView, _ rt: ScriptedRt = ScriptedRt()) async -> (SupportSettingsModel, FakeSupport) {
    let daemon = FakeSupport(view)
    let model = SupportSettingsModel(daemon: daemon, rt: rt)
    await model.load()
    return (model, daemon)
}

private final class FakeHelp: HelpCommanding, @unchecked Sendable {
    var available: SupportReply<HelpAvailability> = .value(HelpAvailability(state: "ready", host: "Alex Moreau", away: false, persona: "Maude"))
    var partsReply: SupportReply<[HelpPart]> = .value([versions, setupRows])
    var sendReply: HelpSend = .noAnswer
    var mineReply: SupportReply<[HelpRequest]> = .value([])
    var sent: [(id: String, text: String, parts: [String])] = []
    func availability() async -> SupportReply<HelpAvailability> { available }
    func parts() async -> SupportReply<[HelpPart]> { partsReply }
    func send(id: String, text: String, parts: [HelpPart]) async -> HelpSend {
        sent.append((id, text, parts.map(\.key)))
        return sendReply
    }
    func mine() async -> SupportReply<[HelpRequest]> { mineReply }
}

private let versions = HelpPart(key: "versions", label: "Versions", value: "rt 1")
private let setupRows = HelpPart(key: "setup", label: "Setup rows that need attention", value: "accounts.slack")
private let dm = "slack://user?team=T0ACME&id=U0ALEX"
private func request(_ state: String, id: String = "r", sentAt: Double = 0, dmLink: String? = nil, away: Bool = false, reason: String? = nil, host: String? = "Alex Moreau") -> HelpRequest {
    HelpRequest(id: id, text: "no rows", state: state, reason: reason, dmLink: dmLink, sentAt: sentAt, away: away, host: host)
}

@MainActor
private func help(_ daemon: FakeHelp) async -> HelpRequestModel {
    var n = 0
    let model = HelpRequestModel(daemon: daemon, newId: { n += 1; return "id\(n)" })
    await model.refreshAvailability()
    await model.opened()
    return model
}

let supportChecks: [Check] = [
    Check("Support: the section shows for an org admin, and for a host only while support is on") { c in
        c.expect(!SupportHostView(isHost: false, enabled: true).isShown)
        c.expect(!SupportHostView(isHost: true, enabled: false).isShown)
        c.expect(SupportHostView(isHost: true, enabled: true).isShown)
        c.expect(SupportHostView(isHost: false, enabled: false, org: org(nil)).isShown)
        c.expect(!SupportHostView(isHost: true, enabled: false, org: org("alex")).showsHostRows)
    },
    Check("Support: rt's answer decodes, a fix this app does not know included") { c in
        let json = #"{"isHost":true,"enabled":true,"accepting":false,"missing":["x"],"needs":[{"text":"x","label":"X","fix":"new-kind"},{"text":"y","label":"Y","fix":null,"command":"rt y"}],"otherMac":false,"open":1,"cap":2,"waiting":3,"persona":"Ada","repos":["git.example.com/acme/app"],"org":{"host":null,"hasKey":false,"people":[{"username":"ada"}],"answering":null}}"#
        let v = try JSONDecoder().decode(SupportHostView.self, from: Data(json.utf8))
        c.expectEqual(v.needs.map(\.fix), ["new-kind", nil])
        c.expectEqual(v.needs.last?.command, "rt y")
        c.expectEqual(v.org?.people.first?.shownName, "ada")
        c.expectEqual(v.persona, "Ada")
    },
    Check("Support: an rt that does not answer shows no section") { c in
        let daemon = FakeSupport(SupportHostView(isHost: true, enabled: true))
        daemon.view = .noAnswer
        let model = await MainActor.run { SupportSettingsModel(daemon: daemon, rt: ScriptedRt()) }
        await model.load()
        c.expect(await MainActor.run { model.view == nil })
    },
    Check("Support: a host picked while support is off is kept until it is turned on") { c in
        let (m, daemon) = await settings(SupportHostView(isHost: false, enabled: false, org: org(nil)))
        await m.setEnabled(true)
        c.expectEqual(daemon.calls, [], "no one answers yet")
        await m.pickHost("alex")
        c.expectEqual(daemon.calls, [])
        c.expectEqual(await MainActor.run { m.shownHost }, "alex")
        daemon.view = .value(SupportHostView(isHost: false, enabled: true, org: org("alex")))
        await m.setEnabled(true)
        c.expectEqual(daemon.calls, ["enable true alex"])
        c.expectEqual(await MainActor.run { m.pickedHost }, nil)
        c.expectEqual(await MainActor.run { m.shownHost }, "alex")
    },
    Check("Support: while on, a pick changes the host at once; the same host asks nothing") { c in
        let (m, daemon) = await settings(SupportHostView(isHost: false, enabled: true, org: org("ALEX")))
        await m.pickHost("alex")
        c.expectEqual(daemon.calls, [])
        await m.pickHost("ada")
        c.expectEqual(daemon.calls, ["enable true ada"])
    },
    Check("Support: turning it off names no host, and a missing key is made by turning it on again") { c in
        let (m, daemon) = await settings(SupportHostView(isHost: false, enabled: true, org: org("alex", hasKey: false)))
        await m.makeKey()
        await m.setEnabled(false)
        c.expectEqual(daemon.calls, ["enable true saved", "enable false saved"])
    },
    Check("Support: a host who left the roster is shown as no one") { c in
        let (m, _) = await settings(SupportHostView(isHost: false, enabled: true, org: org("gone")))
        c.expectEqual(await MainActor.run { m.shownHost }, nil)
    },
    Check("Support: a refusal is shown where it was asked, and keeps the pick") { c in
        let (m, daemon) = await settings(SupportHostView(isHost: true, enabled: false, org: org(nil)))
        daemon.enableReply = .refused("Ask dev1 to make this change.")
        await m.pickHost("alex")
        await m.setEnabled(true)
        c.expectEqual(await MainActor.run { m.orgError }, "Ask dev1 to make this change.")
        c.expectEqual(await MainActor.run { m.pickedHost }, "alex")
        c.expectEqual(await MainActor.run { m.hostError }, nil)
        daemon.acceptReply = .noAnswer
        await m.setAccepting(true)
        c.expectEqual(await MainActor.run { m.hostError }, "rt did not answer")
        c.expectEqual(await MainActor.run { m.busy }, nil)
    },
    Check("Support: choosing the repo writes the host's own setting") { c in
        let rt = ScriptedRt()
        rt.answers = ["settings set": (0, "")]
        let (m, _) = await settings(SupportHostView(isHost: true, enabled: true), rt)
        await m.chooseRepo("git.example.com/acme/app")
        c.expectEqual(rt.calls.map(\.args), [["settings", "set", "chat.slackSupport.defaultRepo", "git.example.com/acme/app", "--scope", "user"]])
        c.expectEqual(await MainActor.run { m.hostError }, nil)
    },

    Check("Help: offered only when rt says ready or disabled; a state it does not know hides it") { c in
        for (state, offered, ready) in [("ready", true, true), ("disabled", true, false), ("hidden", false, false), ("soon", false, false)] {
            let a = HelpAvailability(state: state)
            c.expectEqual(a.isOffered, offered, state)
            c.expectEqual(a.isReady, ready, state)
        }
        c.expectEqual(HelpAvailability(state: "ready").bot, "Maude")
        c.expectEqual(HelpAvailability(state: "ready", host: "Alex Moreau", persona: "Ada").hostFirstName, "Alex")
    },
    Check("Help: an answer that does not come keeps the last one") { c in
        let daemon = FakeHelp()
        let m = await help(daemon)
        daemon.available = .noAnswer
        await m.refreshAvailability()
        c.expect(await MainActor.run { m.availability.isReady })
    },
    Check("Help: what is unticked stays behind, and the words go trimmed") { c in
        let daemon = FakeHelp()
        daemon.sendReply = .sent(request("sent"))
        let m = await help(daemon)
        c.expect(await MainActor.run { !m.canSend }, "no words yet")
        await MainActor.run { m.text = "  no rows \n"; m.toggle(setupRows) }
        await m.send()
        c.expectEqual(daemon.sent.map(\.text), ["no rows"])
        c.expectEqual(daemon.sent.first?.parts, ["versions"])
        c.expectEqual(await MainActor.run { m.text }, "")
        c.expectEqual(await MainActor.run { m.card?.title }, "Asked Alex's agent")
    },
    Check("Help: nothing can be sent while what goes with it is unknown") { c in
        let daemon = FakeHelp()
        daemon.partsReply = .noAnswer
        let m = await help(daemon)
        await MainActor.run { m.text = "no rows" }
        c.expect(await MainActor.run { m.partsFailed && !m.canSend })
        await m.send()
        c.expectEqual(daemon.sent.count, 0)
    },
    Check("Help: a retry keeps its id and the words; changed words are a new request") { c in
        let daemon = FakeHelp()
        let m = await help(daemon)
        await MainActor.run { m.text = "no rows" }
        await m.send()
        c.expectEqual(await MainActor.run { m.card?.title }, "rt did not answer")
        c.expectEqual(await MainActor.run { m.cardText }, "no rows")
        await m.send()
        await MainActor.run { m.text = "still no rows" }
        await m.send()
        let ids = daemon.sent.map(\.id)
        try c.requireEqual(ids.count, 3)
        c.expectEqual(ids[1], ids[0])
        c.expect(ids[2] != ids[0], "changed words kept the id")
    },
    Check("Help: the window opens on a request still going, and follows it") { c in
        let daemon = FakeHelp()
        daemon.mineReply = .value([request("declined", id: "new", sentAt: 2), request("sent", id: "old", sentAt: 1)])
        let m = await help(daemon)
        c.expectEqual(await MainActor.run { m.shown?.id }, "old")
        daemon.mineReply = .value([request("opened", id: "old", sentAt: 1, dmLink: dm)])
        await m.refreshRequests()
        c.expectEqual(await MainActor.run { m.card?.title }, "Alex's agent messaged you in Slack")
        await m.opened()
        c.expectEqual(await MainActor.run { m.shown }, nil, "a settled one is not news twice")
    },
    Check("Help: a request keeps the name of the person it went to, whoever is the host now") { c in
        let daemon = FakeHelp()
        daemon.mineReply = .value([request("sent", host: "Bea Finch")])
        let m = await help(daemon)
        c.expectEqual(await MainActor.run { m.card?.title }, "Asked Bea's agent")
        daemon.mineReply = .value([request("sent", host: nil)])
        await m.refreshRequests()
        c.expectEqual(await MainActor.run { m.card?.title }, "Asked Alex's agent")
    },
    Check("Help: a refusal keeps the name it came for, and a send still goes when the host cannot be reached") { c in
        let daemon = FakeHelp()
        let m = await help(daemon)
        daemon.sendReply = .refused(code: "support-not-accepting", message: "x")
        await MainActor.run { m.text = "no rows" }
        await m.send()
        daemon.available = .value(HelpAvailability(state: "ready", host: "Bea Finch"))
        await m.refreshAvailability()
        c.expectEqual(await MainActor.run { m.card?.title }, "Alex isn't taking requests")
        daemon.available = .value(.hidden)
        await m.refreshAvailability()
        c.expectEqual(await MainActor.run { m.host }, "Bea")
        daemon.sendReply = .refused(code: "support-token", message: "Connect your board again.")
        await m.send()
        c.expectEqual(daemon.sent.count, 2)
        c.expectEqual(await MainActor.run { m.card?.detail }, "Connect your board again")
    },
    Check("Help: the words stop at rt's limit, never inside a character, and a refused length can be edited") { c in
        let daemon = FakeHelp()
        daemon.sendReply = .refused(code: "support-too-long", message: "That is too long to send.")
        let m = await help(daemon)
        let max = HelpRequestModel.textMax
        await MainActor.run { m.text = String(repeating: "a", count: max) }
        c.expectEqual(await MainActor.run { m.text.utf16.count }, max)
        await MainActor.run { m.text = String(repeating: "a", count: max - 1) + "👩‍👩‍👧b" }
        c.expectEqual(await MainActor.run { m.text }, String(repeating: "a", count: max - 1))
        await m.send()
        c.expectEqual(await MainActor.run { m.card?.action }, .edit)
        await MainActor.run { m.edit() }
        c.expectEqual(await MainActor.run { m.card }, nil)
        c.expect(await MainActor.run { !m.text.isEmpty })
    },
    Check("Help: asking again brings the words back") { c in
        let daemon = FakeHelp()
        daemon.mineReply = .value([request("sent")])
        let m = await help(daemon)
        daemon.mineReply = .value([request("expired")])
        await m.refreshRequests()
        c.expectEqual(await MainActor.run { m.card?.action }, .askAgain)
        await MainActor.run { m.askAgain() }
        c.expectEqual(await MainActor.run { m.text }, "no rows")
        c.expectEqual(await MainActor.run { m.card }, nil)
    },
    Check("Help: every state says what the board's card says") { c in
        for (r, title, detail) in [
            (request("sent"), "Asked Alex's agent", nil),
            (request("sent", away: true), "Alex's Mac is away", "Your request will wait up to 7 days"),
            (request("received"), "Alex's agent is starting", "Alex's Mac has it"),
            (request("opening"), "Alex's agent is starting", "Alex's Mac has it"),
            (request("waiting"), "Alex needs to OK this one", "It will wait"),
            (request("already-waiting"), "You already have a request waiting", nil),
            (request("opened"), "Alex's agent messaged you in Slack", nil),
            (request("already-open"), "You already have a chat open", nil),
            (request("declined"), "Alex declined this one", "Message Alex directly"),
            (request("not-accepting"), "Alex isn't taking requests", "Message Alex directly"),
            (request("failed"), "Your request didn't open", "Message Alex directly"),
            (request("failed", reason: "no Slack account"), "Your request didn't open", "no Slack account"),
            (request("expired"), "It was never picked up after 7 days", "Ask again, or message Alex"),
        ] as [(HelpRequest, String, String?)] {
            let card = HelpCards.request(r, host: "Alex")
            c.expectEqual(card.title, title)
            c.expectEqual(card.detail, detail, title)
        }
    },
    Check("Help: a refusal never claims nothing was sent when it may have been") { c in
        for (code, title) in [("support-unreachable", "Nothing was sent"), ("support-slack", "Nothing was sent"), ("support-text", "Nothing was sent"), ("support-new", "Nothing was sent"),
                              ("support-changed", "Your first version was already sent"), ("no-answer", "rt did not answer"),
                              ("support-not-accepting", "Alex isn't taking requests")] {
            c.expectEqual(HelpCards.refusal(code: code, message: "Say more.", host: "Alex", waiting: false).title, title, code)
        }
        c.expectEqual(HelpCards.refusal(code: "support-text", message: "Say more.", host: "Alex", waiting: false).detail, "Say more")
        c.expectEqual(HelpCards.refusal(code: "support-already-waiting", message: "", host: "Alex", waiting: true).action, .showIt)
        c.expectEqual(HelpCards.refusal(code: "support-already-waiting", message: "", host: "Alex", waiting: false).action, nil)
    },
    Check("Help: a host's link is followed only into Slack") { c in
        for ok in [dm, "https://slack.com/app", "https://acme.slack.com/archives/D1"] { c.expect(HelpCards.slackLink(ok) != nil, ok) }
        for bad in ["", "javascript:alert(1)", "http://slack.com/x", "file:///etc/hosts", "https://slack.com.evil.example/x", "https://evilslack.com/x",
                    "https://slack.com@evil.example/x"] {
            c.expect(HelpCards.slackLink(bad) == nil, bad)
        }
        c.expect(HelpCards.slackLink(nil) == nil)
    },
]
