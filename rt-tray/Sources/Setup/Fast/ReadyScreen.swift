import SwiftUI
import MattstackCore

/// P7: setup finished. A green check, two lines, and rt's button for the app
/// to open; no summary of what was done. P7 draws no footer: the button sits
/// in the centred body, still the screen's primary and Return key.
struct ReadyScreenBody: View {
    let home: FormHome
    let onOpen: () -> Void

    var body: some View {
        FastScreen(insets: EdgeInsets(top: 56, leading: 48, bottom: 48, trailing: 48), spacing: 14, alignment: .center) {
            FastHeroTile(symbol: "checkmark", tint: FastTheme.success)
            FastScreenHeader(title: "This Mac is ready", subtitle: "Go make something cool", spacing: 14, alignment: .center)
            // P7's 6-point spacer, between two of the body's 14-point gaps.
            Color.clear.frame(width: 1, height: 6)
            Button(home.label, action: onOpen)
                .buttonStyle(FastPrimaryButtonStyle())
                .keyboardShortcut(.defaultAction)
                .fixedSize()
                .accessibilityIdentifier(AXID.fastPrimary(FastSetupScreen.ready.rawValue))
        }
        .multilineTextAlignment(.center)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.ready.rawValue))
    }
}
