import Foundation
import MattstackCore

private func fdaRow(_ status: RowStatus) -> PlanRow {
    PlanRow(id: PermissionRowOverlay.fdaRow, kind: .permission, title: "Full Disk Access", why: "w", required: true, status: status,
            action: RowAction(type: .openSettings, label: "Open Full Disk Access Settings…", target: "fda"), recheck: .onActivate)
}

let fullDiskAccessPageChecks: [Check] = [
    Check("FullDiskAccessPage: no row yet reads off") { c in
        c.expectEqual(FullDiskAccessPage.state(row: nil, needsRelaunch: false), .off)
        c.expectEqual(FullDiskAccessPage.state(row: nil, needsRelaunch: true), .off, "a reopen means nothing before the check has run")
    },
    Check("FullDiskAccessPage: a denied row reads off") { c in
        c.expectEqual(FullDiskAccessPage.state(row: fdaRow(.needsYou), needsRelaunch: false), .off)
        c.expectEqual(FullDiskAccessPage.state(row: fdaRow(.checking), needsRelaunch: false), .off)
    },
    Check("FullDiskAccessPage: granted in this run reads needs a reopen") { c in
        c.expectEqual(FullDiskAccessPage.state(row: fdaRow(.ready), needsRelaunch: true), .needsReopen)
    },
    Check("FullDiskAccessPage: granted at launch reads on") { c in
        c.expectEqual(FullDiskAccessPage.state(row: fdaRow(.ready), needsRelaunch: false), .on)
    },
    Check("FullDiskAccessPage: no row while the plan loads reads checking, not off") { c in
        c.expectEqual(FullDiskAccessPage.display(row: nil, needsRelaunch: false, loadState: .loading), .checking)
    },
    Check("FullDiskAccessPage: no row after a failed load carries the failure") { c in
        c.expectEqual(FullDiskAccessPage.display(row: nil, needsRelaunch: false, loadState: .failed("rt exited 1")), .failed("rt exited 1"))
    },
    Check("FullDiskAccessPage: a present row reads its state whatever the load state") { c in
        c.expectEqual(FullDiskAccessPage.display(row: fdaRow(.needsYou), needsRelaunch: false, loadState: .loaded), .state(.off))
        c.expectEqual(FullDiskAccessPage.display(row: fdaRow(.ready), needsRelaunch: true, loadState: .failed("x")), .state(.needsReopen),
                      "a later refresh failing keeps the row it already has")
        c.expectEqual(FullDiskAccessPage.display(row: nil, needsRelaunch: false, loadState: .loaded), .state(.off))
    },
]
