import Foundation

public struct WizardPages: Equatable, Sendable {
    public let ids: [String]
    public let titles: [String: String]

    public init(groups: [PlanGroup] = []) {
        let shown = Self.shown(groups)
        ids = shown.map(\.id)
        titles = Dictionary(shown.map { ($0.id, $0.title) }, uniquingKeysWith: { first, _ in first })
    }

    /// rt's plan is not trusted to keep group ids unique: a repeated id would
    /// be a page Continue returns to and never leaves.
    private static func shown(_ groups: [PlanGroup]) -> [PlanGroup] {
        var seen = Set<String>()
        return groups.filter { !$0.rows.isEmpty && seen.insert($0.id).inserted }
    }

    public func index(of id: String) -> Int? { ids.firstIndex(of: id) }
    public func isLast(_ id: String) -> Bool { ids.last == id }
    public func next(after id: String) -> String? {
        guard let i = index(of: id), i + 1 < ids.count else { return nil }
        return ids[i + 1]
    }
    public func previous(before id: String) -> String? {
        guard let i = index(of: id), i > 0 else { return nil }
        return ids[i - 1]
    }

    /// A plan re-read can drop the page the user is on (a group empties);
    /// the page now at that position takes over.
    public func current(preferred: String?, lastIndex: Int?) -> String? {
        if let preferred, ids.contains(preferred) { return preferred }
        guard !ids.isEmpty else { return nil }
        guard let lastIndex else { return ids[0] }
        return ids[min(max(lastIndex, 0), ids.count - 1)]
    }

    /// Where a relaunched setup reopens.
    public static func landing(groups: [PlanGroup]) -> String? {
        let shown = shown(groups)
        return shown.first { !PageGate.blockers(in: $0).isEmpty }?.id ?? shown.last?.id
    }
}

public enum PageGate {
    public static func blockers(in group: PlanGroup) -> [PlanRow] {
        group.rows.filter(ChecklistSorting.blocksInstall)
    }

    public static func continueEnabled(blockers: Int, isLast: Bool, canInstall: Bool) -> Bool {
        blockers == 0 && (!isLast || canInstall)
    }

    public static func footer(blockers: Int, isLast: Bool, canInstall: Bool) -> String {
        if blockers == 1 { return "1 required item left on this page." }
        if blockers > 1 { return "\(blockers) required items left on this page." }
        if isLast && !canInstall { return "Install is not ready yet. Go back to finish the required items, or Re-check." }
        return "Nothing required on this page."
    }
}
