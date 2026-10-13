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

    public struct FilterGroup: Equatable, Identifiable, Sendable {
        public let id: String
        public let title: String
        public let rows: [PlanRow]
    }

    public let attention: [Attention]
    public let sections: [Section]
    public let finishBlockedBy: Set<String>

    public enum EntryMark: Equatable, Sendable { case overview, failed, running, needsYou, settled }

    public struct Entry: Equatable, Identifiable, Sendable {
        public let id: String
        public let title: String
        /// nil for an entry that is not a list of rows.
        public let count: Int?
        public let mark: EntryMark
    }

    /// No plan group can take these ids: rt's group ids never carry a hyphen,
    /// and no group is named "overview".
    public static let needsYouID = "needs-you"
    public static let overviewID = "overview"

    public func entries(overview: Bool, running: Set<String>, failed: Set<String>) -> [Entry] {
        var out: [Entry] = []
        if !attention.isEmpty {
            out.append(Entry(id: Self.needsYouID, title: "Needs you", count: attention.count, mark: .needsYou))
        }
        if overview { out.append(Entry(id: Self.overviewID, title: "Overview", count: nil, mark: .overview)) }
        out += sections.map { section in
            let ids = Set((section.needsYou + section.optional + section.noAction).map(\.id))
            let mark: EntryMark = !ids.isDisjoint(with: failed) ? .failed
                : !ids.isDisjoint(with: running) ? .running
                : section.needsYou.isEmpty ? .settled : .needsYou
            return Entry(id: section.id, title: section.title, count: section.count, mark: mark)
        }
        return out
    }

    /// The entry to show: the user's pick while it still exists, else the first.
    public func selection(preferred: String?, overview: Bool) -> String? {
        let ids = entries(overview: overview, running: [], failed: []).map(\.id)
        if let preferred, ids.contains(preferred) { return preferred }
        return ids.first
    }

    public static func make(_ groups: [PlanGroup], finishBlockedBy: [String] = [], afterInstall: Bool = false) -> ChecklistLayout {
        let blocked = Set(finishBlockedBy)
        var attention: [Attention] = []
        var sections: [Section] = []
        for group in groups where !group.rows.isEmpty {
            var buckets: [RowSection: [PlanRow]] = [:]
            for row in group.rows {
                buckets[ChecklistSorting.section(for: row, finishBlockedBy: blocked, afterInstall: afterInstall), default: []].append(row)
            }
            let needing = buckets[.needsYou] ?? []
            attention += needing.map { Attention(row: $0, groupTitle: group.title) }
            sections.append(Section(id: group.id, title: group.title, needsYou: needing,
                                    optional: buckets[.optional] ?? [], noAction: buckets[.noAction] ?? []))
        }
        return ChecklistLayout(attention: attention, sections: sections, finishBlockedBy: blocked)
    }

    /// A row Install will set (not ready, nothing to press) is in no count:
    /// it is neither ready nor anything the user owes.
    private func rows(_ kind: SummaryKind, in section: Section) -> [PlanRow] {
        switch kind {
        case .needsYou: return section.needsYou
        case .ready: return section.noAction.filter { $0.status == .ready }
        case .optional: return section.optional
        case .notNeeded: return section.noAction.filter { $0.status == .skipped }
        }
    }

    /// The rows a count stands for, under the group each came from.
    public func filtered(_ kind: SummaryKind) -> [FilterGroup] {
        sections.compactMap { section in
            let matching = rows(kind, in: section)
            return matching.isEmpty ? nil : FilterGroup(id: section.id, title: section.title, rows: matching)
        }
    }

    /// The filter to show: the user's pick while it still has rows. Needs you is a sidebar entry, never a filter.
    public func activeFilter(_ preferred: SummaryKind?) -> SummaryKind? {
        guard let preferred, preferred != .needsYou, !filtered(preferred).isEmpty else { return nil }
        return preferred
    }

    public var summary: [SummaryPart] {
        let count = { (kind: SummaryKind) in filtered(kind).reduce(0) { $0 + $1.rows.count } }
        let ready = count(.ready), optional = count(.optional), notNeeded = count(.notNeeded)
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
