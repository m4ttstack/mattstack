import SwiftUI

/// A fast-setup screen's foot: a note on the left, then the secondary and primary buttons.
struct FastFooter: View {
    /// Names the buttons' accessibility ids (`setup.fast.<screen>.primary`).
    let screen: String
    let note: String?
    let secondary: (String, () -> Void)?
    /// The label, whether it is enabled, and what it does.
    let primary: (String, Bool, () -> Void)?

    var body: some View {
        HStack(spacing: 10) {
            if let note {
                Text(note).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 12)
            if let secondary {
                Button(secondary.0, action: secondary.1).fixedSize()
                    .accessibilityIdentifier(AXID.fastSecondary(screen))
            }
            if let primary {
                Button(primary.0, action: primary.2)
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(!primary.1)
                    .fixedSize()
                    .accessibilityIdentifier(AXID.fastPrimary(screen))
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .overlay(alignment: .top) { Divider() }
    }
}
