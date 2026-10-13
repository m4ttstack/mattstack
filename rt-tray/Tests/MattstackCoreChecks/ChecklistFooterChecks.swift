import Foundation
import MattstackCore

private func row(id: String, title: String, finishGated: Bool, waivable: Bool, status: RowStatus) -> PlanRow {
    PlanRow(id: id, kind: .tool, title: title, why: "w", required: false, status: status, recheck: .onChange,
            finishGated: finishGated, waivable: waivable)
}

let checklistFooterChecks: [Check] = [
    Check("ChecklistFooter.text: not installable counts the required items left, singular for one") { c in
        c.expectEqual(ChecklistFooter.text(canInstall: false, requiredMissingCount: 2, owedBeforeFinish: []),
                      "2 required items left.")
        c.expectEqual(ChecklistFooter.text(canInstall: false, requiredMissingCount: 1, owedBeforeFinish: []),
                      "1 required item left.")
        c.expectEqual(ChecklistFooter.text(canInstall: false, requiredMissingCount: 2, owedBeforeFinish: ["Writing style"]),
                      "2 required items left.", "requiredMissingCount alone drives this branch")
    },
    Check("ChecklistFooter.text: installable with nothing owed reads ready") { c in
        c.expectEqual(ChecklistFooter.text(canInstall: true, requiredMissingCount: 0, owedBeforeFinish: []),
                      "Everything required is ready.")
    },
    Check("ChecklistFooter.text: installable with something owed names it") { c in
        c.expectEqual(ChecklistFooter.text(canInstall: true, requiredMissingCount: 0, owedBeforeFinish: ["Writing style"]),
                      "Ready to install. Still needed before you finish: Writing style.")
        c.expectEqual(ChecklistFooter.text(canInstall: true, requiredMissingCount: 0, owedBeforeFinish: ["Writing style", "Fast Browser extension"]),
                      "Ready to install. Still needed before you finish: Writing style, Fast Browser extension.")
    },
    Check("ChecklistFooter.refreshNote: a refresh in flight reads as checking, whatever was checked before") { c in
        let now = Date(timeIntervalSince1970: 10_000)
        c.expectEqual(ChecklistFooter.refreshNote(isRefreshing: true, lastCheckedAt: nil, now: now), "Checking…")
        c.expectEqual(ChecklistFooter.refreshNote(isRefreshing: true, lastCheckedAt: now.addingTimeInterval(-300), now: now), "Checking…")
    },
    Check("ChecklistFooter.refreshNote: idle says how long ago the last successful check landed") { c in
        let now = Date(timeIntervalSince1970: 100_000)
        c.expectEqual(ChecklistFooter.refreshNote(isRefreshing: false, lastCheckedAt: nil, now: now), nil,
                      "nothing has been checked yet, so there is nothing to say")
        c.expectEqual(ChecklistFooter.refreshNote(isRefreshing: false, lastCheckedAt: now, now: now), "Checked just now")
        c.expectEqual(ChecklistFooter.refreshNote(isRefreshing: false, lastCheckedAt: now.addingTimeInterval(-59), now: now), "Checked just now")
        c.expectEqual(ChecklistFooter.refreshNote(isRefreshing: false, lastCheckedAt: now.addingTimeInterval(-60), now: now), "Checked 1 min ago")
        c.expectEqual(ChecklistFooter.refreshNote(isRefreshing: false, lastCheckedAt: now.addingTimeInterval(-59 * 60), now: now), "Checked 59 min ago")
        c.expectEqual(ChecklistFooter.refreshNote(isRefreshing: false, lastCheckedAt: now.addingTimeInterval(-3 * 3600), now: now), "Checked 3h ago")
    },
    Check("ChecklistFooter.owedBeforeFinish: only badge==.required rows not ready or skipped, in plan order") { c in
        let rows = [
            row(id: "a", title: "A", finishGated: true, waivable: false, status: .needsYou),
            row(id: "b", title: "B", finishGated: true, waivable: true, status: .needsYou),
            row(id: "c", title: "C", finishGated: false, waivable: false, status: .needsYou),
            row(id: "d", title: "D", finishGated: true, waivable: false, status: .ready),
            row(id: "e", title: "E", finishGated: true, waivable: false, status: .skipped),
        ]
        c.expectEqual(ChecklistFooter.owedBeforeFinish(rows), ["A"])
    },
]
