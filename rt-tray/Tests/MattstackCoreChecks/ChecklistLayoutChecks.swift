import Foundation
import MattstackCore

private func row(_ id: String, _ status: RowStatus, action: Bool = false) -> PlanRow {
    PlanRow(id: id, kind: .tool, title: id.uppercased(), why: "w", required: false, status: status,
            action: action ? RowAction(type: .openURL, label: "Open") : nil, recheck: .manual)
}

private let sample = [
    PlanGroup(id: "mac", title: "Your Mac", rows: [row("a", .ready), row("b", .needsYou), row("c", .skipped)]),
    PlanGroup(id: "accounts", title: "Accounts", rows: [row("d", .ready), row("e", .ready, action: true)]),
    PlanGroup(id: "tools", title: "Tools", rows: [row("f", .missing), row("g", .skipped, action: true), row("h", .error)]),
]

let checklistLayoutChecks: [Check] = [
    Check("ChecklistLayout: rows that need something leave their group and lead, in plan order, tagged with the group") { c in
        let layout = ChecklistLayout.make(sample)
        c.expectEqual(layout.attention.map(\.row.id), ["b", "f", "g", "h"])
        c.expectEqual(layout.attention.map(\.groupTitle), ["Your Mac", "Tools", "Tools", "Tools"])
    },
    Check("ChecklistLayout: a skipped row folds only when it offers nothing to do") { c in
        let layout = ChecklistLayout.make(sample)
        c.expect(layout.groups[0].rows.map(\.id).contains("c"), "skipped with no action is not needed here")
        c.expect(layout.attention.map(\.row.id).contains("g"), "skipped with an action is still something the user can do")
    },
    Check("ChecklistLayout: a ready row folds even when it keeps an action") { c in
        let layout = ChecklistLayout.make(sample)
        c.expectEqual(layout.groups[1].rows.map(\.id), ["d", "e"])
    },
    Check("ChecklistLayout: a group with nothing folded is dropped, and the rest keep plan order") { c in
        let layout = ChecklistLayout.make(sample)
        c.expectEqual(layout.groups.map(\.id), ["mac", "accounts"])
    },
    Check("ChecklistLayout: a group's count names how many of its rows are ready") { c in
        let layout = ChecklistLayout.make(sample)
        c.expectEqual(layout.groups[0].countText, "1 of 3 ready")
        c.expectEqual(layout.groups[0].attentionCount, 1)
        c.expectEqual(layout.groups[1].countText, "2 ready", "every row ready needs no denominator")
        c.expectEqual(layout.groups[1].attentionCount, 0)
    },
    Check("ChecklistLayout.summary: counts each kind once and leaves out the empty ones") { c in
        c.expectEqual(ChecklistLayout.make(sample).summary.map(\.text), ["4 need you", "3 ready", "1 not needed here"])
        c.expectEqual(ChecklistLayout.make(sample).summary.map(\.status), [.needsYou, .ready, .skipped])
        c.expectEqual(ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .ready)])]).summary.map(\.text), ["1 ready"])
        c.expectEqual(ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .needsYou)])]).summary.map(\.text), ["1 needs you"])
        c.expectEqual(ChecklistLayout.make([]).summary.map(\.text), [])
    },
]
