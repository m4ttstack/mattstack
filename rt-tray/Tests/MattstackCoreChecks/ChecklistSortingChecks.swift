import Foundation
import MattstackCore

private func row(_ id: String, _ status: RowStatus, required: Bool = false, action: ActionType? = nil,
                 finishGated: Bool = false) -> PlanRow {
    PlanRow(id: id, kind: .tool, title: id, why: "w", required: required, status: status,
            action: action.map { RowAction(type: $0, label: "Do") }, recheck: .manual, finishGated: finishGated)
}

let checklistSortingChecks: [Check] = [
    Check("ChecklistSorting: a required row that is not ready blocks Install and needs you") { c in
        let r = row("a", .missing, required: true, action: .run)
        c.expect(ChecklistSorting.blocksInstall(r))
        c.expectEqual(ChecklistSorting.section(for: r, finishBlockedBy: []), .needsYou)
        c.expectEqual(ChecklistSorting.badge(for: r, finishBlockedBy: []), .required)
    },
    Check("ChecklistSorting: a required row with no action still needs you") { c in
        c.expectEqual(ChecklistSorting.section(for: row("a", .error, required: true), finishBlockedBy: []), .needsYou)
    },
    Check("ChecklistSorting: a row blocking Finish needs you with its own badge, and never blocks Install") { c in
        let r = row("style", .needsYou, action: .choose, finishGated: true)
        c.expect(!ChecklistSorting.blocksInstall(r))
        c.expectEqual(ChecklistSorting.section(for: r, finishBlockedBy: ["style"]), .needsYou)
        c.expectEqual(ChecklistSorting.badge(for: r, finishBlockedBy: ["style"]), .beforeFinish)
    },
    Check("ChecklistSorting: a required finish-gated row does not block Install") { c in
        c.expect(!ChecklistSorting.blocksInstall(row("x", .missing, required: true, finishGated: true)))
    },
    Check("ChecklistSorting: an optional row with something to press is Optional") { c in
        c.expectEqual(ChecklistSorting.section(for: row("a", .needsYou, action: .openSettings), finishBlockedBy: []), .optional)
        c.expectEqual(ChecklistSorting.section(for: row("b", .missing, action: .openURL), finishBlockedBy: []), .optional)
        c.expectEqual(ChecklistSorting.section(for: row("c", .skipped, action: .run), finishBlockedBy: []), .optional,
                      "a skipped row that still offers an action is something the user can do")
        c.expectEqual(ChecklistSorting.badge(for: row("a", .needsYou, action: .openSettings), finishBlockedBy: []), nil)
    },
    Check("ChecklistSorting: a broken optional row with no action is Optional, never filed as no action") { c in
        c.expectEqual(ChecklistSorting.section(for: row("a", .error), finishBlockedBy: []), .optional)
        c.expectEqual(ChecklistSorting.section(for: row("b", .invalid), finishBlockedBy: []), .optional)
    },
    Check("ChecklistSorting: after Install, a row that is not ready and has nothing to press is Optional") { c in
        c.expectEqual(ChecklistSorting.section(for: row("a", .needsYou), finishBlockedBy: [], afterInstall: true), .optional)
        c.expectEqual(ChecklistSorting.section(for: row("b", .missing), finishBlockedBy: [], afterInstall: true), .optional)
        c.expectEqual(ChecklistSorting.section(for: row("c", .skipped), finishBlockedBy: [], afterInstall: true), .noAction,
                      "not needed here stays settled")
        c.expectEqual(ChecklistSorting.section(for: row("d", .ready), finishBlockedBy: [], afterInstall: true), .noAction)
        c.expectEqual(ChecklistSorting.section(for: row("e", .missing, required: true), finishBlockedBy: [], afterInstall: true), .needsYou)
        c.expectEqual(ChecklistSorting.section(for: row("a", .needsYou), finishBlockedBy: []), .noAction,
                      "before Install it is Install's to set")
    },
    Check("ChecklistSorting: a ready row never blocks Install, and one Finish waits on still needs you") { c in
        c.expect(!ChecklistSorting.blocksInstall(row("a", .ready, required: true)))
        c.expectEqual(ChecklistSorting.section(for: row("b", .ready), finishBlockedBy: ["b"]), .needsYou)
    },
    Check("ChecklistSorting: ready, skipped, and rows Install handles need no action") { c in
        c.expectEqual(ChecklistSorting.section(for: row("a", .ready, action: .run), finishBlockedBy: []), .noAction,
                      "a ready row is settled even when it keeps an action")
        c.expectEqual(ChecklistSorting.section(for: row("b", .skipped), finishBlockedBy: []), .noAction)
        c.expectEqual(ChecklistSorting.section(for: row("c", .missing), finishBlockedBy: []), .noAction,
                      "missing with nothing to press is Install's to set")
        c.expectEqual(ChecklistSorting.section(for: row("d", .needsYou), finishBlockedBy: []), .noAction)
        c.expectEqual(ChecklistSorting.section(for: row("e", .missing, action: .unknown), finishBlockedBy: []), .noAction,
                      "an action this app cannot draw is no action")
    },
]
