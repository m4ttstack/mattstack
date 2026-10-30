import Foundation
import MattstackCore

private func step(_ id: String, _ state: StepState, phase: String? = nil, weight: Double? = nil, percent: Int? = nil) -> InstallStep {
    InstallStep(
        info: StepInfo(id: id, title: id, kind: .rt, phase: phase, weight: weight),
        state: state,
        progress: percent.map { StepProgress(label: "", percent: $0, note: nil) }
    )
}

let runProgressChecks: [Check] = [
    Check("RunProgress: weights decide the fraction") { c in
        let steps = [step("a", .done, weight: 3), step("b", .skipped, weight: 1), step("c", .pending, weight: 6)]
        c.expectEqual(RunProgress.bar(steps: steps, elapsed: 0).fraction, 0.4)
        let unweighted = [step("a", .done), step("b", .partial), step("c", .needsYou), step("d", .pending)]
        c.expectEqual(RunProgress.bar(steps: unweighted, elapsed: 0).fraction, 0.75, "absent weight counts as 1; partial and needs-you are finished")
        c.expectEqual(RunProgress.bar(steps: [], elapsed: 0).fraction, 0.0)
    },
    Check("RunProgress: a running step's own percent counts") { c in
        let steps = [step("a", .done, weight: 2), step("b", .running, weight: 4, percent: 50), step("c", .pending, weight: 4)]
        c.expectEqual(RunProgress.bar(steps: steps, elapsed: 0).fraction, 0.4)
        let noReport = [step("a", .done, weight: 2), step("b", .running, weight: 4), step("c", .pending, weight: 4)]
        c.expectEqual(RunProgress.bar(steps: noReport, elapsed: 0).fraction, 0.2)
    },
    Check("RunProgress: the message is the running step's phase") { c in
        let running = [step("a", .done, phase: "Installing tools"), step("b", .running, phase: "Cloning repos")]
        c.expectEqual(RunProgress.bar(steps: running, elapsed: 0).message, "Cloning repos")
        let idle = [step("a", .done, phase: "Installing tools"), step("b", .done, phase: "Cloning repos"), step("c", .pending, phase: "Last")]
        c.expectEqual(RunProgress.bar(steps: idle, elapsed: 0).message, "Cloning repos", "no running step: the last finished one")
        c.expectEqual(RunProgress.bar(steps: [step("a", .pending, phase: "Installing tools")], elapsed: 0).message, "Getting ready")
    },
    Check("RunProgress: no estimate before twenty seconds or five percent") { c in
        let half = [step("a", .done), step("b", .pending)]
        c.expectEqual(RunProgress.bar(steps: half, elapsed: 19).secondsLeft, nil)
        c.expectEqual(RunProgress.bar(steps: half, elapsed: 20).secondsLeft, 20)
        let early = [step("a", .done, weight: 1), step("b", .pending, weight: 39)]
        c.expectEqual(RunProgress.bar(steps: early, elapsed: 100).secondsLeft, nil, "2.5% is too early")
        let quarter = [step("a", .done, weight: 1), step("b", .pending, weight: 3)]
        c.expectEqual(RunProgress.bar(steps: quarter, elapsed: 30).secondsLeft, 90)
    },
    Check("RunProgress: time text rounds minutes up") { c in
        c.expectEqual(RunProgress.timeLeftText(nil), nil)
        c.expectEqual(RunProgress.timeLeftText(0), "Less than a minute left")
        c.expectEqual(RunProgress.timeLeftText(59), "Less than a minute left")
        c.expectEqual(RunProgress.timeLeftText(61), "About 2 minutes left")
        c.expectEqual(RunProgress.timeLeftText(120), "About 2 minutes left")
        c.expectEqual(RunProgress.timeLeftText(601), "About 11 minutes left")
        c.expectEqual(RunProgress.percentText(0.42), "42%")
        c.expectEqual(RunProgress.percentText(1), "100%")
    },
    Check("FastSetupRun: the bar resumes unattended, Retry runs attended from the step") { c in
        c.expectEqual(FastSetupRun.arguments(retryFrom: nil), ["setup", "apply", "--resume", "--unattended", "--json"])
        c.expectEqual(FastSetupRun.arguments(retryFrom: "daemon.start"), ["setup", "apply", "--from", "daemon.start", "--json"])
    },
]
