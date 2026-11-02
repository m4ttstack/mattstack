import Foundation
import MattstackCore

private func row(_ id: String, _ status: RowStatus, required: Bool = false, action: ActionType? = nil,
                 finishGated: Bool = false, waivable: Bool = false, waived: Bool = false, information: Bool = false,
                 waitsForInstall: Bool = false) -> PlanRow {
    PlanRow(id: id, kind: .tool, title: id, why: "w", required: required, status: status,
            action: action.map { RowAction(type: $0, label: "Do") }, recheck: .manual, finishGated: finishGated,
            waived: waived, waivable: waivable, information: information, waitsForInstall: waitsForInstall)
}

let checklistSortingChecks: [Check] = [
    Check("ChecklistSorting: a required row that is not ready blocks Install and needs you, with no badge") { c in
        let r = row("a", .missing, required: true, action: .run)
        c.expect(ChecklistSorting.blocksInstall(r))
        c.expectEqual(ChecklistSorting.section(for: r, finishBlockedBy: []), .needsYou)
        c.expectEqual(ChecklistSorting.badge(for: r, finishBlockedBy: []), nil, "everything is required, so nothing says so")
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
    Check("ChecklistSorting: a skippable row that is not done sits in You can skip") { c in
        let r = row("tool.mission-control", .needsYou, action: .openSettings, finishGated: true, waivable: true)
        c.expectEqual(ChecklistSorting.section(for: r, finishBlockedBy: ["tool.mission-control"]), .canSkip,
                      "Finish waits on it, but it is never filed under Needs you")
        c.expectEqual(ChecklistSorting.section(for: row("b", .missing, finishGated: true, waivable: true), finishBlockedBy: []), .canSkip)
        c.expectEqual(ChecklistSorting.section(for: row("c", .ready, finishGated: true, waivable: true), finishBlockedBy: []), .noAction)
        c.expectEqual(ChecklistSorting.section(for: row("d", .skipped, finishGated: true, waivable: true), finishBlockedBy: []), .noAction)
    },
    Check("ChecklistSorting: a skipped row needs no action") { c in
        let r = row("tool.mission-control", .needsYou, action: .openSettings, finishGated: true, waivable: true, waived: true)
        c.expectEqual(ChecklistSorting.section(for: r, finishBlockedBy: []), .noAction)
    },
    Check("ChecklistSorting: an information row needs no action whatever its state") { c in
        for status in [RowStatus.ready, .needsYou, .missing, .error, .invalid, .skipped] {
            c.expectEqual(ChecklistSorting.section(for: row("team.push-access", status, required: true, action: .connect, information: true),
                                                   finishBlockedBy: ["team.push-access"]), .noAction, "\(status)")
        }
    },
    Check("ChecklistSorting: a row that is not required and not ready still needs you") { c in
        c.expectEqual(ChecklistSorting.section(for: row("a", .needsYou, action: .openSettings), finishBlockedBy: []), .needsYou)
        c.expectEqual(ChecklistSorting.section(for: row("b", .missing), finishBlockedBy: []), .needsYou)
        c.expectEqual(ChecklistSorting.section(for: row("c", .error), finishBlockedBy: []), .needsYou)
        c.expectEqual(ChecklistSorting.section(for: row("d", .invalid), finishBlockedBy: []), .needsYou)
        c.expectEqual(ChecklistSorting.badge(for: row("a", .needsYou, action: .openSettings), finishBlockedBy: []), nil)
    },
    Check("ChecklistSorting: an old waiver on a row that cannot be skipped still needs you") { c in
        let r = row("tool.fast-browser-extension", .needsYou, action: .openURL, finishGated: true, waivable: false, waived: true)
        c.expectEqual(ChecklistSorting.section(for: r, finishBlockedBy: ["tool.fast-browser-extension"]), .needsYou)
        c.expectEqual(ChecklistSorting.section(for: r, finishBlockedBy: []), .needsYou, "a waiver rt does not honor settles nothing")
    },
    Check("ChecklistSorting: a row waiting for Install needs no action before Install") { c in
        c.expectEqual(ChecklistSorting.section(for: row("tool.daemon", .missing, action: .run, waitsForInstall: true), finishBlockedBy: []), .noAction)
        c.expectEqual(ChecklistSorting.section(for: row("perm.login-items", .needsYou, action: .run, waitsForInstall: true), finishBlockedBy: []), .noAction)
        c.expectEqual(ChecklistSorting.section(for: row("skills.writing-style", .needsYou, finishGated: true, waitsForInstall: true),
                                               finishBlockedBy: ["skills.writing-style"]), .noAction, "Finish still waits on it, but not before Install")
        c.expectEqual(ChecklistSorting.section(for: row("x", .missing, required: true, waitsForInstall: true), finishBlockedBy: []), .needsYou,
                      "a row that blocks Install is never filed away")
    },
    Check("ChecklistSorting: a ready row never blocks Install, and one Finish waits on still needs you") { c in
        c.expect(!ChecklistSorting.blocksInstall(row("a", .ready, required: true)))
        c.expectEqual(ChecklistSorting.section(for: row("b", .ready), finishBlockedBy: ["b"]), .needsYou)
    },
    Check("ChecklistSorting: ready and skipped rows need no action") { c in
        c.expectEqual(ChecklistSorting.section(for: row("a", .ready, action: .run), finishBlockedBy: []), .noAction,
                      "a ready row is settled even when it keeps an action")
        c.expectEqual(ChecklistSorting.section(for: row("b", .skipped), finishBlockedBy: []), .noAction)
        c.expectEqual(ChecklistSorting.section(for: row("c", .skipped, action: .run), finishBlockedBy: []), .noAction)
    },
]
