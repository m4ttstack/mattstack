import AppKit
import SwiftUI
import MattstackCore

/// P6 and P6b, live: the bar is worked out again every second so the time
/// left keeps up with elapsed time, and Show log opens here.
struct RunScreen: View {
    @ObservedObject var model: InstallRunModel
    /// When this run started, or the run a relaunch attached to.
    let startedAt: Date
    let paused: FormPaused?
    let onHide: () -> Void
    let onRetry: () -> Void
    let onPausedAction: ((RowAction) -> Void)?
    @State private var showLog = false
    /// The run's highest drawn fraction, so the bar never slides back.
    @State private var highWater: Double = 0

    /// After a relaunch this app holds no lines for the step, so rt's copy from the events file stands in.
    static func logLines(_ paused: FormPaused, appLines: [String]) -> [String] {
        appLines.isEmpty ? paused.log : appLines
    }

    private func bar(at date: Date) -> RunBar? {
        guard !model.steps.isEmpty else { return nil }
        return RunProgress.monotonic(previous: highWater, current: RunProgress.bar(steps: model.steps, elapsed: date.timeIntervalSince(startedAt)))
    }

    private var rawFraction: Double {
        model.steps.isEmpty ? 0 : RunProgress.bar(steps: model.steps, elapsed: 0).fraction
    }

    var body: some View {
        TimelineView(.periodic(from: startedAt, by: 1)) { context in
            RunScreenBody(bar: bar(at: context.date), paused: paused, onHide: onHide, onShowLog: { showLog = true },
                          onRetry: onRetry, onPausedAction: onPausedAction)
        }
        .onAppear { highWater = rawFraction }
        .onChange(of: rawFraction) { _, raw in highWater = max(highWater, raw) }
        .onChange(of: startedAt) { highWater = rawFraction }
        .sheet(isPresented: $showLog) {
            if let paused {
                LogSheet(title: paused.title, lines: Self.logLines(paused, appLines: model.logLines(for: paused.step)))
            }
        }
    }
}

/// P6 while `paused` is nil, P6b once rt names a failed step. No step list:
/// one bar, rt's phase message under it, the percent and time left beside it.
struct RunScreenBody: View {
    /// Nil before the plan arrives, and after a relaunch that lands on P6b.
    let bar: RunBar?
    let paused: FormPaused?
    let onHide: () -> Void
    let onShowLog: () -> Void
    let onRetry: () -> Void
    let onPausedAction: ((RowAction) -> Void)?

