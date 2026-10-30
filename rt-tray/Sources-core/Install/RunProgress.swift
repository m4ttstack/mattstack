import Foundation

public struct RunBar: Equatable, Sendable {
    public var fraction: Double
    public var message: String
    public var secondsLeft: Int?
    public init(fraction: Double, message: String, secondsLeft: Int?) {
        self.fraction = fraction; self.message = message; self.secondsLeft = secondsLeft
    }
}

public enum RunProgress {
    private static let finished: Set<StepState> = [.done, .partial, .skipped, .needsYou]

    public static func bar(steps: [InstallStep], elapsed: TimeInterval) -> RunBar {
        let total = steps.reduce(0) { $0 + weight($1) }
        var done = 0.0
        for s in steps {
            if finished.contains(s.state) {
                done += weight(s)
            } else if s.state == .running, let p = s.progress {
                done += weight(s) * Double(min(max(p.percent, 0), 100)) / 100
            }
        }
        let fraction = total > 0 ? min(max(done / total, 0), 1) : 0
        let message = steps.first(where: { $0.state == .running })?.info.phase
            ?? steps.last(where: { finished.contains($0.state) && $0.info.phase != nil })?.info.phase
            ?? "Getting ready"
        var left: Int?
        if fraction >= 0.05, elapsed >= 20 {
            left = Int((elapsed * (1 - fraction) / fraction).rounded())
        }
        return RunBar(fraction: fraction, message: message, secondsLeft: left)
    }

    public static func timeLeftText(_ seconds: Int?) -> String? {
        guard let seconds else { return nil }
        if seconds < 60 { return "Less than a minute left" }
        let minutes = (seconds + 59) / 60
        return minutes == 1 ? "About 1 minute left" : "About \(minutes) minutes left"
    }

    public static func percentText(_ fraction: Double) -> String {
        "\(Int((fraction * 100).rounded()))%"
    }

    private static func weight(_ s: InstallStep) -> Double { s.info.weight ?? 1 }
}

public enum FastSetupRun {
    public static func arguments(retryFrom: String?) -> [String] {
        if let id = retryFrom { return ["setup", "apply", "--from", id, "--json"] }
        return ["setup", "apply", "--resume", "--unattended", "--json"]
    }
}
