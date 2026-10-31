import SwiftUI
import MattstackCore

/// P5: rt's connect section in one card. Continue waits on rt's `continueReady`.
/// Just me (P5s) draws the same card under its own heading.
struct ConnectScreenBody: View {
    /// A team path reached this screen through the invite or create screens; Just me came straight from the path choice.
    let teamFirst: Bool
    let rows: [FormRow]
    let waiting: [String: String]
    let errors: [String: String]
    let continueReady: Bool
    let onAction: FormRowPerform
    let onBack: (() -> Void)?
    let onContinue: () -> Void

    static let insets = EdgeInsets(top: 32, leading: 48, bottom: 24, trailing: 48)
    static let footerInsets = EdgeInsets(top: 14, leading: 48, bottom: 22, trailing: 48)

    var body: some View {
        FastScreen(insets: Self.insets, spacing: 18) {
            FastTheme.heading(teamFirst ? "You're in. Connect your accounts" : "Connect your accounts")
                .fixedSize(horizontal: false, vertical: true)
            FastTheme.sub("One click each. Most open in your browser").fixedSize(horizontal: false, vertical: true)
            FormCard(title: nil, rows: rows, waiting: waiting, errors: errors, style: .labelled, onAction: onAction)
        } footer: {
            FastFooter(screen: FastSetupScreen.connect.rawValue, note: "Continue unlocks once each one is connected",
                       secondary: onBack.map { ("Back", $0) }, primary: ("Continue", continueReady, onContinue),
                       insets: Self.footerInsets, quietSecondary: true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.connect.rawValue))
    }
}
