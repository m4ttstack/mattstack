import Foundation
import MattstackCore

private func row(_ id: String, _ status: RowStatus, required: Bool = false, action: Bool = false,
                 finishGated: Bool = false, waivable: Bool = false, waived: Bool = false, information: Bool = false) -> PlanRow {
    PlanRow(id: id, kind: .tool, title: id.uppercased(), why: "w", required: required, status: status,
            action: action ? RowAction(type: .openURL, label: "Open") : nil, recheck: .manual, finishGated: finishGated,
            waived: waived, waivable: waivable, information: information)
}

let layoutSample = [
    PlanGroup(id: "mac", title: "Your Mac", rows: [row("a", .ready), row("b", .missing, required: true, action: true), row("c", .skipped),
                                                   row("i", .needsYou, information: true)]),
    PlanGroup(id: "accounts", title: "Accounts", rows: [row("d", .ready), row("e", .needsYou, action: true)]),
    PlanGroup(id: "agents", title: "Agents and editors", rows: [
        row("style", .needsYou, action: true, finishGated: true),
        row("m", .needsYou, action: true, finishGated: true, waivable: true),
        row("w", .needsYou, action: true, finishGated: true, waivable: true, waived: true),
    ]),
    PlanGroup(id: "empty", title: "Empty", rows: []),
]
private let blocked = ["style", "m"]

