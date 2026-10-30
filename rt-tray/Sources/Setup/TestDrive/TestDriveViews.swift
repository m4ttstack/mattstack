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

/// Picks what the next test drive rehearses, and reaches the one already running.
struct TestDrivePickerView: View {
    static let width: CGFloat = 480
    @ObservedObject var model: TestDrivePickerModel
    @ObservedObject var toasts: TestDriveToasts
    let actions: TestDrivePickerActions

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 16) {
                FastScreenHeader(label: nil, title: "Test drive setup",
                                 subtitle: "The real setup window on a pretend rt. Nothing on this Mac changes")
                ChecklistCard {
                    ForEach(Array(TestDriveScenario.allCases.enumerated()), id: \.element) { index, scenario in
                        if index > 0 { Divider().padding(.leading, 40) }
                        scenarioRow(scenario)
                    }
                }
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Speed").fontWeight(.medium)
                        Spacer(minLength: 12)
                        Picker("Speed", selection: $model.speed) {
                            ForEach(TestDriveSpeed.allCases) { Text($0.title).tag($0) }
                        }
                        .pickerStyle(.segmented).labelsHidden().fixedSize()
                    }
                    Text(model.speed.detail).font(.callout).foregroundStyle(.secondary)
                }
                if let live = model.live { liveRow(live) }
            }
            .padding(24)
            FastFooter(screen: "test-drive", note: model.problem ?? (model.checking ? TestDriveCopy.checking : model.note),
                       secondary: ("Cancel", actions.cancel), primary: ("Start", model.problem == nil && !model.checking, actions.start))
        }
        .frame(width: Self.width)
        .controlSize(.large)
    }

    private func scenarioRow(_ scenario: TestDriveScenario) -> some View {
        let picked = model.scenario == scenario
        return HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: picked ? "largecircle.fill.circle" : "circle")
                .foregroundStyle(picked ? Color.accentColor : Color.secondary)
                .frame(width: 14)
            VStack(alignment: .leading, spacing: 2) {
                Text(scenario.title).fontWeight(.medium)
                Text(scenario.detail).font(.callout).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .contentShape(Rectangle())
        .onTapGesture { model.scenario = scenario }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(picked ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier(AXID.testDriveScenario(scenario.rawValue))
    }

    private func liveRow(_ live: TestDriveRun) -> some View {
        ChecklistCard {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Current drive").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        Text(live.scenario.title).fontWeight(.medium)
                        Text(live.speed.title).foregroundStyle(.secondary)
                    }
                    if let notice = toasts.notice {
                        Label(notice, systemImage: "bell.badge").font(.callout).padding(.top, 2)
                    }
                }
                Spacer(minLength: 12)
                Button("Show", action: actions.show).fixedSize().accessibilityIdentifier(AXID.testDriveShow)
                Button("Reset", action: actions.reset).fixedSize().accessibilityIdentifier(AXID.testDriveReset)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
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

    var body: some View {
        VStack(spacing: 0) {
            TestDriveBanner(toast: toasts.latest, toastFailed: toasts.latestFailed, notice: toasts.notice, run: run,
                            onShow: onShow, onScenarios: onScenarios, onReset: onReset)
            content
        }
        .environment(\.openSetupLink) { [toasts] url in toasts.show(TestDriveCopy.wouldOpen(url)) }
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

    private static let tint = NSColor(name: nil) { appearance in
        NSColor.systemOrange.withAlphaComponent(FastAppearance.isDark(appearance) ? 0.16 : 0.10)
    }
    private static let badge = NSColor(name: nil) { appearance in
        FastAppearance.isDark(appearance) ? NSColor.systemOrange.blended(withFraction: 0.15, of: .black) ?? .systemOrange : .systemOrange
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Text("TEST DRIVE")
                    .font(.caption2.weight(.bold)).tracking(0.8).foregroundStyle(.white)
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(Capsule().fill(Color(nsColor: Self.badge)))
                Text(run.scenario.title).fontWeight(.medium)
                Text(run.speed.title).foregroundStyle(.secondary)
                Spacer(minLength: 12)
                Button("Scenarios…", action: onScenarios).controlSize(.small).fixedSize()
                    .accessibilityIdentifier(AXID.testDriveScenarios)
                Button("Reset", action: onReset).controlSize(.small).fixedSize()
                    .accessibilityIdentifier(AXID.testDriveReset)
            }
            if let notice {
                HStack(spacing: 8) {
                    Label {
                        Text(notice).lineLimit(1)
                    } icon: {
                        Image(systemName: "bell.badge").foregroundStyle(Color(nsColor: Self.badge))
                    }
                    .font(.callout)
                    Button("Show", action: onShow).controlSize(.small).fixedSize()
                        .accessibilityIdentifier(AXID.testDriveShow)
                }
            } else if let toast {
                Label {
                    Text(toast).lineLimit(1).truncationMode(.middle)
                } icon: {
                    if toastFailed {
                        Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
                    } else {
                        Image(systemName: "arrow.up.forward.app").foregroundStyle(Color(nsColor: Self.badge))
                    }
                }
                .font(.callout)
                .foregroundStyle(toastFailed ? Color.red : Color.primary)
            } else {
                Label("Links, prompts and notifications show here instead", systemImage: "info.circle")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .frame(height: TestDriveFrame.bannerHeight)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: Self.tint))
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.testDriveBanner)
    }
}
