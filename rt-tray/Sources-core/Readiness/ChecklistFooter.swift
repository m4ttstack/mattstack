import Foundation

/// The checklist's footer line. `canInstall` alone does not mean nothing is
/// owed: a finish-gated, unwaivable row can be unmet while Install is still
/// enabled, and the footer must say so rather than claim everything is ready.
public enum ChecklistFooter {
    public static func text(canInstall: Bool, requiredMissingCount: Int, owedBeforeFinish: [String]) -> String {
        if !canInstall { return requiredMissingCount == 1 ? "1 required item left." : "\(requiredMissingCount) required items left." }
        if owedBeforeFinish.isEmpty { return "Everything required is ready." }
        return "Ready to install. Still needed before you finish: \(owedBeforeFinish.joined(separator: ", "))."
    }

    /// What the footer says about the plan's freshness; nil before the first successful check.
    public static func refreshNote(isRefreshing: Bool, lastCheckedAt: Date?, now: Date) -> String? {
        if isRefreshing { return "Checking…" }
        guard let lastCheckedAt else { return nil }
        let minutes = Int(now.timeIntervalSince(lastCheckedAt)) / 60
        if minutes < 1 { return "Checked just now" }
        if minutes < 60 { return "Checked \(minutes) min ago" }
        return "Checked \(minutes / 60)h ago"
    }

    /// Titles of rows badged `.required` that are neither ready nor skipped, in plan order.
    public static func owedBeforeFinish(_ rows: [PlanRow]) -> [String] {
        rows.filter { $0.badge == .required && $0.status != .ready && $0.status != .skipped }.map(\.title)
    }
}
