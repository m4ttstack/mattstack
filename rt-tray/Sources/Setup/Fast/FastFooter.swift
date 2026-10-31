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
    /// P3c and P3r's Back: borderless text before the primary, as their mocks draw no second button.
    var quietSecondary = false
    /// A screen's own padding and corner for the secondary and primary (P6b's Show log and Retry).
    var secondaryShape: FastButtonShape? = nil
    var primaryShape: FastButtonShape? = nil
    /// P6b's Retry draws without the primary's glow.
    var primaryGlow = true

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
                secondaryButton(secondary)
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

    @ViewBuilder private func secondaryButton(_ secondary: (String, () -> Void)) -> some View {
        if quietSecondary {
            Button(secondary.0, action: secondary.1).buttonStyle(FastQuietButtonStyle()).padding(.trailing, 8)
        } else {
            Button(secondary.0, action: secondary.1).buttonStyle(FastSecondaryButtonStyle(size: .large, shape: secondaryShape))
        }
    }

    @ViewBuilder private func primaryButton(_ primary: (String, Bool, () -> Void)) -> some View {
        if quietPrimary {
            Button(primary.0, action: primary.2).buttonStyle(FastSecondaryButtonStyle(size: .large, shape: primaryShape))
        } else {
            Button(primary.0, action: primary.2).buttonStyle(FastPrimaryButtonStyle(size: .large, glow: primaryGlow, shape: primaryShape))
        }
    }
}
