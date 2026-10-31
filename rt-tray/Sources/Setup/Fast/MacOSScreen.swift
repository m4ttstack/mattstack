import SwiftUI
import MattstackCore

/// P1: rt's macOS section in one card. No footer button: the screen moves on
/// by itself once `FastSetupFlow.macosReady` reads true.
struct MacOSScreenBody: View {
    let rows: [FormRow]
    let waiting: [String: String]
    let errors: [String: String]
    let onAction: FormRowPerform

    /// rt sends neither line, so the screen carries P1's own copy.
    static let subtitle = "mattstack can't do these itself. It notices the moment you do"
    static let reopenNote = "mattstack reopens itself after Full Disk Access, then carries on"

    var body: some View {
        FastScreen {
            FastTheme.heading("Three things from macOS").fixedSize(horizontal: false, vertical: true)
            FastTheme.sub(Self.subtitle).fixedSize(horizontal: false, vertical: true)
            FormCard(title: nil, rows: rows, waiting: waiting, errors: errors, style: .tile, onAction: onAction)
            FastReopenNote(text: Self.reopenNote)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.macos.rawValue))
    }
}

/// P1's state line: an accent dot and a quiet sentence.
private struct FastReopenNote: View {
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(FastTheme.accent).frame(width: 7, height: 7).accessibilityHidden(true)
            Text(text).font(FastTheme.note).foregroundColor(FastTheme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
