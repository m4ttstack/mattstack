import SwiftUI
import MattstackCore

/// P1: rt's macOS section in one card. No footer button: the screen moves on
/// by itself once `FastSetupFlow.macosReady` reads true.
struct MacOSScreenBody: View {
    let rows: [FormRow]
    let waiting: [String: String]
    let errors: [String: String]
    let onAction: FormRowPerform

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            FastScreenHeader(label: nil, title: "Three things from macOS", subtitle: nil)
            FormCard(title: nil, rows: rows, waiting: waiting, errors: errors, onAction: onAction)
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.macos.rawValue))
    }
}
