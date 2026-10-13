import Foundation

/// How the checklist lays a plan out: each group's rows split into the ones
/// that need the user, the optional ones, and the rest.
public struct ChecklistLayout: Equatable, Sendable {
    public struct Attention: Equatable, Identifiable, Sendable {
        public let row: PlanRow
        public let groupTitle: String
        public var id: String { row.id }
    }

    public struct Section: Equatable, Identifiable, Sendable {
        public let id: String
        public let title: String
        public let needsYou: [PlanRow]
        public let optional: [PlanRow]
        public let noAction: [PlanRow]
        public var count: Int { needsYou.count + optional.count + noAction.count }
    }

    public enum SummaryKind: Equatable, Sendable { case needsYou, ready, optional, notNeeded }

    public struct SummaryPart: Equatable, Sendable {
        public let kind: SummaryKind
        public let text: String
    }

    public let attention: [Attention]
    public let sections: [Section]
    public let finishBlockedBy: Set<String>

    public static func make(_ groups: [PlanGroup], finishBlockedBy: [String] = []) -> ChecklistLayout {
        let blocked = Set(finishBlockedBy)
        var attention: [Attention] = []
        var sections: [Section] = []
        for group in groups where !group.rows.isEmpty {
            var buckets: [RowSection: [PlanRow]] = [:]
            for row in group.rows { buckets[ChecklistSorting.section(for: row, finishBlockedBy: blocked), default: []].append(row) }
            let needing = buckets[.needsYou] ?? []
            attention += needing.map { Attention(row: $0, groupTitle: group.title) }
            sections.append(Section(id: group.id, title: group.title, needsYou: needing,
                                    optional: buckets[.optional] ?? [], noAction: buckets[.noAction] ?? []))
        }
        return ChecklistLayout(attention: attention, sections: sections, finishBlockedBy: blocked)
    }

    /// A row Install will set (not ready, nothing to press) is in no count:
    /// it is neither ready nor anything the user owes.
    public var summary: [SummaryPart] {
        let settled = sections.flatMap(\.noAction)
        let ready = settled.filter { $0.status == .ready }.count
        let notNeeded = settled.filter { $0.status == .skipped }.count
        let optional = sections.reduce(0) { $0 + $1.optional.count }
        var parts: [SummaryPart] = []
        if !attention.isEmpty {
            parts.append(SummaryPart(kind: .needsYou, text: attention.count == 1 ? "1 needs you" : "\(attention.count) need you"))
        }
        if ready > 0 { parts.append(SummaryPart(kind: .ready, text: "\(ready) ready")) }
        if optional > 0 { parts.append(SummaryPart(kind: .optional, text: "\(optional) optional")) }
        if notNeeded > 0 { parts.append(SummaryPart(kind: .notNeeded, text: "\(notNeeded) not needed here")) }
        return parts
    }
}
