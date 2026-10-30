import SwiftUI
import MattstackCore

/// P5: rt's connect section in one card. Continue waits on rt's `continueReady`.
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

    var body: some View {
        VStack(spacing: 0) {
            // A team with several sign-ins outgrows the window's height, so the card scrolls under a fixed footer.
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    FastScreenHeader(label: nil, title: teamFirst ? "You're in. Connect your accounts" : "Connect your accounts",
                                     subtitle: "One click each. Most open in your browser")
                    FormCard(title: nil, rows: rows, waiting: waiting, errors: errors, onAction: onAction)
                }
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .scrollBounceBehavior(.basedOnSize)
            FastFooter(screen: FastSetupScreen.connect.rawValue, note: "Continue unlocks once each one is connected",
                       secondary: onBack.map { ("Back", $0) }, primary: ("Continue", continueReady, onContinue))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.connect.rawValue))
    }
}
