import Foundation
import MattstackCore

private let joinOnly = ["setup", "apply", "--only", "team.join", "--json"]
private let statusVerb = ["setup", "join-status", "--json"]

private func teamRepoRow(_ status: RowStatus) -> PlanRow {
    PlanRow(id: "access.team-repo", kind: .access, title: "Team repo", why: "w", required: true, status: status,
            action: status == .ready ? nil : RowAction(type: .connect, label: "Connect…"), recheck: .onActivate)
}

private func statusJSON(_ state: String, since: String? = "2026-10-29T10:00:00.000Z", repos: Int = 2, accounts: Int = 2, packs: Int = 1) -> String {
    let sinceValue = since.map { "\"\($0)\"" } ?? "null"
    return #"{"contract":1,"at":"2026-10-29T10:05:00.000Z","team":{"slug":"acme","name":"acme"},"state":"\#(state)","since":\#(sinceValue),"uses":{"repos":\#(repos),"accounts":\#(accounts),"packs":\#(packs)},"pull":{"outcome":"pulled","detail":"Pulled the team's settings"}}"#
}

private let joinOkLines = [
    #"{"event":"plan","steps":[{"id":"team.join","title":"Join the team","kind":"rt"}]}"#,
    #"{"event":"step","id":"team.join","state":"running"}"#,
    #"{"event":"log","id":"team.join","line":"Redeemed the invite"}"#,
    #"{"event":"step","id":"team.join","state":"done"}"#,
    #"{"event":"done","ok":true,"failedStep":null}"#,
]

@MainActor
private func makeModel(_ rt: ScriptedRt) -> JoinPageModel {
    let now = ISO8601DateFormatter().date(from: "2026-10-29T10:05:00Z")!
    return JoinPageModel(rt: rt, needs: NeedBroker(services: FakeServices(), privileged: FakePrivileged()), clock: { now })
}

private func waitingStatus(_ m: JoinPageModel) async -> JoinStatus? {
    await MainActor.run { if case .waiting(let s) = m.phase { return s } else { return nil } }
}

