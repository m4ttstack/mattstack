import Foundation
import MattstackCore

private func row(_ id: String, _ status: RowStatus, action: Bool = false) -> PlanRow {
    PlanRow(id: id, kind: .tool, title: id.uppercased(), why: "w", required: false, status: status,
            action: action ? RowAction(type: .openURL, label: "Open") : nil, recheck: .manual)
}

private let sample = [
    PlanGroup(id: "mac", title: "Your Mac", rows: [row("a", .ready), row("b", .needsYou), row("c", .skipped)]),
    PlanGroup(id: "accounts", title: "Accounts", rows: [row("d", .ready), row("e", .ready, action: true)]),
    PlanGroup(id: "rt", title: "rt on this Mac", rows: [row("f", .missing), row("g", .skipped, action: true), row("h", .error)]),
    PlanGroup(id: "empty", title: "Empty", rows: []),
]

let checklistLayoutChecks: [Check] = [
    Check("ChecklistLayout: rows that need something are gathered in plan order, tagged with their group") { c in
        let layout = ChecklistLayout.make(sample)
        c.expectEqual(layout.attention.map(\.row.id), ["b", "f", "g", "h"])
        c.expectEqual(layout.attention.map(\.groupTitle), ["Your Mac", "rt on this Mac", "rt on this Mac", "rt on this Mac"])
    },
    Check("ChecklistLayout: a skipped row is settled only when it offers nothing to do") { c in
        let layout = ChecklistLayout.make(sample)
        c.expect(layout.sections[0].settled.map(\.id).contains("c"), "skipped with no action is not needed here")
        c.expect(layout.sections[2].needing.map(\.id).contains("g"), "skipped with an action is still something the user can do")
    },
    Check("ChecklistLayout: a section keeps every row of its group, the ones that need something first") { c in
        let layout = ChecklistLayout.make(sample)
        c.expectEqual(layout.sections.map(\.id), ["mac", "accounts", "rt"], "a group with no rows has no section")
        c.expectEqual(layout.sections[0].needing.map(\.id), ["b"])
        c.expectEqual(layout.sections[0].settled.map(\.id), ["a", "c"])
        c.expectEqual(layout.sections[1].settled.map(\.id), ["d", "e"], "a ready row is settled even when it keeps an action")
        c.expectEqual(layout.sections[2].settled.map(\.id), [])
    },
    Check("ChecklistLayout.entries: Needs you leads when anything does, then one entry per section with its row count") { c in
        let entries = ChecklistLayout.make(sample).entries
        c.expectEqual(entries.map(\.id), [ChecklistLayout.needsYouID, "mac", "accounts", "rt"])
        c.expectEqual(entries.map(\.title), ["Needs you", "Your Mac", "Accounts", "rt on this Mac"])
        c.expectEqual(entries.map(\.count), [4, 3, 2, 3])
        c.expectEqual(entries.map(\.status), [.needsYou, .needsYou, .ready, .needsYou])
    },
    Check("ChecklistLayout.entries: nothing needing you means no Needs you entry") { c in
        let layout = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .ready), row("b", .skipped)])])
        c.expectEqual(layout.entries.map(\.id), ["x"])
        c.expectEqual(layout.entries.map(\.status), [.ready])
    },
    Check("ChecklistLayout.selection: lands on Needs you, else the first section, and keeps a pick that still exists") { c in
        let layout = ChecklistLayout.make(sample)
        c.expectEqual(layout.selection(preferred: nil), ChecklistLayout.needsYouID)
        c.expectEqual(layout.selection(preferred: "accounts"), "accounts")
        c.expectEqual(layout.selection(preferred: "gone"), ChecklistLayout.needsYouID, "a group that left the plan falls back")
        let clean = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .ready)])])
        c.expectEqual(clean.selection(preferred: nil), "x")
        c.expectEqual(clean.selection(preferred: ChecklistLayout.needsYouID), "x", "Needs you empties once everything is fixed")
        c.expectEqual(ChecklistLayout.make([]).selection(preferred: nil), nil)
    },
    Check("ChecklistLayout.summary: counts each kind once and leaves out the empty ones") { c in
        c.expectEqual(ChecklistLayout.make(sample).summary.map(\.text), ["4 need you", "3 ready", "1 not needed here"])
        c.expectEqual(ChecklistLayout.make(sample).summary.map(\.status), [.needsYou, .ready, .skipped])
        c.expectEqual(ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .ready)])]).summary.map(\.text), ["1 ready"])
        c.expectEqual(ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .needsYou)])]).summary.map(\.text), ["1 needs you"])
        c.expectEqual(ChecklistLayout.make([]).summary.map(\.text), [])
    },
]
