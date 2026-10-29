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
]
