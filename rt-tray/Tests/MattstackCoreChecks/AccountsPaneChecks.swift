import Foundation
import MattstackCore

private func planWithSlack(_ slack: RowStatus) -> Plan {
    let slackRow = PlanRow(id: "account.slack", kind: .account, title: "Slack", why: "w", required: true, status: slack,
                           detail: "no Slack account connected",
                           action: RowAction(type: .oauth, label: "Connect", integration: "slack", verb: ["setup", "slack", "connect"]),
                           recheck: .onChange)
    let github = PlanRow(id: "account.github", kind: .account, title: "GitHub", why: "w", required: true, status: .ready, recheck: .onChange)
    let tool = PlanRow(id: "tool.herdr", kind: .tool, title: "herdr", why: "w", required: false, status: .missing, recheck: .onChange)
    return Plan(at: "t", team: TeamInfo(slug: "acme", name: "Acme", mode: .join),
                groups: [PlanGroup(id: "accounts", title: "Accounts", rows: [github, slackRow]),
                         PlanGroup(id: "tools", title: "Tools", rows: [tool])],
                canInstall: slack == .ready, requiredMissing: slack == .ready ? [] : ["account.slack"], finishBlockedBy: [])
}

/// Mirrors what lib/setup/validators/accounts.ts plans for a solo install with no forge account.
private func soloForgePlan() -> Plan {
    let github = PlanRow(id: "account.github", kind: .account, title: "GitHub",
                         why: "Lets rt open PRs, check CI status, and read repo metadata on GitHub.", required: false,
                         optionalNote: "Works without this. Connect GitHub to open PRs from rt.",
                         status: .missing, detail: "No GitHub account connected yet",
                         action: RowAction(type: .connect, label: "Connect", integration: "github",
                                           fields: [ActionField(name: "token", label: "GitHub token", secret: true, hint: "repo, read:org")]),
                         recheck: .onChange)
    let gitlab = PlanRow(id: "account.gitlab", kind: .account, title: "GitLab",
                         why: "Lets rt open MRs, check pipelines, and read project metadata on GitLab.", required: false,
                         optionalNote: "Works without this. Connect GitLab to open MRs from rt. On your own GitLab server, connect from a terminal with rt setup gitlab connect --host <host>.",
                         status: .missing, detail: "No GitLab account connected yet",
                         action: RowAction(type: .connect, label: "Connect", integration: "gitlab",
                                           fields: [ActionField(name: "token", label: "GitLab token", secret: true, hint: "api")]),
                         recheck: .onChange)
    return Plan(at: "t", team: TeamInfo(slug: "", name: "", mode: .noTeam),
                groups: [PlanGroup(id: "accounts", title: "Accounts", rows: [github, gitlab])],
                canInstall: true, requiredMissing: [], finishBlockedBy: [])
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
    Check("on a solo install Settings > Accounts shows the GitHub and GitLab rows, and GitLab's Connect runs gitlab connect") { c in
        let m = await MainActor.run { ReadinessModel(plans: FakePlans([soloForgePlan()]), permissions: FakePermissions(), ticker: FakeTicker()) }
        await m.load()
        await MainActor.run {
            let rows = m.groups(for: .accounts).flatMap(\.rows)
            c.expectEqual(rows.map(\.id), ["account.github", "account.gitlab"])
            let gitlab = rows.first { $0.id == "account.gitlab" }
            c.expectEqual(RowActionDispatcher.dispatch(gitlab!.action!, fieldValues: ["token": "t"], alternative: nil),
                          .rtVerb(args: ["setup", "gitlab", "connect", "--json"], stdin: Data("{\"token\":\"t\"}".utf8)))
        }
    },
    Check("only Permissions runs the 1 s readiness tick; Accounts refreshes on appear and after each action") { c in
        c.expectEqual(SettingsPane.allCases.filter(\.watchesReadiness), [.permissions])
    },
]
