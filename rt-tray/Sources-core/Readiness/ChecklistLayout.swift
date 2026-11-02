import Foundation

/// The line above a wizard page's cards.
public enum PageLead {
    public static func text(for section: ChecklistLayout.Section) -> String {
        let required = section.needsYou.filter(ChecklistSorting.blocksInstall).count
        if required == 1 { return "One thing here needs you before Install can run." }
        if required > 1 { return "\(required) things here need you before Install can run." }
        let beforeFinish = section.needsYou.filter(\.finishGated).count
        if beforeFinish == 1 { return "Nothing here blocks Install. One thing is needed before you finish." }
        if beforeFinish > 1 { return "Nothing here blocks Install. \(beforeFinish) things are needed before you finish." }
        return section.needsYou.isEmpty && section.canSkip.isEmpty ? "Nothing here needs you." : "Nothing here blocks Install."
    }
}

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
        public let canSkip: [PlanRow]
        public let noAction: [PlanRow]
        public var count: Int { needsYou.count + canSkip.count + noAction.count }
    }

    public enum SummaryKind: Equatable, Sendable { case needsYou, ready, skipped, notNeeded }

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
    /// Every group at once. It is not a sidebar entry: it is what shows while none is selected.
    public static let allID = "all-groups"

    public func entries(overview: Bool, running: Set<String>, failed: Set<String>) -> [Entry] {
        var out: [Entry] = []
        if !attention.isEmpty {
            out.append(Entry(id: Self.needsYouID, title: "Needs you", count: attention.count, mark: .needsYou))
        }
        if overview { out.append(Entry(id: Self.overviewID, title: "Overview", count: nil, mark: .overview)) }
        out += sections.map { section in
            let ids = Set((section.needsYou + section.canSkip + section.noAction).map(\.id))
            // A row you can skip is no attention row, but Finish waits on it until it is skipped.
            let mark: EntryMark = !ids.isDisjoint(with: failed) ? .failed
                : !ids.isDisjoint(with: running) ? .running
                : section.needsYou.isEmpty && section.canSkip.isEmpty ? .settled : .needsYou
            return Entry(id: section.id, title: section.title, count: section.count, mark: mark)
        }
        return out
    }

    /// The user's pick while it still exists, else Needs you, else Overview, else All.
    public func selection(preferred: String?, overview: Bool) -> String? {
        let ids = entries(overview: overview, running: [], failed: []).map(\.id)
        if let preferred, ids.contains(preferred) || (preferred == Self.allID && !sections.isEmpty) { return preferred }
        if !attention.isEmpty { return Self.needsYouID }
        if overview { return Self.overviewID }
        return sections.isEmpty ? nil : Self.allID
    }

    public static func make(_ groups: [PlanGroup], finishBlockedBy: [String] = []) -> ChecklistLayout {
        let blocked = Set(finishBlockedBy)
        var attention: [Attention] = []
        var sections: [Section] = []
        for group in groups where !group.rows.isEmpty {
            var buckets: [RowSection: [PlanRow]] = [:]
            for row in group.rows {
                buckets[ChecklistSorting.section(for: row, finishBlockedBy: blocked), default: []].append(row)
            }
            let needing = buckets[.needsYou] ?? []
            attention += needing.map { Attention(row: $0, groupTitle: group.title) }
            sections.append(Section(id: group.id, title: group.title, needsYou: needing,
                                    canSkip: buckets[.canSkip] ?? [], noAction: buckets[.noAction] ?? []))
        }
        return ChecklistLayout(attention: attention, sections: sections, finishBlockedBy: blocked)
    }

    /// An information row that is not ready is in no count: it is neither
    /// ready nor anything the user owes. A skipped row counts as skipped only.
    private func rows(_ kind: SummaryKind, in section: Section) -> [PlanRow] {
        switch kind {
        case .needsYou: return section.needsYou
        case .ready: return section.noAction.filter { $0.status == .ready && !$0.isWaived }
        case .skipped: return section.noAction.filter(\.isWaived)
        case .notNeeded: return section.noAction.filter { $0.status == .skipped && !$0.isWaived }
        }
    }

    public func filtered(_ kind: SummaryKind) -> [FilterGroup] {
        sections.compactMap { section in
            let matching = rows(kind, in: section)
            return matching.isEmpty ? nil : FilterGroup(id: section.id, title: section.title, rows: matching)
        }
    }

    /// Needs you is a sidebar entry, never a filter.
    public func activeFilter(_ preferred: SummaryKind?) -> SummaryKind? {
        guard let preferred, preferred != .needsYou, !filtered(preferred).isEmpty else { return nil }
        return preferred
    }

    public var summary: [SummaryPart] {
        let count = { (kind: SummaryKind) in filtered(kind).reduce(0) { $0 + $1.rows.count } }
        let ready = count(.ready), skipped = count(.skipped), notNeeded = count(.notNeeded)
        var parts: [SummaryPart] = []
        if !attention.isEmpty {
            parts.append(SummaryPart(kind: .needsYou, text: attention.count == 1 ? "1 needs you" : "\(attention.count) need you"))
        }
        if ready > 0 { parts.append(SummaryPart(kind: .ready, text: "\(ready) ready")) }
        if skipped > 0 { parts.append(SummaryPart(kind: .skipped, text: "\(skipped) skipped")) }
        if notNeeded > 0 { parts.append(SummaryPart(kind: .notNeeded, text: "\(notNeeded) not needed here")) }
        return parts
    }
}
