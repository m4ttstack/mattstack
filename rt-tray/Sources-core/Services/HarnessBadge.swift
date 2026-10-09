import Foundation

/// The agent app a process row belongs to, as the daemon tags it from the
/// integration registry. Absent when integrations are off or the daemon
/// predates the tag.
public struct ProcessHarness: Codable, Equatable, Sendable {
    public let id: String
    public let label: String
    public init(id: String, label: String) { self.id = id; self.label = label }
}

public struct HarnessBadge: Equatable, Sendable {
    public enum Tint: Equatable, Sendable { case claude, harness }
    public let text: String
    public let tooltip: String
    public let tint: Tint
    public init(text: String, tooltip: String, tint: Tint) { self.text = text; self.tooltip = tooltip; self.tint = tint }

    private static let claude = HarnessBadge(text: "\u{273B} claude", tooltip: "Claude Code session", tint: .claude)

    /// Without a tag the row keeps the pre-integration rule: an exact
    /// "claude" segment anywhere in the breadcrumb chain, so a collapsed
    /// "claude › node" row counts but "claude-ish" wrappers don't.
    public static func forProcess(harness: ProcessHarness?, command: String) -> HarnessBadge? {
        guard let harness else {
            return command.components(separatedBy: " › ").contains("claude") ? claude : nil
        }
        if harness.id == "claude" { return claude }
        return HarnessBadge(text: harness.id, tooltip: "\(harness.label) session", tint: .harness)
    }
}
