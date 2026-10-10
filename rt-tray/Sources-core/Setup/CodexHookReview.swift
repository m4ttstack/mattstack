import Foundation

/// What `rt setup codex-policy` shows at a terminal before its approval;
/// the sheet shows these values and nothing it works out itself.
public struct CodexHookReview: Codable, Equatable, Sendable {
    public struct Hook: Codable, Equatable, Sendable {
        public var event: String
        public var key: String
        public var hash: String
        public var command: String
        public init(event: String, key: String, hash: String, command: String) {
            self.event = event; self.key = key; self.hash = hash; self.command = command
        }
    }
    public var id: String
    public var codexHome: String
    public var hooksPath: String
    public var configPath: String
    public var executable: String
    public var digest: String
    public var hooks: [Hook]
    public init(id: String, codexHome: String, hooksPath: String, configPath: String, executable: String, digest: String, hooks: [Hook]) {
        self.id = id; self.codexHome = codexHome; self.hooksPath = hooksPath; self.configPath = configPath
        self.executable = executable; self.digest = digest; self.hooks = hooks
    }
}

/// Approve sends rt the review's id and nothing else. rt re-plans, refuses an
/// id that is no longer current, and asks macOS to confirm the owner before
/// it writes, so nothing here decides or proves anything.
public struct CodexHookApproval: Equatable, Sendable {
    public let review: CodexHookReview
    public let args: [String]

    public init?(action: RowAction) {
        guard action.type == .reviewCodexHooks, let verb = action.verb, !verb.isEmpty,
              let review = action.review, !review.id.isEmpty else { return nil }
        self.review = review
        self.args = verb + ["--approve", review.id, "--json"]
    }
}
