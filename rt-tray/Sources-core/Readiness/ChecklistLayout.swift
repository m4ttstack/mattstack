import Foundation

/// How the checklist lays a plan out: a sidebar entry per group, led by
/// everything that needs the user, and each group's rows split into the ones
/// drawn at full height and the ones already settled.
public struct ChecklistLayout: Equatable, Sendable {
    public struct Attention: Equatable, Identifiable, Sendable {
        public let row: PlanRow
        public let groupTitle: String
        public var id: String { row.id }
    }

    public struct Section: Equatable, Identifiable, Sendable {
        public let id: String
        public let title: String
        public let needing: [PlanRow]
        public let settled: [PlanRow]
    }

    /// `status` picks the glyph the entry is drawn with.
    public struct Entry: Equatable, Identifiable, Sendable {
        public let id: String
        public let title: String
        public let count: Int
        public let status: RowStatus
    }

    /// `status` picks the glyph the part is drawn with.
    public struct SummaryPart: Equatable, Sendable {
        public let status: RowStatus
        public let text: String
    }

    /// No plan group can take this id: rt's group ids never carry a hyphen.
    public static let needsYouID = "needs-you"

    public let attention: [Attention]
    public let sections: [Section]

    /// A skipped row that still offers an action is something the user can
    /// do, so it stays at full height.
    public static func folds(_ row: PlanRow) -> Bool {
        row.status == .ready || (row.status == .skipped && row.action == nil)
    }

    public static func make(_ groups: [PlanGroup]) -> ChecklistLayout {
        var attention: [Attention] = []
        var sections: [Section] = []
        for group in groups where !group.rows.isEmpty {
            let needing = group.rows.filter { !folds($0) }
            attention += needing.map { Attention(row: $0, groupTitle: group.title) }
            sections.append(Section(id: group.id, title: group.title, needing: needing, settled: group.rows.filter(folds)))
        }
        return ChecklistLayout(attention: attention, sections: sections)
    }

    public var entries: [Entry] {
        var out: [Entry] = []
        if !attention.isEmpty {
            out.append(Entry(id: Self.needsYouID, title: "Needs you", count: attention.count, status: .needsYou))
        }
        out += sections.map {
            Entry(id: $0.id, title: $0.title, count: $0.needing.count + $0.settled.count,
                  status: $0.needing.isEmpty ? .ready : .needsYou)
        }
        return out
    }

    /// The entry to show: the user's pick while it still exists, else the first.
    public func selection(preferred: String?) -> String? {
        let ids = entries.map(\.id)
        if let preferred, ids.contains(preferred) { return preferred }
        return ids.first
    }

    public var summary: [SummaryPart] {
        let settled = sections.flatMap(\.settled)
        let ready = settled.filter { $0.status == .ready }.count
        let notNeeded = settled.filter { $0.status == .skipped }.count
        var parts: [SummaryPart] = []
        if !attention.isEmpty {
            parts.append(SummaryPart(status: .needsYou, text: attention.count == 1 ? "1 needs you" : "\(attention.count) need you"))
        }
        if ready > 0 { parts.append(SummaryPart(status: .ready, text: "\(ready) ready")) }
        if notNeeded > 0 { parts.append(SummaryPart(status: .skipped, text: "\(notNeeded) not needed here")) }
        return parts
    }
}
