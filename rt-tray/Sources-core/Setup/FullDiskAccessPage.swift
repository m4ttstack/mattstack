import Foundation

public enum FDAPageState: Equatable, Sendable { case off, needsReopen, on }

/// Setup's first page reads the same `perm.fda` row the Your Mac page does.
public enum FullDiskAccessPage {
    public static func state(row: PlanRow?, needsRelaunch: Bool) -> FDAPageState {
        guard let row, row.status == .ready else { return .off }
        return needsRelaunch ? .needsReopen : .on
    }
}

@MainActor
extension ReadinessModel {
    public var fullDiskAccessState: FDAPageState {
        FullDiskAccessPage.state(row: row(PermissionRowOverlay.fdaRow), needsRelaunch: fdaNeedsRelaunch)
    }
}
