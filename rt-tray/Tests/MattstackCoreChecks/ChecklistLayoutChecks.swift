import Foundation
import MattstackCore

private func row(_ id: String, _ status: RowStatus, required: Bool = false, action: Bool = false,
                 finishGated: Bool = false) -> PlanRow {
    PlanRow(id: id, kind: .tool, title: id.uppercased(), why: "w", required: required, status: status,
            action: action ? RowAction(type: .openURL, label: "Open") : nil, recheck: .manual, finishGated: finishGated)
}

let layoutSample = [
    PlanGroup(id: "mac", title: "Your Mac", rows: [row("a", .ready), row("b", .missing, required: true, action: true), row("c", .skipped)]),
    PlanGroup(id: "accounts", title: "Accounts", rows: [row("d", .ready), row("e", .needsYou, action: true)]),
    PlanGroup(id: "agents", title: "Agents and editors", rows: [row("f", .missing), row("style", .needsYou, action: true, finishGated: true), row("h", .error)]),
    PlanGroup(id: "empty", title: "Empty", rows: []),
]

let checklistLayoutChecks: [Check] = [
    Check("ChecklistLayout: each section keeps every row of its group, split three ways in plan order") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
        c.expectEqual(layout.sections.map(\.id), ["mac", "accounts", "agents"], "a group with no rows has no section")
        c.expectEqual(layout.sections[0].needsYou.map(\.id), ["b"])
        c.expectEqual(layout.sections[0].optional.map(\.id), [])
        c.expectEqual(layout.sections[0].noAction.map(\.id), ["a", "c"])
        c.expectEqual(layout.sections[1].optional.map(\.id), ["e"])
        c.expectEqual(layout.sections[2].needsYou.map(\.id), ["style"])
        c.expectEqual(layout.sections[2].optional.map(\.id), ["h"])
        c.expectEqual(layout.sections[2].noAction.map(\.id), ["f"])
        c.expectEqual(layout.sections.map(\.count), [3, 2, 3])
    },
    Check("ChecklistLayout.attention: only rows that block Install or Finish, tagged with their group") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
        c.expectEqual(layout.attention.map(\.row.id), ["b", "style"])
        c.expectEqual(layout.attention.map(\.groupTitle), ["Your Mac", "Agents and editors"])
    },
    Check("ChecklistLayout: a finish-gated row nobody is blocked on is not attention") { c in
        let layout = ChecklistLayout.make(layoutSample)
        c.expectEqual(layout.attention.map(\.row.id), ["b"])
        c.expectEqual(layout.sections[2].optional.map(\.id), ["style", "h"])
    },
    Check("ChecklistLayout.summary: need you first and only when above zero, then ready, optional, not needed") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
        c.expectEqual(layout.summary.map(\.text), ["2 need you", "2 ready", "2 optional", "1 not needed here"])
        c.expectEqual(layout.summary.map(\.kind), [.needsYou, .ready, .optional, .notNeeded])
        let clean = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .ready)])])
        c.expectEqual(clean.summary.map(\.text), ["1 ready"])
        let one = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .missing, required: true)])])
        c.expectEqual(one.summary.map(\.text), ["1 needs you"])
        c.expectEqual(ChecklistLayout.make([]).summary.map(\.text), [])
    },
]
