import Foundation

public enum FDAPageState: Equatable, Sendable { case off, needsReopen, on }

/// What the page draws: the `perm.fda` row exists only once a plan has
/// landed, so before that the plan's own load state speaks for it.
public enum FDAPageDisplay: Equatable, Sendable {
    case checking
    case failed(String)
    case state(FDAPageState)
}

/// Setup's first page reads the same `perm.fda` row the Your Mac page does.
public enum FullDiskAccessPage {
    public static func state(row: PlanRow?, needsRelaunch: Bool) -> FDAPageState {
        guard let row, row.status == .ready else { return .off }
        return needsRelaunch ? .needsReopen : .on
    }

    public static func display(row: PlanRow?, needsRelaunch: Bool, loadState: ChecklistLoadState) -> FDAPageDisplay {
        if row == nil {
            switch loadState {
            case .loading: return .checking
            case .failed(let message): return .failed(message)
            case .loaded: break
            }
        }
        return .state(state(row: row, needsRelaunch: needsRelaunch))
    }
}

@MainActor
extension ReadinessModel {
    public var fullDiskAccessState: FDAPageState {
        FullDiskAccessPage.state(row: row(PermissionRowOverlay.fdaRow), needsRelaunch: fdaNeedsRelaunch)
    }

    public var fullDiskAccessDisplay: FDAPageDisplay {
        FullDiskAccessPage.display(row: row(PermissionRowOverlay.fdaRow), needsRelaunch: fdaNeedsRelaunch, loadState: loadState)
    }
}
