import SwiftUI
import MattstackCore

/// P5: rt's connect section in one card. Continue waits on rt's `continueReady`.
/// Just me (P5s) draws the same card under its own heading and sub.
struct ConnectScreenBody: View {
    /// A team path reached this screen through the invite or create screens; Just me came straight from the path choice.
    let teamFirst: Bool
    let rows: [FormRow]
    let waiting: [String: String]
    let errors: [String: String]
    let continueReady: Bool
    /// rt's note beside Continue; nil from an rt older than the field.
    var continueNote: String? = nil
    let onAction: FormRowPerform
    let onBack: (() -> Void)?
    let onContinue: () -> Void

    /// rt sends no heading or sub for this screen, so the tray carries P5's and P5s's own words.
    static let teamHeading = "You're in. Connect your accounts"
    static let teamSubtitle = "One click each. Most open in your browser"
    static let soloHeading = "Just you. A few bits and bobs first:"
    static let soloSubtitle = "Add a team any time from Settings"
    static let teamFooter = "Continue unlocks once each one is connected"

    static let insets = EdgeInsets(top: 32, leading: 48, bottom: 24, trailing: 48)
    static let footerInsets = EdgeInsets(top: 14, leading: 48, bottom: 22, trailing: 48)

    var body: some View {
        FastScreen(insets: Self.insets, spacing: 18) {
            FastScreenHeader(title: teamFirst ? Self.teamHeading : Self.soloHeading,
                             subtitle: teamFirst ? Self.teamSubtitle : Self.soloSubtitle, spacing: 18)
            FormCard(title: nil, rows: rows, waiting: waiting, errors: errors, style: .labelled, onAction: onAction)
        } footer: {
            FastFooter(screen: FastSetupScreen.connect.rawValue, note: continueNote ?? Self.teamFooter,
                       secondary: onBack.map { ("Back", $0) }, primary: ("Continue", continueReady, onContinue),
                       insets: Self.footerInsets, quietSecondary: true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.connect.rawValue))
    }
}
