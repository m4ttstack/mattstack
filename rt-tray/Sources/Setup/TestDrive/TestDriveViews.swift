import AppKit
import SwiftUI
import MattstackCore

struct TestDriveRun: Equatable {
    var scenario: TestDriveScenario
    var speed: TestDriveSpeed
}

@MainActor
final class TestDrivePickerModel: ObservableObject {
    @Published var scenario: TestDriveScenario = .join
    @Published var speed: TestDriveSpeed = .instant
    @Published var live: TestDriveRun?
    /// How the last drive ended.
    @Published var note: String?
    /// Why no drive can start on this Mac.
    @Published var problem: String?
    /// The stub's probe has not answered yet.
    @Published var checking = false
}

struct TestDrivePickerActions {
    var start: () -> Void
    var show: () -> Void
    var reset: () -> Void
    var cancel: () -> Void

    static let inert = TestDrivePickerActions(start: {}, show: {}, reset: {}, cancel: {})
}

/// Picks what the next test drive rehearses, and reaches the one already
/// running. It draws the setup window's dark theme, so the two read as one tool.
struct TestDrivePickerView: View {
    static let width: CGFloat = 480
    @ObservedObject var model: TestDrivePickerModel
    @ObservedObject var toasts: TestDriveToasts
    let actions: TestDrivePickerActions

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 16) {
                FastScreenHeader(label: nil, title: "Test drive setup",
                                 subtitle: "The real setup window on a pretend rt. Nothing on this Mac changes", spacing: 10)
                FastCard {
                    ForEach(Array(TestDriveScenario.allCases.enumerated()), id: \.element) { index, scenario in
                        if index > 0 { FastRowDivider() }
                        scenarioRow(scenario)
                    }
                }
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Speed").font(.system(size: 13, weight: FastTheme.weight(css: .semibold))).foregroundColor(FastTheme.textPrimary)
                        Spacer(minLength: 12)
                        FastSegmented(options: TestDriveSpeed.allCases.map { (id: $0, label: $0.title) }, selection: $model.speed)
                            .accessibilityRepresentation {
                                Picker("Speed", selection: $model.speed) {
                                    ForEach(TestDriveSpeed.allCases) { Text($0.title).tag($0) }
                                }
                                .pickerStyle(.segmented)
                            }
                    }
                    FastHint(model.speed.detail, size: 12)
                }
                if let live = model.live { liveRow(live) }
            }
            .padding(.top, 28).padding(.horizontal, 28).padding(.bottom, 8)
            FastFooter(screen: "test-drive", note: model.problem ?? (model.checking ? TestDriveCopy.checking : model.note),
                       secondary: ("Cancel", actions.cancel), primary: ("Start", model.problem == nil && !model.checking, actions.start),
                       insets: EdgeInsets(top: 12, leading: 28, bottom: 22, trailing: 28), spacing: 10)
        }
        .frame(width: Self.width)
        .background(FastWindowBackground())
        .environment(\.colorScheme, .dark)
        .foregroundColor(FastTheme.textPrimary)
        .controlSize(.large)
    }

    private func scenarioRow(_ scenario: TestDriveScenario) -> some View {
        let picked = model.scenario == scenario
        return HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: picked ? "largecircle.fill.circle" : "circle")
                .font(.system(size: 13))
                .foregroundColor(picked ? FastTheme.accent : FastTheme.textTertiary)
                .frame(width: 14)
            VStack(alignment: .leading, spacing: 3) {
                Text(scenario.title).font(.system(size: 14, weight: FastTheme.weight(css: .semibold))).foregroundColor(FastTheme.textPrimary)
                Text(scenario.detail).font(.system(size: 12)).foregroundColor(FastTheme.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .background(picked ? FastTheme.accentWash : Color.clear)
        .contentShape(Rectangle())
        .onTapGesture { model.scenario = scenario }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(picked ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier(AXID.testDriveScenario(scenario.rawValue))
    }

    private func liveRow(_ live: TestDriveRun) -> some View {
        FastCard {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Current drive").font(FastTheme.cardTitle).foregroundColor(FastTheme.textSecondary)
                    HStack(spacing: 8) {
                        Text(live.scenario.title).font(.system(size: 13, weight: FastTheme.weight(css: .semibold))).foregroundColor(FastTheme.textPrimary)
                        Text(live.speed.title).font(.system(size: 13)).foregroundColor(FastTheme.textSecondary)
                    }
                    if let notice = toasts.notice {
                        FastHint(notice, size: 12, symbol: "bell.badge", tint: FastTheme.warning).padding(.top, 2)
                    }
                }
                Spacer(minLength: 12)
                Button("Show", action: actions.show).buttonStyle(FastSecondaryButtonStyle()).fixedSize()
                    .accessibilityIdentifier(AXID.testDriveShow)
                Button("Reset", action: actions.reset).buttonStyle(FastSecondaryButtonStyle()).fixedSize()
                    .accessibilityIdentifier(AXID.testDriveReset)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
        }
    }
}

