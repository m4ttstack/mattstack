import Foundation
import MattstackCore

private func flowRow(_ id: String, _ status: RowStatus, required: Bool = false) -> PlanRow {
    PlanRow(id: id, kind: .tool, title: id, why: "w", required: required, status: status, recheck: .manual)
}
private let flowGroups = [
    PlanGroup(id: "mac", title: "Your Mac", rows: [flowRow("a", .ready)]),
    PlanGroup(id: "accounts", title: "Accounts", rows: [flowRow("b", .missing, required: true)]),
    PlanGroup(id: "rt", title: "rt on this Mac", rows: [flowRow("c", .ready)]),
]

let setupFlowChecks: [Check] = [
    Check("SetupStep order and titles") { c in
        c.expectEqual(SetupStep.allCases.map(\.rawValue), [0, 1, 2, 3, 4])
        c.expectEqual(SetupStep.team.title, "Your team")
        c.expectEqual(SetupStep.checklist.title, "Before we begin")
        c.expectEqual(SetupStep.done.title, "Summary")
    },
    Check("flow header: a wizard page is named after its group and counted among every page") { c in
        await MainActor.run {
            let wizard = SetupFlowModel()
            c.expectEqual(wizard.headerIndicator, "Step 1 of 5", "before a plan there is one checklist page")
            wizard.jump(to: .checklist)
            c.expectEqual(wizard.headerTitle, "Before we begin")
            c.expectEqual(wizard.headerIndicator, "Step 3 of 5")
            wizard.setPages(flowGroups)
            c.expectEqual(wizard.page, "mac")
            c.expectEqual(wizard.headerTitle, "Your Mac")
            c.expectEqual(wizard.headerIndicator, "Step 3 of 7")
            c.expectEqual(wizard.progress?.current, 3); c.expectEqual(wizard.progress?.total, 7)
            wizard.next()
            c.expectEqual(wizard.headerTitle, "Accounts"); c.expectEqual(wizard.headerIndicator, "Step 4 of 7")
            wizard.jump(to: .done)
            c.expectEqual(wizard.headerIndicator, "Step 7 of 7")
            let status = SetupFlowModel(readOnly: true)
            status.jump(to: .checklist); status.setPages(flowGroups)
            c.expectEqual(status.headerTitle, "Setup status", "nothing is about to begin on a Mac that is already set up")
            c.expectEqual(status.headerIndicator, nil, "the status window is not a step of anything")
            c.expectEqual(status.progress == nil, true)
        }
    },
    Check("flow: Continue walks the pages, the last page installs, Back walks them in reverse") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            c.expectEqual(f.step, .welcome); c.expectEqual(f.canGoBack, false); c.expectEqual(f.windowMayClose, false)
            f.back(); c.expectEqual(f.step, .welcome)
            f.next(); c.expectEqual(f.step, .team); c.expectEqual(f.canGoBack, true)
            f.next(); c.expectEqual(f.step, .checklist)
            f.setPages(flowGroups)
            c.expectEqual(f.continueTitle, "Continue"); c.expectEqual(f.isLastPage, false)
            f.next(); c.expectEqual(f.step, .checklist); c.expectEqual(f.page, "accounts")
            f.next(); c.expectEqual(f.page, "rt"); c.expectEqual(f.continueTitle, "Install"); c.expectEqual(f.isLastPage, true)
            f.back(); c.expectEqual(f.page, "accounts")
            f.next(); f.next(); c.expectEqual(f.step, .install)
            f.isInstalling = true; c.expectEqual(f.canGoBack, false)
            f.isInstalling = false; c.expectEqual(f.canGoBack, true)
            f.back(); c.expectEqual(f.step, .checklist); c.expectEqual(f.page, "rt", "Back from Install returns to the last page")
            f.back(); f.back(); c.expectEqual(f.page, "mac")
            f.back(); c.expectEqual(f.step, .team, "Back on the first page returns to Your team")
            f.jump(to: .done); c.expectEqual(f.continueTitle, "Finish")
            c.expectEqual(f.canGoBack, false); c.expectEqual(f.windowMayClose, true)
            f.next(); c.expectEqual(f.step, .done)
        }
    },
    Check("flow: a plan re-read keeps the page by id, and hands a vanished page to its position") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .checklist); f.setPages(flowGroups); f.next()
            c.expectEqual(f.page, "accounts")
            f.setPages([flowGroups[0], PlanGroup(id: "access", title: "Access", rows: flowGroups[1].rows), flowGroups[1], flowGroups[2]])
            c.expectEqual(f.page, "accounts", "a group appearing ahead does not move the user")
            f.setPages([flowGroups[0], flowGroups[2]])
            c.expectEqual(f.page, "rt", "its old position is past the end, so the last page")
            f.setPages([])
            c.expectEqual(f.page, nil); c.expectEqual(f.headerTitle, "Before we begin")
        }
    },
    Check("flow: a relaunch lands on the first page still holding an Install blocker") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .checklist, landing: true)
            f.setPages(flowGroups)
            c.expectEqual(f.page, "accounts")
            f.setPages(flowGroups)
            f.back(); c.expectEqual(f.page, "mac", "the landing applies once, not on every re-read")
        }
    },
    Check("flow: a page that vanishes mid-list hands over to the page now at its position") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            let last = PlanGroup(id: "tools", title: "Tools", rows: flowGroups[2].rows)
            f.jump(to: .checklist); f.setPages(flowGroups + [last]); f.next()
            c.expectEqual(f.page, "accounts")
            f.setPages([flowGroups[0], flowGroups[2], last])
            c.expectEqual(f.page, "rt")
            c.expectEqual(f.continueTitle, "Continue", "the page that took over is not the last")
            f.next(); c.expectEqual(f.page, "tools")
            f.back(); f.back(); c.expectEqual(f.page, "mac")
        }
    },
    Check("flow: the step after Install is the summary") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .install)
            f.next()
            c.expectEqual(f.step, .done)
            c.expectEqual(f.headerIndicator, "Step 5 of 5")
        }
    },
    Check("flow: setup entered again in the same session opens the checklist on its first page") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.next(); f.next(); f.setPages(flowGroups)
            f.next(); f.next(); f.next(); f.next()
            c.expectEqual(f.step, .done)
            f.jump(to: .team); f.next()
            c.expectEqual(f.step, .checklist)
            c.expectEqual(f.page, "mac")
            c.expectEqual(f.continueTitle, "Continue")
            f.setPages(flowGroups)
            c.expectEqual(f.page, "mac", "a re-read does not hand the page back to the last run's position")
        }
    },
    Check("flow: a landing asked of a wizard that already has its pages moves nobody") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .checklist); f.setPages(flowGroups)
            c.expectEqual(f.page, "mac")
            f.jump(to: .checklist, landing: true)
            f.setPages(flowGroups)
            c.expectEqual(f.page, "mac", "the next re-read must not move a person who is already on a page")
        }
    },
    Check("flow: a plan with one group installs from its only page") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .checklist); f.setPages([flowGroups[0]])
            c.expectEqual(f.continueTitle, "Install"); c.expectEqual(f.headerIndicator, "Step 3 of 5")
            f.back(); c.expectEqual(f.step, .team)
        }
    },
    Check("read-only flow (Setup status…): no Back, primary closes instead of installing, never starts a run") { c in
        await MainActor.run {
            let f = SetupFlowModel(readOnly: true)
            f.jump(to: .checklist)
            c.expectEqual(f.showsBack, false, "a health view has no wizard behind it to walk back into")
            c.expectEqual(f.canGoBack, false)
            c.expectEqual(f.continueTitle, "Close", "Install here would start a real rt setup apply")
            c.expectEqual(f.primaryClosesWindow, true)
            c.expectEqual(f.mayStartInstall, false)
            let wizard = SetupFlowModel()
            wizard.jump(to: .checklist)
            c.expectEqual(wizard.showsBack, true)
            c.expectEqual(wizard.continueTitle, "Install")
            c.expectEqual(wizard.primaryClosesWindow, false)
            c.expectEqual(wizard.mayStartInstall, true)
        }
    },
    Check("windowMayClose follows the one finish-gate boolean on Done and nowhere else") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .done)
            c.expectEqual(f.windowMayClose, true, "a flow nobody mirrors a gate into reads open")
            f.finishGateOpen = false
            c.expectEqual(f.windowMayClose, false, "a closed Finish closes the titlebar buttons too")
            c.expectEqual(f.continueTitle, "Finish")
            f.finishGateOpen = true
            c.expectEqual(f.windowMayClose, true)
            f.jump(to: .checklist)
            c.expectEqual(f.windowMayClose, false, "the gate never opens a non-Done step")
        }
    },
    Check("upgrade entry: no Back on the team screen, first run keeps it") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .team)
            c.expectEqual(f.canGoBack, true)
            f.entry = .upgrade
            c.expectEqual(f.canGoBack, false)
            f.next()
            c.expectEqual(f.canGoBack, true, "Back from the checklist to the team screen stays")
        }
    },
]
