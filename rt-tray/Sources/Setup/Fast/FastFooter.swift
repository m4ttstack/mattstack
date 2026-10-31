import SwiftUI

/// A fast-setup screen's foot, with no divider: a note on the left, then the
/// secondary and primary buttons. `insets` and `spacing` follow the screen's CSS.
struct FastFooter: View {
    /// Names the buttons' accessibility ids (`setup.fast.<screen>.primary`).
    let screen: String
    let note: String?
    let secondary: (String, () -> Void)?
    /// The label, whether it is enabled, and what it does.
    let primary: (String, Bool, () -> Void)?
    /// A button rt sent, drawn before the secondary.
    var extra: (String, () -> Void)? = nil
    var insets: EdgeInsets = FastTheme.footerInsets
    var spacing: CGFloat = FastTheme.footerGap
    /// P4 and P6 draw their Hide outlined: still the primary's id and Return key, in the secondary style.
    var quietPrimary = false

    var body: some View {
        HStack(spacing: spacing) {
            if let note {
                Text(note).font(FastTheme.note).foregroundColor(FastTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 12)
            if let extra {
                Button(extra.0, action: extra.1)
                    .buttonStyle(FastSecondaryButtonStyle(size: .large))
                    .fixedSize()
                    .accessibilityIdentifier(AXID.fastExtra(screen))
            }
            if let secondary {
                Button(secondary.0, action: secondary.1)
                    .buttonStyle(FastSecondaryButtonStyle(size: .large))
                    .fixedSize()
                    .accessibilityIdentifier(AXID.fastSecondary(screen))
            }
            if let primary {
                primaryButton(primary)
                    .keyboardShortcut(.defaultAction)
                    .disabled(!primary.1)
                    .fixedSize()
                    .accessibilityIdentifier(AXID.fastPrimary(screen))
            }
        }
        .padding(insets)
    }

    @ViewBuilder private func primaryButton(_ primary: (String, Bool, () -> Void)) -> some View {
        if quietPrimary {
            Button(primary.0, action: primary.2).buttonStyle(FastSecondaryButtonStyle(size: .large))
        } else {
            Button(primary.0, action: primary.2).buttonStyle(FastPrimaryButtonStyle(size: .large))
        }
    }
}
