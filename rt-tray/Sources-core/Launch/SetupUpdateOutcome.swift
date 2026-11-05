import Foundation

/// The `done` line of `rt setup update --json`. rt owns every decision and
/// posts the notification itself; the tray logs the line and opens Setup
/// status when it carries `needsYou`, so a member with notifications off
/// still sees what the update needs.
public struct SetupUpdateOutcome: Equatable, Sendable {
    public let ok: Bool
    public let skipped: String?
    public let failedSteps: [String]
    public let needsYou: Bool

    public init(ok: Bool, skipped: String?, failedSteps: [String], needsYou: Bool = false) {
        self.ok = ok
        self.skipped = skipped
        self.failedSteps = failedSteps
        self.needsYou = needsYou
    }

    private struct Line: Decodable {
        let event: String
        let ok: Bool?
        let skipped: String?
        let failedSteps: [String]?
        let needsYou: Bool?
    }

    public static func parse(stdout: Data) -> SetupUpdateOutcome {
        let text = String(decoding: stdout, as: UTF8.self)
        for raw in text.split(separator: "\n").reversed() {
            guard let line = try? JSONDecoder().decode(Line.self, from: Data(raw.utf8)), line.event == "done" else { continue }
            return SetupUpdateOutcome(ok: line.ok ?? false, skipped: line.skipped, failedSteps: line.failedSteps ?? [],
                                      needsYou: line.needsYou ?? false)
        }
        return SetupUpdateOutcome(ok: false, skipped: nil, failedSteps: [])
    }
}