/// The test drive window: a banner that says so above the real setup screens, and a create-token link
/// shown on it rather than opened.
struct TestDriveFrame: View {
    static let bannerHeight: CGFloat = 60
    @ObservedObject var toasts: TestDriveToasts
    let run: TestDriveRun
    let onShow: () -> Void
    let onScenarios: () -> Void
    let onReset: () -> Void
    let content: AnyView
    @Environment(\.controlActiveState) private var activeState

    var body: some View {
        VStack(spacing: 0) {
            TestDriveBanner(toast: toasts.latest, toastFailed: toasts.latestFailed, notice: toasts.notice, run: run,
                            onShow: onShow, onScenarios: onScenarios, onReset: onReset)
            // The window keeps macOS's title bar over the banner, so the traffic lights are not beside this one.
            content.environment(\.fastLightsBesideTitle, false)
        }
        .environment(\.openSetupLink) { [toasts] url in toasts.show(TestDriveCopy.wouldOpen(url)) }
        // Looking at the window is the click a real notification waits for, and it frees the banner for later lines.
        .onChange(of: activeState) { _, state in if state == .key { toasts.clearNotice() } }
    }
}

struct TestDriveBanner: View {
    let toast: String?
    var toastFailed = false
    /// A pretend notification waiting on its click.
    let notice: String?
    let run: TestDriveRun
    let onShow: () -> Void
    let onScenarios: () -> Void
    let onReset: () -> Void

    /// Two lines of controls share the banner's 60 points, so its buttons sit slimmer than a row's.
    private static let button = FastButtonShape(vertical: 3, horizontal: 10, radius: 6)

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Text("TEST DRIVE")
                    .font(.system(size: 10, weight: .bold)).tracking(1.2).foregroundColor(FastTheme.windowBackground)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Capsule().fill(FastTheme.warning))
                Text(run.scenario.title).font(.system(size: 13, weight: FastTheme.weight(css: .semibold))).foregroundColor(FastTheme.textPrimary)
                Text(run.speed.title).font(.system(size: 13)).foregroundColor(FastTheme.textSecondary)
                Spacer(minLength: 12)
                Button("Scenarios…", action: onScenarios).buttonStyle(FastSecondaryButtonStyle(shape: Self.button)).fixedSize()
                    .accessibilityIdentifier(AXID.testDriveScenarios)
                Button("Reset", action: onReset).buttonStyle(FastSecondaryButtonStyle(shape: Self.button)).fixedSize()
                    .accessibilityIdentifier(AXID.testDriveReset)
            }
            // A refusal outranks a waiting notice: it is why a row will never move.
            if let notice, !(toastFailed && toast != nil) {
                HStack(spacing: 8) {
                    line(notice, symbol: "bell.badge", tint: FastTheme.warning, ink: FastTheme.textPrimary)
                    Button("Show", action: onShow).buttonStyle(FastSecondaryButtonStyle(shape: Self.button)).fixedSize()
                        .accessibilityIdentifier(AXID.testDriveShow)
                }
            } else if let toast {
                if toastFailed {
                    line(toast, symbol: "exclamationmark.circle", tint: FastTheme.warning, ink: FastTheme.warning)
                } else {
                    line(toast, symbol: "arrow.up.forward.app", tint: FastTheme.accent, ink: FastTheme.textPrimary)
                }
            } else {
                line("Links, prompts and notifications show here instead", symbol: "info.circle", tint: FastTheme.textTertiary,
                     ink: FastTheme.textTertiary)
            }
        }
        .padding(.horizontal, 14)
        .frame(height: TestDriveFrame.bannerHeight)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FastTheme.titleBar.overlay(FastTheme.warning.opacity(0.08)))
        .overlay(alignment: .bottom) { Rectangle().fill(FastTheme.divider).frame(height: 1) }
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.testDriveBanner)
    }

    private func line(_ text: String, symbol: String, tint: Color, ink: Color) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: 12, weight: .light)).foregroundColor(tint)
            Text(text).font(.system(size: 12)).foregroundColor(ink).lineLimit(1).truncationMode(.middle)
        }
    }
}