    private var screen: String { (paused == nil ? FastSetupScreen.running : FastSetupScreen.paused).rawValue }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 22) {
                if let paused {
                    // The subtitle slot is filled so the bar stays where P6 drew it when a live run pauses.
                    FastScreenHeader(label: nil, title: "Setup paused", subtitle: "Everything before this step is done")
                    pausedBody(paused)
                } else {
                    FastScreenHeader(label: nil, title: "Setting up this Mac", subtitle: "Nothing needs you. Close the window if you like")
                    runningBody
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            Spacer(minLength: 0)
            footer
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(screen))
    }

    private var runningBody: some View {
        VStack(alignment: .leading, spacing: 10) {
            RunBarView(fraction: bar?.fraction, stopped: false)
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(bar?.message ?? "Getting ready").font(.callout)
                Spacer(minLength: 12)
                if let bar {
                    Text(RunProgress.percentText(bar.fraction)).font(.callout.monospacedDigit())
                    if let left = RunProgress.timeLeftText(bar.secondsLeft) {
                        Text(left).font(.callout).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func pausedBody(_ paused: FormPaused) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let bar { RunBarView(fraction: bar.fraction, stopped: true) }
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(paused.title).font(.callout.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 12)
                if let bar {
                    Text(RunProgress.percentText(bar.fraction)).font(.callout.monospacedDigit()).foregroundStyle(.tertiary)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(paused.detail)
                if let remedy = paused.remedy, !remedy.isEmpty { Text(remedy) }
            }
            .font(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var footer: some View {
        if let paused {
            let extra = paused.action.flatMap { action in onPausedAction.map { perform in (action.label, { perform(action) }) } }
            FastFooter(screen: screen, note: nil, secondary: ("Show log", onShowLog), primary: ("Retry", true, onRetry), extra: extra)
        } else {
            FastFooter(screen: screen, note: nil, secondary: nil, primary: ("Hide", true, onHide))
        }
    }
}

/// The one bar. A sheen crosses the fill while it runs, so a long step that
/// sends no progress still reads as working; stopped, it goes grey and still.
/// With no fraction yet, a short segment sweeps the track instead. Motion
/// rests while the window is not active and under Reduce Motion.
private struct RunBarView: View {
    let fraction: Double?
    let stopped: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.controlActiveState) private var activeState

    private static let height: CGFloat = 8
    private static let sheenPeriod: TimeInterval = 2.4
    private static let sweepPeriod: TimeInterval = 1.6
    /// Where a resting sweep sits, so a frozen frame is the same every time.
    private static let restingSweep: Double = 0.35
    private static let track = NSColor(name: nil) { appearance in
        NSColor.labelColor.withAlphaComponent(FastAppearance.isDark(appearance) ? 0.14 : 0.08)
    }
    private static let stoppedFill = NSColor(name: nil) { appearance in
        NSColor.labelColor.withAlphaComponent(FastAppearance.isDark(appearance) ? 0.28 : 0.3)
    }
    private static let sheen = NSColor(name: nil) { appearance in
        NSColor.white.withAlphaComponent(FastAppearance.isDark(appearance) ? 0.28 : 0.4)
    }

    private var moving: Bool { !stopped && !reduceMotion && activeState != .inactive }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color(nsColor: Self.track))
                if let fraction {
                    fill(fraction, in: geo.size.width)
                } else if !stopped && !reduceMotion {
                    sweep(in: geo.size.width)
                } else {
                    Capsule().fill(Color.accentColor).frame(width: Self.height)
                }
            }
        }
        .frame(height: Self.height)
        .accessibilityElement()
        .accessibilityLabel(stopped ? "Setup paused" : "Setup progress")
        .accessibilityValue(fraction.map(RunProgress.percentText) ?? "Getting ready")
    }

    @ViewBuilder private func fill(_ fraction: Double, in trackWidth: CGFloat) -> some View {
        let clamped = min(max(fraction, 0), 1)
        // A started bar always shows its rounded end, even at 0%.
        let width = max(trackWidth * clamped, Self.height)
        Capsule()
            .fill(stopped ? Color(nsColor: Self.stoppedFill) : Color.accentColor)
            .frame(width: width)
            .animation(.easeOut(duration: 0.6), value: clamped)
        if moving {
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !moving)) { context in
                let band: CGFloat = 90
                let phase = Self.phase(context.date, period: Self.sheenPeriod)
                LinearGradient(colors: [.clear, Color(nsColor: Self.sheen), .clear], startPoint: .leading, endPoint: .trailing)
                    .frame(width: band)
                    .offset(x: -band + (width + band) * phase)
            }
            .frame(width: width, alignment: .leading)
            .clipShape(Capsule())
            .allowsHitTesting(false)
        }
    }

    private func sweep(in trackWidth: CGFloat) -> some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !moving)) { context in
            let band = trackWidth * 0.22
            let phase = moving ? Self.phase(context.date, period: Self.sweepPeriod) : Self.restingSweep
            Capsule()
                .fill(Color.accentColor.opacity(0.7))
                .frame(width: band)
                .offset(x: -band + (trackWidth + band) * phase)
        }
        .frame(width: trackWidth, alignment: .leading)
        .clipShape(Capsule())
        .allowsHitTesting(false)
    }

    private static func phase(_ date: Date, period: TimeInterval) -> Double {
        date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period
    }
}
