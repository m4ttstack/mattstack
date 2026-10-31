import SwiftUI
import MattstackCore

struct StepsSheet: View {
    let title: String
    let steps: [String]
    @Environment(\.dismiss) private var dismiss
    @Environment(\.fastSheet) private var fast

    var body: some View {
        if fast { fastBody } else { systemBody }
    }

    private var systemBody: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline)
            ForEach(Array(steps.enumerated()), id: \.offset) { i, s in
                HStack(alignment: .top) { Text("\(i + 1).").monospacedDigit(); Text(StepText.attributed(s)).textSelection(.enabled) }
            }
            HStack { Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.defaultAction).accessibilityIdentifier(AXID.stepsDone) }
        }
        .padding(20).frame(width: 440)
    }

    /// Fast setup's sheet: the window's dark fill, its heading and text, and its primary button.
    private var fastBody: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(title).font(.system(size: 18, weight: .bold)).tracking(FastTheme.tracking(css: -0.5))
                .foregroundColor(FastTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            FastCard {
                ForEach(Array(steps.enumerated()), id: \.offset) { i, s in
                    if i > 0 { FastRowDivider() }
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text("\(i + 1)").font(.system(size: 12, weight: FastTheme.weight(css: .semibold), design: .monospaced))
                            .foregroundColor(FastTheme.textTertiary)
                            .frame(width: 14, alignment: .trailing)
                        Text(StepText.attributed(s)).font(.system(size: 13)).foregroundColor(FastTheme.textPrimary)
                            .lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.vertical, 12).padding(.horizontal, 16)
                }
            }
            .tint(FastTheme.accent)
            HStack {
                Spacer()
                Button("Done") { dismiss() }
                    .buttonStyle(FastPrimaryButtonStyle(glow: false, shape: .retry))
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier(AXID.stepsDone)
            }
        }
        .padding(28)
        .frame(width: 480)
        .background(FastWindowBackground())
        .environment(\.colorScheme, .dark)
    }
}
