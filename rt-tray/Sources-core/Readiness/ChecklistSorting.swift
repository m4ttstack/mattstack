import Foundation

public enum RowSection: Equatable, Sendable { case needsYou, canSkip, noAction }

public enum NeedBadge: String, Equatable, Sendable {
    case beforeFinish = "Before you finish"
}

/// Where a checklist row is drawn. Every unfinished step needs you, except
/// the ones rt lets you skip, which sit in their own card.
public enum ChecklistSorting {
    /// Mirrors `finalizePlan` in lib/setup/contract.ts: a finish-gated row is
    /// Finish's concern whatever its `required` reads.
    public static func blocksInstall(_ row: PlanRow) -> Bool {
        row.required && !row.finishGated && row.status != .ready
    }

    public static func section(for row: PlanRow, finishBlockedBy: Set<String>) -> RowSection {
        if row.information { return .noAction }
        let settled = row.status == .ready || row.status == .skipped
        // rt honors a waiver only on a row it lets you skip.
        let skipped = row.waived && row.waivable
        if row.finishGated && row.waivable && !skipped && !settled { return .canSkip }
        if blocksInstall(row) || finishBlockedBy.contains(row.id) { return .needsYou }
        if settled || skipped { return .noAction }
        return .needsYou
    }

    public static func badge(for row: PlanRow, finishBlockedBy: Set<String>) -> NeedBadge? {
        finishBlockedBy.contains(row.id) ? .beforeFinish : nil
    }
}
