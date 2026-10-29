import AppKit
import SwiftUI
import MattstackCore

struct FullDiskAccessScreen: View {
    @ObservedObject var readiness: ReadinessModel
    var body: some View { FullDiskAccessPageBody(state: readiness.fullDiskAccessState) }
}

/// The page itself, apart from the model, so the snapshot flag can draw each state.
struct FullDiskAccessPageBody: View {
    let state: FDAPageState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .top, spacing: 16) {
                    Image(systemName: "internaldrive")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(Color.accentColor)
                        .frame(width: 44, height: 44)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.accentColor.opacity(0.12)))
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Turn on Full Disk Access").font(.title3.weight(.semibold))
                        Text("mattstack reads your repos and Chrome's profile with it").font(.callout).foregroundStyle(.secondary)
                    }
                }
                ChecklistCard {
                    stepRow(1, "Open Full Disk Access", done: state != .off) {
                        if state == .off {
                            Button("Open Full Disk Access") { NSWorkspace.shared.open(SystemSettingsLinks.fullDiskAccess) }
                                .buttonStyle(.borderedProminent)
                                .accessibilityIdentifier(AXID.fdaOpen)
                        }
                    }
                    Divider()
                    stepRow(2, "Turn on mattstack", done: state != .off) { EmptyView() }
                    Divider()
                    stepRow(3, "Reopen mattstack", done: state == .on) {
                        if state == .needsReopen {
                            Button { AppRelaunch.relaunchInPlace(resumeAt: .team) } label: {
                                Label("Reopen mattstack", systemImage: "arrow.clockwise")
                            }
                            .buttonStyle(.borderedProminent)
                            .accessibilityIdentifier(AXID.fdaReopen)
                        }
                    }
                }
                stateLine
            }
            .padding(EdgeInsets(top: 28, leading: 32, bottom: 24, trailing: 32))
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .background(Color.primary.opacity(0.035))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fdaScreen)
    }

    private func stepRow<Trailing: View>(_ n: Int, _ label: String, done: Bool, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(done ? Color.green.opacity(0.15) : Color.primary.opacity(0.08))
                if done {
                    Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.green)
                } else {
                    Text("\(n)").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            .frame(width: 22, height: 22)
            Text(label)
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 48)
    }

    @ViewBuilder private var stateLine: some View {
        switch state {
        case .off:
            dotLine(.orange, "Not on yet, checked again when you come back")
        case .needsReopen:
            dotLine(.accentColor, "On, takes effect after a reopen")
        case .on:
            Label("Full Disk Access is on", systemImage: "checkmark.circle.fill")
                .font(.callout)
                .foregroundStyle(.green)
        }
    }

    private func dotLine(_ color: Color, _ text: String) -> some View {
        HStack(spacing: 8) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(text).font(.callout).foregroundStyle(.secondary)
        }
    }
}
