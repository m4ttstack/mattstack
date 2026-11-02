import SwiftUI

/// One answer to a question asked before anything else on its row: a symbol, the answer and a line on what it means.
struct FastChoiceTile: View {
    let symbol: String?
    let title: String
    let detail: String
    /// The answer gives something up, so its line reads in the warning colour.
    var warn = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 7) {
                if let symbol { Image(systemName: symbol).font(.system(size: 12)) }
                Text(title).font(.system(size: 12, weight: FastTheme.weight(css: .semibold)))
            }
            .foregroundColor(FastTheme.textPrimary)
            HStack(spacing: 5) {
                if warn { Image(systemName: "exclamationmark.triangle").font(.system(size: 10)) }
                Text(detail).font(.system(size: 11)).lineLimit(1).truncationMode(.middle)
            }
            .foregroundColor(warn ? FastTheme.warning : FastTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 11)
        .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// The path cards' hover: the outline lifts and the fill brightens a touch; nothing reads as picked.
struct FastChoiceTileStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        FastChoiceTileFrame(label: configuration.label, pressed: configuration.isPressed)
    }
}

private struct FastChoiceTileFrame<Label: View>: View {
    let label: Label
    let pressed: Bool
    @State private var hovered = false
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        let lifted = enabled && (hovered || pressed)
        label
            .background {
                shape.fill(FastTheme.fieldFill)
                if lifted { shape.fill(Color.white.opacity(0.03)) }
            }
            .overlay(shape.strokeBorder(lifted ? FastTheme.outlineHover : FastTheme.outline, lineWidth: 1))
            .opacity(enabled ? 1 : 0.5)
            .onHover { hovered = $0 }
    }
}

/// An answered row's answer and the way back to the question.
struct FastAnswerChip: View {
    let label: String
    let changeID: String
    let onChange: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 11, weight: FastTheme.weight(css: .medium))).foregroundColor(FastTheme.textSecondary)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FastTheme.divider))
                .fixedSize()
            Button("Change", action: onChange)
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: FastTheme.weight(css: .medium))).foregroundColor(FastTheme.accent)
                .fixedSize()
                .accessibilityIdentifier(changeID)
        }
    }
}