let checklistLayoutChecks: [Check] = [
    Check("ChecklistLayout: each section keeps every row of its group, split three ways in plan order") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: blocked)
        c.expectEqual(layout.sections.map(\.id), ["mac", "accounts", "agents"], "a group with no rows has no section")
        c.expectEqual(layout.sections[0].needsYou.map(\.id), ["b"])
        c.expectEqual(layout.sections[0].canSkip.map(\.id), [])
        c.expectEqual(layout.sections[0].noAction.map(\.id), ["a", "c", "i"])
        c.expectEqual(layout.sections[1].needsYou.map(\.id), ["e"])
        c.expectEqual(layout.sections[1].noAction.map(\.id), ["d"])
        c.expectEqual(layout.sections[2].needsYou.map(\.id), ["style"])
        c.expectEqual(layout.sections[2].canSkip.map(\.id), ["m"])
        c.expectEqual(layout.sections[2].noAction.map(\.id), ["w"])
        c.expectEqual(layout.sections.map(\.count), [4, 2, 3])
    },
    Check("ChecklistLayout.attention: every row that needs you, tagged with its group; a row you can skip is not one") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: blocked)
        c.expectEqual(layout.attention.map(\.row.id), ["b", "e", "style"])
        c.expectEqual(layout.attention.map(\.groupTitle), ["Your Mac", "Accounts", "Agents and editors"])
    },
    Check("ChecklistLayout.summary: need you first and only when above zero, then ready, skipped, not needed") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: blocked)
        c.expectEqual(layout.summary.map(\.text), ["3 need you", "2 ready", "1 skipped", "1 not needed here"])
        c.expectEqual(layout.summary.map(\.kind), [.needsYou, .ready, .skipped, .notNeeded])
        let clean = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .ready)])])
        c.expectEqual(clean.summary.map(\.text), ["1 ready"])
        let one = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .missing, required: true)])])
        c.expectEqual(one.summary.map(\.text), ["1 needs you"])
        c.expectEqual(ChecklistLayout.make([]).summary.map(\.text), [])
    },
    Check("ChecklistLayout: the summary says N skipped, never optional") { c in
        let skipped = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [
            row("w1", .needsYou, finishGated: true, waivable: true, waived: true),
            row("w2", .missing, finishGated: true, waivable: true, waived: true),
            row("o", .needsYou, action: true),
        ])])
        c.expectEqual(skipped.summary.map(\.text), ["1 needs you", "2 skipped"])
        c.expect(!skipped.summary.contains { $0.text.contains("optional") })
        c.expect(!ChecklistLayout.make(layoutSample, finishBlockedBy: blocked).summary.contains { $0.text.contains("optional") })
    },
    Check("ChecklistLayout.entries: Needs you leads when anything does, then Overview when asked, then the groups") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: blocked)
        let wizard = layout.entries(overview: true, running: [], failed: [])
        c.expectEqual(wizard.map(\.id), [ChecklistLayout.needsYouID, ChecklistLayout.overviewID, "mac", "accounts", "agents"])
        c.expectEqual(wizard.map(\.title), ["Needs you", "Overview", "Your Mac", "Accounts", "Agents and editors"])
        c.expectEqual(wizard.map(\.count), [3, nil, 4, 2, 3])
        c.expectEqual(wizard.map(\.mark), [.needsYou, .overview, .needsYou, .needsYou, .needsYou])
        let status = layout.entries(overview: false, running: [], failed: [])
        c.expectEqual(status.map(\.id), [ChecklistLayout.needsYouID, "mac", "accounts", "agents"])
    },
    Check("ChecklistLayout.entries: a row you can skip still marks its group, since Finish waits on it; a skipped one does not") { c in
        let open = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .ready), row("m", .needsYou, finishGated: true, waivable: true)])],
                                        finishBlockedBy: ["m"])
        c.expectEqual(open.attention.map(\.row.id), [])
        c.expectEqual(open.entries(overview: false, running: [], failed: []).map(\.mark), [.needsYou])
        let skipped = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [
            row("a", .ready), row("m", .needsYou, finishGated: true, waivable: true, waived: true)])])
        c.expectEqual(skipped.entries(overview: false, running: [], failed: []).map(\.mark), [.settled])
    },
    Check("ChecklistLayout.entries: a failed row outranks a running one, which outranks needing you") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: blocked)
        let marks = { (running: Set<String>, failed: Set<String>) in
            Dictionary(uniqueKeysWithValues: layout.entries(overview: false, running: running, failed: failed).map { ($0.id, $0.mark) })
        }
        c.expectEqual(marks(["e"], [])["accounts"], .running)
        c.expectEqual(marks(["b"], [])["mac"], .running, "running shows over needs you")
        c.expectEqual(marks(["b"], ["a"])["mac"], .failed)
        c.expectEqual(marks(["zzz"], ["zzz"])["mac"], .needsYou, "a row id from another plan marks nothing")
        c.expectEqual(marks(["b"], [])[ChecklistLayout.needsYouID], .needsYou, "the Needs you entry keeps its own mark")
    },
    Check("ChecklistLayout.selection: Needs you, else Overview when offered, else All; a pick that exists is kept, All included") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: blocked)
        c.expectEqual(layout.selection(preferred: nil, overview: true), ChecklistLayout.needsYouID)
        c.expectEqual(layout.selection(preferred: "accounts", overview: true), "accounts")
        c.expectEqual(layout.selection(preferred: "gone", overview: false), ChecklistLayout.needsYouID)
        c.expectEqual(layout.selection(preferred: ChecklistLayout.allID, overview: true), ChecklistLayout.allID)
        let clean = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [layoutSample[0].rows[0]])])
        c.expectEqual(clean.selection(preferred: nil, overview: true), ChecklistLayout.overviewID)
        c.expectEqual(clean.selection(preferred: nil, overview: false), ChecklistLayout.allID, "Setup status opens on All when nothing needs you")
        c.expectEqual(clean.selection(preferred: ChecklistLayout.needsYouID, overview: false), ChecklistLayout.allID, "Needs you empties once everything is fixed")
        c.expectEqual(clean.selection(preferred: ChecklistLayout.overviewID, overview: false), ChecklistLayout.allID, "Setup status has no Overview")
        c.expectEqual(ChecklistLayout.make([]).selection(preferred: nil, overview: false), nil)
        c.expectEqual(ChecklistLayout.make([]).selection(preferred: ChecklistLayout.allID, overview: false), nil, "All with no groups shows nothing")
        c.expectEqual(ChecklistLayout.make([]).selection(preferred: nil, overview: true), ChecklistLayout.overviewID, "the summary keeps its Overview with no groups")
        c.expectEqual(ChecklistLayout.make([]).selection(preferred: ChecklistLayout.allID, overview: true), ChecklistLayout.overviewID)
    },
    Check("ChecklistLayout.filtered: a count's rows under their groups, in plan order, with no empty group") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: blocked)
        let ready = layout.filtered(.ready)
        c.expectEqual(ready.map(\.id), ["mac", "accounts"])
        c.expectEqual(ready.map(\.title), ["Your Mac", "Accounts"])
        c.expectEqual(ready.map { $0.rows.map(\.id) }, [["a"], ["d"]])
        let skipped = layout.filtered(.skipped)
        c.expectEqual(skipped.map(\.id), ["agents"])
        c.expectEqual(skipped.map { $0.rows.map(\.id) }, [["w"]])
        let notNeeded = layout.filtered(.notNeeded)
        c.expectEqual(notNeeded.map(\.id), ["mac"])
        c.expectEqual(notNeeded.map { $0.rows.map(\.id) }, [["c"]])
        let needsYou = layout.filtered(.needsYou)
        c.expectEqual(needsYou.map(\.title), ["Your Mac", "Accounts", "Agents and editors"])
        c.expectEqual(needsYou.map { $0.rows.map(\.id) }, [["b"], ["e"], ["style"]])
        c.expectEqual(ChecklistLayout.make([]).filtered(.ready), [])
    },
    Check("ChecklistLayout.filtered: a count's list holds as many rows as the count shows") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: blocked)
        for kind in [ChecklistLayout.SummaryKind.needsYou, .ready, .skipped, .notNeeded] {
            let shown = layout.summary.first { $0.kind == kind }.flatMap { Int($0.text.prefix { $0.isNumber }) }
            c.expectEqual(layout.filtered(kind).reduce(0) { $0 + $1.rows.count }, shown ?? 0, "\(kind)")
        }
    },
    Check("ChecklistLayout.filtered: an information row that is not ready is in no filter, and a skipped row only under skipped") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: blocked)
        for kind in [ChecklistLayout.SummaryKind.needsYou, .ready, .skipped, .notNeeded] {
            let ids = layout.filtered(kind).flatMap { $0.rows }.map(\.id)
            c.expect(!ids.contains("i"), "\(kind) lists i")
            c.expect(!ids.contains("m"), "\(kind) lists m")
            if kind != .skipped { c.expect(!ids.contains("w"), "\(kind) lists w") }
        }
    },
    Check("ChecklistLayout.activeFilter: a filter lasts while it has rows, and Needs you is never one") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: blocked)
        c.expectEqual(layout.activeFilter(.skipped), .skipped)
        c.expectEqual(layout.activeFilter(.ready), .ready)
        c.expectEqual(layout.activeFilter(.notNeeded), .notNeeded)
        c.expectEqual(layout.activeFilter(.needsYou), nil, "Needs you is a sidebar entry")
        c.expectEqual(layout.activeFilter(nil), nil)
        let clean = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .ready)])])
        c.expectEqual(clean.activeFilter(.skipped), nil)
        c.expectEqual(clean.activeFilter(.notNeeded), nil)
        c.expectEqual(clean.activeFilter(.ready), .ready)
    },
]
