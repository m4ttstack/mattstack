import Foundation

public enum RowSection: Equatable, Sendable { case needsYou, optional, noAction }

public enum NeedBadge: String, Equatable, Sendable {
    case required = "Required"
    case beforeFinish = "Before you finish"
}

/// Where a checklist row is drawn. A warning heading sits over `needsYou`
/// only, so nothing optional may land there.
public enum ChecklistSorting {
    /// Mirrors `finalizePlan` in lib/setup/contract.ts: a finish-gated row is
    /// Finish's concern whatever its `required` reads.
    public static func blocksInstall(_ row: PlanRow) -> Bool {
        row.required && !row.finishGated && row.status != .ready
    }

    public static func section(for row: PlanRow, finishBlockedBy: Set<String>, afterInstall: Bool = false) -> RowSection {
        if blocksInstall(row) || finishBlockedBy.contains(row.id) { return .needsYou }
        if row.status == .ready { return .noAction }
        if hasUsableAction(row) || row.status == .error || row.status == .invalid { return .optional }
        if afterInstall && row.status != .skipped { return .optional }
        return .noAction
    }

    public static func badge(for row: PlanRow, finishBlockedBy: Set<String>) -> NeedBadge? {
        if blocksInstall(row) { return .required }
        return finishBlockedBy.contains(row.id) ? .beforeFinish : nil
    }

    private static func hasUsableAction(_ row: PlanRow) -> Bool {
        guard let action = row.action else { return false }
        return action.type != .unknown
    }
}
