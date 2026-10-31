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

    /// After a relaunch this app holds no lines for the step, so rt's copy from the events file stands in.
    static func logLines(_ paused: FormPaused, appLines: [String]) -> [String] {
        appLines.isEmpty ? paused.log : appLines
    }

    private func bar(at date: Date) -> RunBar? {
        guard !model.steps.isEmpty else { return nil }
        return RunProgress.monotonic(previous: model.peakFraction, current: RunProgress.bar(steps: model.steps, elapsed: date.timeIntervalSince(startedAt)))
    }

    var body: some View {
        TimelineView(.periodic(from: startedAt, by: 1)) { context in
            RunScreenBody(bar: bar(at: context.date), paused: paused, onHide: onHide, onShowLog: { showLog = true },
                          onRetry: onRetry, onPausedAction: onPausedAction)
        }
        .sheet(isPresented: $showLog) {
            if let paused {
                LogSheet(title: paused.title, lines: Self.logLines(paused, appLines: model.logLines(for: paused.step)))
                    .environment(\.fastSheet, true)
            }
        }
    }
}

/// P6 while `paused` is nil, P6b once rt names a failed step. No step list:
/// one bar under rt's phase message and the percent, the time left (or what
/// failed) under the bar.
struct RunScreenBody: View {
    /// Nil before the plan arrives, and after a relaunch that lands on P6b.
    let bar: RunBar?
    let paused: FormPaused?
    let onHide: () -> Void
    let onShowLog: () -> Void
    let onRetry: () -> Void
    let onPausedAction: ((RowAction) -> Void)?

    static let notifyLine = "You'll get a notification when it's done"

    private var screen: String { (paused == nil ? FastSetupScreen.running : FastSetupScreen.paused).rawValue }

    var body: some View {
        FastScreen(insets: EdgeInsets(top: 40, leading: 48, bottom: 40, trailing: 48), spacing: 14) {
            // The sub is filled on both screens so the bar stays where P6 drew it when a live run pauses.
            FastScreenHeader(title: paused == nil ? "Setting up this Mac" : "Setup paused",
                             subtitle: paused == nil ? "Nothing needs you. Close the window if you like" : "Everything before this step is done",
                             spacing: 14)
            if let paused {
                progress(title: paused.title, stopped: true) {
                    Text(paused.detail).font(.system(size: 12)).foregroundColor(FastTheme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }
                needsYou(paused)
            } else {
                progress(title: bar?.message ?? "Getting ready", stopped: false) {
                    // Holds its line before rt can say how long is left, so nothing under the bar jumps.
                    Text(bar.flatMap { RunProgress.timeLeftText($0.secondsLeft) } ?? " ")
                        .font(.system(size: 12)).foregroundColor(FastTheme.textTertiary)
                }
                HStack(spacing: 8) {
                    FastLucideGlyph(symbol: "bell", box: 13)
                    Text(Self.notifyLine).font(.system(size: 12))
                }
                .foregroundColor(FastTheme.textTertiary)
            }
        } footer: {
            footer
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(screen))
    }

    /// P6's progress block: the message and percent, the bar, then the line under it.
    private func progress(title: String, stopped: Bool, @ViewBuilder detail: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .lastTextBaseline, spacing: 12) {
                Text(title).font(.system(size: 15, weight: FastTheme.weight(css: .semibold))).tracking(FastTheme.subTracking)
                    .foregroundColor(FastTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if let bar {
                    Text(RunProgress.percentText(bar.fraction)).font(.system(size: 13, design: .monospaced))
                        .foregroundColor(FastTheme.textSecondary)
                }
            }
            // After a relaunch onto P6b the app has no fraction to hold, so it draws no bar rather than an empty one.
            if bar != nil || !stopped { RunBarView(fraction: bar?.fraction, stopped: stopped) }
            detail()
        }
        .padding(.top, 28).padding(.bottom, 8)
    }

    /// What rt says the person can do about the pause: its remedy, and the
    /// button it sends (Open Login Items…) in a labelled row's control style.
    @ViewBuilder private func needsYou(_ paused: FormPaused) -> some View {
        let remedy = paused.remedy.flatMap { $0.isEmpty ? nil : $0 }
        if let action = paused.action, let perform = onPausedAction {
            FastCard {
                VStack(alignment: .leading, spacing: 10) {
                    Button(action.label) { perform(action) }
                        .buttonStyle(FastOutlineButtonStyle())
                        .fixedSize()
                        .accessibilityIdentifier(AXID.fastExtra(screen))
                    if let remedy { FastHint(remedy, size: 12) }
                }
                .padding(.top, 14).padding(.bottom, 13).padding(.horizontal, 18)
            }
        } else if let remedy {
            FastHint(remedy, size: 12)
        }
    }

