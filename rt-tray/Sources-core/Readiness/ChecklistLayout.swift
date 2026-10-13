import Foundation

/// How the checklist lays a plan out: rows that need something lead at full
/// height, and everything already settled folds into its group.
public struct ChecklistLayout: Equatable, Sendable {
    public struct Attention: Equatable, Identifiable, Sendable {
        public let row: PlanRow
        public let groupTitle: String
        public var id: String { row.id }
    }

    public struct FoldedGroup: Equatable, Identifiable, Sendable {
        public let id: String
        public let title: String
        public let rows: [PlanRow]
        public let readyCount: Int
        public let totalCount: Int
        public let attentionCount: Int

        public var countText: String {
            readyCount == totalCount ? "\(readyCount) ready" : "\(readyCount) of \(totalCount) ready"
        }
    }

    public let attention: [Attention]
    public let groups: [FoldedGroup]
    public let readyCount: Int
    public let notNeededCount: Int

    /// A skipped row that still offers an action is something the user can
    /// do, so it stays at full height.
    public static func folds(_ row: PlanRow) -> Bool {
        row.status == .ready || (row.status == .skipped && row.action == nil)
    }

    public static func make(_ groups: [PlanGroup]) -> ChecklistLayout {
        var attention: [Attention] = []
        var folded: [FoldedGroup] = []
        for group in groups {
            let settled = group.rows.filter(folds)
            let needing = group.rows.filter { !folds($0) }
            attention += needing.map { Attention(row: $0, groupTitle: group.title) }
            guard !settled.isEmpty else { continue }
            folded.append(FoldedGroup(id: group.id, title: group.title, rows: settled,
                                      readyCount: settled.filter { $0.status == .ready }.count,
                                      totalCount: group.rows.count, attentionCount: needing.count))
        }
        let settledRows = folded.flatMap(\.rows)
        return ChecklistLayout(attention: attention, groups: folded,
                               readyCount: settledRows.filter { $0.status == .ready }.count,
                               notNeededCount: settledRows.filter { $0.status == .skipped }.count)
    }

    /// `status` picks the glyph the part is drawn with.
    public struct SummaryPart: Equatable, Sendable {
        public let status: RowStatus
        public let text: String
    }

    public var summary: [SummaryPart] {
        var parts: [SummaryPart] = []
        if !attention.isEmpty {
            parts.append(SummaryPart(status: .needsYou, text: attention.count == 1 ? "1 needs you" : "\(attention.count) need you"))
        }
        if readyCount > 0 { parts.append(SummaryPart(status: .ready, text: "\(readyCount) ready")) }
        if notNeededCount > 0 { parts.append(SummaryPart(status: .skipped, text: "\(notNeededCount) not needed here")) }
        return parts
    }
}
