import Foundation

/// The `done` line of `rt setup update --json`, for the launch log. No
/// other line matters to the tray: rt owns every decision and posts the
/// notification itself.
public struct SetupUpdateOutcome: Equatable, Sendable {
    public let ok: Bool
    public let skipped: String?
    public let failedSteps: [String]

    private struct Line: Decodable {
        let event: String
        let ok: Bool?
        let skipped: String?
        let failedSteps: [String]?
    }

    public static func parse(stdout: Data) -> SetupUpdateOutcome {
        let text = String(decoding: stdout, as: UTF8.self)
        for raw in text.split(separator: "\n").reversed() {
            guard let line = try? JSONDecoder().decode(Line.self, from: Data(raw.utf8)), line.event == "done" else { continue }
            return SetupUpdateOutcome(ok: line.ok ?? false, skipped: line.skipped, failedSteps: line.failedSteps ?? [])
        }
        return SetupUpdateOutcome(ok: false, skipped: nil, failedSteps: [])
    }
}