    @ViewBuilder private var footer: some View {
        if paused != nil {
            FastFooter(screen: screen, note: nil, secondary: ("Show log", onShowLog), primary: ("Retry", true, onRetry),
                       spacing: 10, secondaryShape: .log, primaryShape: .retry, primaryGlow: false)
        } else {
            FastFooter(screen: screen, note: nil, secondary: nil, primary: ("Hide", true, onHide), quietPrimary: true)
        }
    }
}

/// The one bar: a lilac-to-accent fill on the dark track. A sheen crosses the
/// fill while it runs, so a long step that sends no progress still reads as
/// working; stopped, it turns the warning colour and stands still. With no
/// fraction yet, a short segment sweeps the track instead. Motion rests while
/// the window is hidden or fully covered, and under Reduce Motion.
private struct RunBarView: View {
    let fraction: Double?
    let stopped: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var windowVisible = false

    private static let height: CGFloat = 10
    private static let sheenPeriod: TimeInterval = 2.4
    private static let sweepPeriod: TimeInterval = 1.6

    private var moving: Bool { !stopped && !reduceMotion && windowVisible }

    private var fillStyle: AnyShapeStyle {
        stopped ? AnyShapeStyle(FastTheme.warning)
            : AnyShapeStyle(LinearGradient(colors: [FastTheme.barStart, FastTheme.accent], startPoint: .leading, endPoint: .trailing))
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(FastTheme.divider)
                if let fraction {
                    fill(fraction, in: geo.size.width)
                } else if moving {
                    sweep(in: geo.size.width)
                } else {
                    Capsule().fill(fillStyle).frame(width: Self.height)
                }
            }
        }
        .frame(height: Self.height)
        .background(WindowVisibilityProbe(visible: $windowVisible))
        .accessibilityElement()
        .accessibilityLabel(stopped ? "Setup paused" : "Setup progress")
        .accessibilityValue(fraction.map(RunProgress.percentText) ?? "Getting ready")
    }

    @ViewBuilder private func fill(_ fraction: Double, in trackWidth: CGFloat) -> some View {
        let clamped = min(max(fraction, 0), 1)
        // A started bar always shows its rounded end, even at 0%.
        let width = max(trackWidth * clamped, Self.height)
        Capsule()
            .fill(fillStyle)
            .frame(width: width)
            .animation(.easeOut(duration: 0.6), value: clamped)
        if moving {
            TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
                let band: CGFloat = 90
                let phase = Self.phase(context.date, period: Self.sheenPeriod)
                LinearGradient(colors: [.clear, FastTheme.barSheen, .clear], startPoint: .leading, endPoint: .trailing)
                    .frame(width: band)
                    .offset(x: -band + (width + band) * phase)
            }
            .frame(width: width, alignment: .leading)
            .clipShape(Capsule())
            .allowsHitTesting(false)
        }
    }

    private func sweep(in trackWidth: CGFloat) -> some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
            let band = trackWidth * 0.22
            let phase = Self.phase(context.date, period: Self.sweepPeriod)
            Capsule()
                .fill(fillStyle)
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

/// Reports whether the hosting window shows any part of itself on screen. A
/// visible window behind another app still counts; hidden or fully covered does not.
private struct WindowVisibilityProbe: NSViewRepresentable {
    @Binding var visible: Bool

    func makeNSView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.onChange = { visible = $0 }
        return view
    }

    func updateNSView(_ view: ProbeView, context: Context) {
        view.onChange = { visible = $0 }
    }

    final class ProbeView: NSView {
        var onChange: ((Bool) -> Void)?
        private var observer: NSObjectProtocol?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let observer { NotificationCenter.default.removeObserver(observer) }
            observer = nil
            if let window {
                observer = NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main) { [weak self] _ in
                    MainActor.assumeIsolated { self?.report() }
                }
            }
            report()
        }

        private func report() {
            let visible = window?.occlusionState.contains(.visible) ?? false
            // Deferred: this can run inside a SwiftUI update, which must not write state.
            DispatchQueue.main.async { [weak self] in self?.onChange?(visible) }
        }
    }
}
