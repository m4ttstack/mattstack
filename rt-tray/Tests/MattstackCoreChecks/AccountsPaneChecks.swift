import Foundation
import MattstackCore

private func planWithSlack(_ slack: RowStatus) -> Plan {
    let slackRow = PlanRow(id: "account.slack", kind: .account, title: "Slack", why: "w", required: true, status: slack,
                           detail: "no Slack account connected",
                           action: RowAction(type: .oauth, label: "Connect", integration: "slack", verb: ["setup", "slack", "connect"]),
                           recheck: .onChange)
    let github = PlanRow(id: "account.github", kind: .account, title: "GitHub", why: "w", required: true, status: .ready, recheck: .onChange)
    let tool = PlanRow(id: "tool.herdr", kind: .tool, title: "herdr", why: "w", required: false, status: .missing, recheck: .onChange)
    return Plan(at: "t", team: TeamInfo(slug: "claimview", name: "claimview", mode: .join),
                groups: [PlanGroup(id: "accounts", title: "Accounts", rows: [github, slackRow]),
                         PlanGroup(id: "tools", title: "Tools", rows: [tool])],
                canInstall: slack == .ready, requiredMissing: slack == .ready ? [] : ["account.slack"], finishBlockedBy: [])
}

let accountsPaneChecks: [Check] = [
    Check("Settings > Accounts shows every account row, the unconnected Slack one with its Connect action, and nothing else") { c in
        let m = await MainActor.run { ReadinessModel(plans: FakePlans([planWithSlack(.missing)]), permissions: FakePermissions(), ticker: FakeTicker()) }
        await m.load()
        await MainActor.run {
            let groups = m.groups(for: .accounts)
            c.expectEqual(groups.map(\.id), ["accounts"])
            c.expectEqual(groups.flatMap(\.rows).map(\.id), ["account.github", "account.slack"])
            let slack = groups.flatMap(\.rows).first { $0.id == "account.slack" }
            c.expectEqual(slack?.action?.type, .oauth)
            c.expectEqual(RowActionDispatcher.dispatch(slack!.action!, fieldValues: nil, alternative: nil),
                          .rtVerb(args: ["setup", "slack", "connect", "--json"], stdin: nil))
        }
    },
    Check("the full checklist scope keeps every group") { c in
        let m = await MainActor.run { ReadinessModel(plans: FakePlans([planWithSlack(.ready)]), permissions: FakePermissions(), ticker: FakeTicker()) }
        await m.load()
        await MainActor.run { c.expectEqual(m.groups(for: .all).map(\.id), ["accounts", "tools"]) }
    },
]
