import Foundation
import MattstackCore

private func row(_ id: String, _ status: RowStatus, required: Bool = false) -> PlanRow {
    PlanRow(id: id, kind: .tool, title: id, why: "w", required: required, status: status, recheck: .manual)
}
private func group(_ id: String, _ rows: [PlanRow]) -> PlanGroup { PlanGroup(id: id, title: id.uppercased(), rows: rows) }

private let three = [group("mac", [row("a", .ready)]), group("accounts", [row("b", .missing, required: true)]),
                     group("empty", []), group("rt", [row("c", .ready)])]

let wizardPagesChecks: [Check] = [
    Check("WizardPages: one page per non-empty group, in plan order") { c in
        let p = WizardPages(groups: three)
        c.expectEqual(p.ids, ["mac", "accounts", "rt"])
        c.expectEqual(p.titles["accounts"], "ACCOUNTS")
        c.expectEqual(p.next(after: "mac"), "accounts")
        c.expectEqual(p.next(after: "rt"), nil)
        c.expectEqual(p.previous(before: "mac"), nil)
        c.expectEqual(p.previous(before: "rt"), "accounts")
        c.expect(p.isLast("rt")); c.expect(!p.isLast("mac"))
        c.expectEqual(p.index(of: "accounts"), 1)
    },
    Check("WizardPages.current: keeps the page by id, else the page now at its old position, else the first") { c in
        let p = WizardPages(groups: three)
        c.expectEqual(p.current(preferred: nil, lastIndex: nil), "mac")
        c.expectEqual(p.current(preferred: "accounts", lastIndex: 1), "accounts")
        c.expectEqual(p.current(preferred: "gone", lastIndex: 1), "accounts", "a page that left the plan hands over to its position")
        c.expectEqual(p.current(preferred: "gone", lastIndex: 9), "rt", "past the end clamps to the last page")
        c.expectEqual(WizardPages(groups: []).current(preferred: "mac", lastIndex: 0), nil)
    },
    Check("WizardPages.landing: the first page still holding an Install blocker, else the last page") { c in
        c.expectEqual(WizardPages.landing(groups: three), "accounts")
        c.expectEqual(WizardPages.landing(groups: [group("mac", [row("a", .ready)]), group("rt", [row("c", .ready)])]), "rt")
        c.expectEqual(WizardPages.landing(groups: []), nil)
    },
    Check("PageGate: a page holds Continue only for rows that block Install") { c in
        let g = group("x", [row("a", .missing, required: true), row("b", .missing), row("c", .ready, required: true)])
        c.expectEqual(PageGate.blockers(in: g).map(\.id), ["a"])
        c.expect(!PageGate.continueEnabled(blockers: 1, isLast: false, canInstall: false))
        c.expect(PageGate.continueEnabled(blockers: 0, isLast: false, canInstall: false), "a middle page never waits on other pages")
    },
    Check("PageGate: the last page's Install also waits on rt's own canInstall") { c in
        c.expect(PageGate.continueEnabled(blockers: 0, isLast: true, canInstall: true))
        c.expect(!PageGate.continueEnabled(blockers: 0, isLast: true, canInstall: false))
    },
    Check("PageGate.footer: counts this page's required rows, and names a veto that no row explains") { c in
        c.expectEqual(PageGate.footer(blockers: 2, isLast: false, canInstall: false), "2 required items left on this page.")
        c.expectEqual(PageGate.footer(blockers: 1, isLast: true, canInstall: false), "1 required item left on this page.")
        c.expectEqual(PageGate.footer(blockers: 0, isLast: false, canInstall: false), "Nothing required on this page.")
        c.expectEqual(PageGate.footer(blockers: 0, isLast: true, canInstall: true), "Nothing required on this page.")
        c.expectEqual(PageGate.footer(blockers: 0, isLast: true, canInstall: false),
                      "Install is not ready yet. Go back to finish the required items, or Re-check.")
    },
]
