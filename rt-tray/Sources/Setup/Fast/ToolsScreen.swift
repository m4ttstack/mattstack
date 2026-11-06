import SwiftUI
import MattstackCore

/// T2: a finished Mac's new team tools in one card. rt sends the heading, the rows and
/// `allDone`, which turns Done on and takes Later and the note away. Done waits for rt's ack.
struct ToolsScreenBody: View {
    /// nil only before rt's first read of the section.
    let tools: FormTools?
    let rows: [FormRow]
    let waiting: [String: String]
    let errors: [String: String]
    let isAcking: Bool
    let failure: String?
    let onAction: FormRowPerform
    let onLater: () -> Void
    let onDone: () -> Void

    /// rt's `tools` object has no field for this line, so the screen carries T2's own copy.
    static let footerNote = "Find this later in Setup status"

    static let insets = EdgeInsets(top: 32, leading: 48, bottom: 24, trailing: 48)
    static let footerInsets = EdgeInsets(top: 14, leading: 48, bottom: 22, trailing: 48)

    var body: some View {
        let allDone = tools?.allDone ?? false
        FastScreen(insets: Self.insets, spacing: 18) {
            FastScreenHeader(title: tools?.heading ?? "", spacing: 18)
            FormCard(title: nil, rows: rows, waiting: waiting, errors: errors, style: .labelled, onAction: onAction)
            if let failure {
                FastFailureLine(text: failure)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier(AXID.fastToolsFailure)
            }
        } footer: {
            FastFooter(screen: FastSetupScreen.tools.rawValue, note: allDone ? nil : Self.footerNote,
                       secondary: allDone ? nil : ("Later", onLater), primary: ("Done", allDone, onDone), primaryLoading: isAcking,
                       insets: Self.footerInsets)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.tools.rawValue))
    }
}
