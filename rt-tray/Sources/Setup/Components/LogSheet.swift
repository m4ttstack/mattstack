import SwiftUI

struct LogSheet: View {
    let title: String
    let lines: [String]
    @Environment(\.dismiss) private var dismiss
    @Environment(\.fastSheet) private var fast

    private var text: String { lines.isEmpty ? "(no log lines)" : lines.joined(separator: "\n") }

    var body: some View {
        if fast { fastBody } else { systemBody }
    }

    private var systemBody: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            ScrollView {
                Text(text)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: 260)
            .background(Color(nsColor: .textBackgroundColor))
            HStack {
                Button("Copy", action: copy).accessibilityIdentifier(AXID.logCopy)
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction).accessibilityIdentifier(AXID.logDone)
            }
        }
        .padding(20).frame(width: 520)
    }

    /// Fast setup's sheet: the window's dark fill, the lines in a field-filled well, its secondary and primary buttons.
    private var fastBody: some View {
        let well = RoundedRectangle(cornerRadius: 10, style: .continuous)
        return VStack(alignment: .leading, spacing: 16) {
            Text(title).font(FastTheme.sheetHeading).tracking(FastTheme.sheetHeadingTracking)
                .foregroundColor(FastTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            ScrollView {
                Text(text)
                    .font(.system(size: 11, weight: .light, design: .monospaced))
                    .foregroundColor(FastTheme.textSecondary)
                    .lineSpacing(3)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 10).padding(.horizontal, 12)
            }
            .frame(height: 260)
            .background(well.fill(FastTheme.fieldFill))
            .clipShape(well)
            .overlay(well.strokeBorder(FastTheme.outline, lineWidth: 1))
            HStack(spacing: 10) {
                Spacer()
                Button("Copy", action: copy)
                    .buttonStyle(FastSecondaryButtonStyle(size: .large, shape: .log))
                    .accessibilityIdentifier(AXID.logCopy)
                Button("Done") { dismiss() }
                    .buttonStyle(FastPrimaryButtonStyle(glow: false, shape: .retry))
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier(AXID.logDone)
            }
        }
        .padding(28)
        .frame(width: 560)
        .background(FastWindowBackground())
        .environment(\.colorScheme, .dark)
    }

    private func copy() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(lines.joined(separator: "\n"), forType: .string)
    }
}