let joinPageChecks: [Check] = [
    Check("JoinPage: a team repo row that needs a token reads needs token") { c in
        let m = await makeModel(ScriptedRt())
        await MainActor.run { m.update(teamRepoRow: teamRepoRow(.needsYou)) }
        c.expectEqual(await MainActor.run { m.phase }, .needsToken)
        await MainActor.run { m.update(teamRepoRow: nil) }
        c.expectEqual(await MainActor.run { m.phase }, .needsToken, "no row yet is no token yet")
    },
    Check("JoinPage: a ready row reads ready") { c in
        let m = await makeModel(ScriptedRt())
        await MainActor.run { m.update(teamRepoRow: teamRepoRow(.ready)) }
        c.expectEqual(await MainActor.run { m.phase }, .ready)
        await MainActor.run { m.update(teamRepoRow: teamRepoRow(.needsYou)) }
        c.expectEqual(await MainActor.run { m.phase }, .needsToken, "a token that stops working sends the page back")
    },
    Check("JoinPage: join runs team.join, then checks") { c in
        let rt = ScriptedRt()
        rt.streamLines = joinOkLines
        rt.answers = ["setup join-status --json": (0, statusJSON("waiting"))]
        let m = await makeModel(rt)
        await MainActor.run { m.update(teamRepoRow: teamRepoRow(.ready)) }
        await m.join()
        c.expectEqual(rt.calls.map(\.args), [joinOnly, statusVerb])
        let status = await waitingStatus(m)
        c.expectEqual(status?.team.name, "acme")
        c.expectEqual(status?.uses, JoinStatus.Uses(repos: 2, accounts: 2, packs: 1))
        c.expectEqual(await MainActor.run { m.logLines }, ["Redeemed the invite"], "the step's log lines show while it runs")
        c.expect(await MainActor.run { m.joinLanded })
        await MainActor.run { m.update(teamRepoRow: teamRepoRow(.needsYou)) }
        c.expect(await waitingStatus(m) != nil, "a row re-read after the join never moves the page off its wait")
    },
    Check("JoinPage: a failed join shows the step's detail and remedy") { c in
        let rt = ScriptedRt()
        rt.streamLines = [
            #"{"event":"step","id":"team.join","state":"failed","detail":"The invite was already used","remedy":"Ask your team admin for a new invite"}"#,
            #"{"event":"done","ok":false,"failedStep":"team.join"}"#,
        ]
        let m = await makeModel(rt)
        await m.join()
        guard case .failed(let detail, _) = await MainActor.run(body: { m.phase }) else { c.fail("expected failed, got \(await MainActor.run { m.phase })"); return }
        c.expect(detail.contains("The invite was already used"), detail)
        c.expect(detail.contains("Ask your team admin for a new invite"), detail)
        c.expectEqual(rt.calls.map(\.args), [joinOnly], "a failed join never checks approval")
        c.expect(await MainActor.run { !m.joinLanded })
    },
    Check("JoinPage: approved reads You're in the team") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup join-status --json": (0, statusJSON("approved", since: nil))]
        let m = await makeModel(rt)
        await m.check()
        c.expectEqual(await MainActor.run { m.phase }, .approved(team: "acme"))
        c.expect(await MainActor.run { m.continueEnabled })
        c.expectEqual(await MainActor.run { m.lastStatus?.uses }, .some(JoinStatus.Uses(repos: 2, accounts: 2, packs: 1)),
                      "the approved page still says what the team uses")
    },
    Check("JoinPage: Check again runs join-status once more") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup join-status --json": (0, statusJSON("waiting"))]
        let m = await makeModel(rt)
        await m.check()
        c.expect(await waitingStatus(m) != nil)
        c.expect(await MainActor.run { !m.continueEnabled }, "Continue waits for approval")
        rt.answers = ["setup join-status --json": (0, statusJSON("approved", since: nil))]
        await m.check()
        c.expectEqual(rt.calls.map(\.args), [statusVerb, statusVerb])
        c.expectEqual(await MainActor.run { m.phase }, .approved(team: "acme"))
    },
    Check("JoinPage: usesText drops zeros and pluralises") { c in
        c.expectEqual(JoinPageModel.usesText(.init(repos: 2, accounts: 2, packs: 1)), "2 repos, 2 accounts, 1 pack")
        c.expectEqual(JoinPageModel.usesText(.init(repos: 1, accounts: 0, packs: 3)), "1 repo, 3 packs")
        c.expectEqual(JoinPageModel.usesText(.init(repos: 0, accounts: 1, packs: 0)), "1 account")
        c.expectEqual(JoinPageModel.usesText(.init(repos: 0, accounts: 0, packs: 0)), "")
    },
    Check("JoinPage: sinceText reads minutes and hours") { c in
        let now = Date(timeIntervalSince1970: 1_000_000)
        c.expectEqual(JoinPageModel.sinceText(now.addingTimeInterval(-20), now: now), "just now")
        c.expectEqual(JoinPageModel.sinceText(now.addingTimeInterval(-60), now: now), "1 minute ago")
        c.expectEqual(JoinPageModel.sinceText(now.addingTimeInterval(-5 * 60), now: now), "5 minutes ago")
        c.expectEqual(JoinPageModel.sinceText(now.addingTimeInterval(-3600), now: now), "1 hour ago")
        c.expectEqual(JoinPageModel.sinceText(now.addingTimeInterval(-2 * 3600 - 59), now: now), "2 hours ago")
        c.expectEqual(JoinPageModel.sinceText(now.addingTimeInterval(-3 * 86400), now: now), "3 days ago")
        c.expectEqual(JoinPageModel.sinceText(now.addingTimeInterval(30), now: now), "just now", "a clock a little behind rt's never reads as the future")
    },
    Check("JoinPage: the waiting line reads how long ago from the status") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup join-status --json": (0, statusJSON("waiting"))]
        let m = await makeModel(rt)
        await m.check()
        c.expectEqual(await MainActor.run { m.waitingSince }, "5 minutes ago")
        rt.answers = ["setup join-status --json": (0, statusJSON("waiting", since: nil))]
        await m.check()
        c.expectEqual(await MainActor.run { m.waitingSince }, nil, "no join time, no age")
    },
    Check("JoinPage: a status rt cannot answer keeps the last state and says so") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup join-status --json": (0, statusJSON("waiting"))]
        let m = await makeModel(rt)
        await m.check()
        let before = await MainActor.run { m.phase }
        rt.answers = ["setup join-status --json": (2, "")]
        await m.check()
        c.expectEqual(await MainActor.run { m.phase }, before)
        c.expectEqual(await MainActor.run { m.checkError }, "rt setup join-status failed (exit 2).")
        rt.answers = ["setup join-status --json": (0, statusJSON("waiting"))]
        await m.check()
        c.expectEqual(await MainActor.run { m.checkError }, nil, "the next answer clears it")
    },
    Check("JoinPage: an unreadable approval says so, offers Check again and never blocks Continue") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup join-status --json": (0, statusJSON("unreadable", since: nil))]
        let m = await makeModel(rt)
        await m.check()
        guard case .unreadable(let status) = await MainActor.run(body: { m.phase }) else { c.fail("expected unreadable, got \(await MainActor.run { m.phase })"); return }
        c.expectEqual(status.team.slug, "acme")
        c.expect(await MainActor.run { m.continueEnabled }, "approval cannot be told here, and the checklist rows show their own state")
        c.expect(await MainActor.run { m.isAwaitingApproval }, "polling keeps asking")
    },
    Check("JoinPage: not joined after a join, or a no-join refusal, fails out loud") { c in
        let rt = ScriptedRt()
        rt.streamLines = joinOkLines
        rt.answers = ["setup join-status --json": (0, statusJSON("not-joined", since: nil))]
        let m = await makeModel(rt)
        await m.join()
        guard case .failed(let detail, let remedy) = await MainActor.run(body: { m.phase }) else { c.fail("expected failed, got \(await MainActor.run { m.phase })"); return }
        c.expectEqual(detail, "rt setup join-status returned an unexpected reply.")
        c.expect(remedy != nil)

        let refused = ScriptedRt()
        refused.answers = ["setup join-status --json": (2, #"{"contract":1,"at":"2026-10-29T10:05:00.000Z","error":{"code":"no-join","message":"This Mac has not joined a team"}}"#)]
        let r = await makeModel(refused)
        await r.check()
        guard case .failed(let refusal, _) = await MainActor.run(body: { r.phase }) else { c.fail("expected failed, got \(await MainActor.run { r.phase })"); return }
        c.expectEqual(refusal, "This Mac has not joined a team")
    },
    Check("JoinPage: polling checks only while waiting, and stops") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup join-status --json": (0, statusJSON("waiting"))]
        let m = await makeModel(rt)
        await MainActor.run { m.startPolling(every: 0.02) }
        try? await Task.sleep(nanoseconds: 120_000_000)
        c.expectEqual(rt.calls.count, 0, "a page that has not joined has nothing to poll")
        await m.check()
        let afterCheck = rt.calls.count
        try? await Task.sleep(nanoseconds: 150_000_000)
        c.expect(rt.calls.count > afterCheck, "a waiting page asks again on its own")
        await MainActor.run { m.stopPolling() }
        try? await Task.sleep(nanoseconds: 50_000_000)
        let stopped = rt.calls.count
        try? await Task.sleep(nanoseconds: 120_000_000)
        c.expectEqual(rt.calls.count, stopped, "no checks once the page is gone")
    },
    Check("JoinPage: the launch check reads a refusal or a failure as not joining") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup join-status --json": (0, statusJSON("waiting"))]
        c.expectEqual(await JoinPageModel.launchStatus(rt: rt)?.state, "waiting")
        rt.answers = ["setup join-status --json": (2, #"{"contract":1,"at":"x","error":{"code":"no-join","message":"This Mac has not joined a team"}}"#)]
        c.expect(await JoinPageModel.launchStatus(rt: rt) == nil)
        rt.answers = ["setup join-status --json": (1, "")]
        c.expect(await JoinPageModel.launchStatus(rt: rt) == nil)
    },
    Check("JoinPage: a new pass through Your team starts the page over") { c in
        let rt = ScriptedRt()
        rt.answers = ["setup join-status --json": (2, "")]
        let m = await makeModel(rt)
        let status = try JSONDecoder().decode(JoinStatus.self, from: Data(statusJSON("waiting").utf8))
        await MainActor.run { m.adopt(status) }
        await m.check()
        await MainActor.run { m.reset() }
        c.expectEqual(await MainActor.run { m.phase }, .needsToken)
        c.expect(await MainActor.run { !m.joinLanded && m.lastStatus == nil && m.checkError == nil && m.logLines.isEmpty })
    },
    Check("JoinPage: adopting a waiting status lands on the wait") { c in
        let m = await makeModel(ScriptedRt())
        let status = try JSONDecoder().decode(JoinStatus.self, from: Data(statusJSON("waiting").utf8))
        await MainActor.run { m.adopt(status) }
        c.expectEqual(await MainActor.run { m.phase }, .waiting(status))
        c.expect(await MainActor.run { m.joinLanded })
    },
]
