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
    Check("ChecklistLayout: after Install a faulty row with no action is listed and counted as optional") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"], afterInstall: true)
        c.expectEqual(layout.sections[2].optional.map(\.id), ["f", "h"])
        c.expectEqual(layout.sections[2].noAction.map(\.id), [])
        c.expectEqual(layout.summary.map(\.text), ["2 need you", "2 ready", "3 optional", "1 not needed here"])
    },
    Check("ChecklistLayout.entries: Needs you leads when anything does, then Overview when asked, then the groups") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
        let wizard = layout.entries(overview: true, running: [], failed: [])
        c.expectEqual(wizard.map(\.id), [ChecklistLayout.needsYouID, ChecklistLayout.overviewID, "mac", "accounts", "agents"])
        c.expectEqual(wizard.map(\.title), ["Needs you", "Overview", "Your Mac", "Accounts", "Agents and editors"])
        c.expectEqual(wizard.map(\.count), [2, nil, 3, 2, 3])
        c.expectEqual(wizard.map(\.mark), [.needsYou, .overview, .needsYou, .settled, .needsYou])
        let status = layout.entries(overview: false, running: [], failed: [])
        c.expectEqual(status.map(\.id), [ChecklistLayout.needsYouID, "mac", "accounts", "agents"])
    },
    Check("ChecklistLayout.entries: an optional row never marks its group as needing you") { c in
        let layout = ChecklistLayout.make(layoutSample)
        c.expectEqual(layout.entries(overview: false, running: [], failed: []).first { $0.id == "accounts" }?.mark, .settled)
    },
    Check("ChecklistLayout.entries: a failed row outranks a running one, which outranks needing you") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
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
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
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
    },
    Check("ChecklistLayout.filtered: a count's rows under their groups, in plan order, with no empty group") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
        let ready = layout.filtered(.ready)
        c.expectEqual(ready.map(\.id), ["mac", "accounts"])
        c.expectEqual(ready.map(\.title), ["Your Mac", "Accounts"])
        c.expectEqual(ready.map { $0.rows.map(\.id) }, [["a"], ["d"]])
        let optional = layout.filtered(.optional)
        c.expectEqual(optional.map(\.id), ["accounts", "agents"])
        c.expectEqual(optional.map { $0.rows.map(\.id) }, [["e"], ["h"]])
        let notNeeded = layout.filtered(.notNeeded)
        c.expectEqual(notNeeded.map(\.id), ["mac"])
        c.expectEqual(notNeeded.map { $0.rows.map(\.id) }, [["c"]])
        let needsYou = layout.filtered(.needsYou)
        c.expectEqual(needsYou.map(\.title), ["Your Mac", "Agents and editors"])
        c.expectEqual(needsYou.map { $0.rows.map(\.id) }, [["b"], ["style"]])
        let after = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"], afterInstall: true)
        c.expectEqual(after.filtered(.optional).map { $0.rows.map(\.id) }, [["e"], ["f", "h"]])
        c.expectEqual(ChecklistLayout.make([]).filtered(.ready), [])
    },
    Check("ChecklistLayout.filtered: a count's list holds as many rows as the count shows") { c in
        for afterInstall in [false, true] {
            let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"], afterInstall: afterInstall)
            for kind in [ChecklistLayout.SummaryKind.needsYou, .ready, .optional, .notNeeded] {
                let shown = layout.summary.first { $0.kind == kind }.flatMap { Int($0.text.prefix { $0.isNumber }) }
                c.expectEqual(layout.filtered(kind).reduce(0) { $0 + $1.rows.count }, shown ?? 0, "\(kind), afterInstall \(afterInstall)")
            }
        }
    },
    Check("ChecklistLayout.filtered: a row Install will set is in no filter") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
        c.expectEqual(layout.sections[2].noAction.map(\.id), ["f"])
        for kind in [ChecklistLayout.SummaryKind.needsYou, .ready, .optional, .notNeeded] {
            c.expect(!layout.filtered(kind).flatMap { $0.rows }.contains { $0.id == "f" }, "\(kind) lists f")
        }
    },
    Check("ChecklistLayout.activeFilter: a filter lasts while it has rows, and Needs you is never one") { c in
        let layout = ChecklistLayout.make(layoutSample, finishBlockedBy: ["style"])
        c.expectEqual(layout.activeFilter(.optional), .optional)
        c.expectEqual(layout.activeFilter(.ready), .ready)
        c.expectEqual(layout.activeFilter(.notNeeded), .notNeeded)
        c.expectEqual(layout.activeFilter(.needsYou), nil, "Needs you is a sidebar entry")
        c.expectEqual(layout.activeFilter(nil), nil)
        let clean = ChecklistLayout.make([PlanGroup(id: "x", title: "X", rows: [row("a", .ready)])])
        c.expectEqual(clean.activeFilter(.optional), nil)
        c.expectEqual(clean.activeFilter(.notNeeded), nil)
        c.expectEqual(clean.activeFilter(.ready), .ready)
    },
]
