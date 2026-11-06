import SwiftUI

/// A fast-setup screen's foot, with no divider: a note on the left, then the
/// secondary and primary buttons. `insets` and `spacing` follow the screen's CSS.
struct FastFooter: View {
    /// Names the buttons' accessibility ids (`setup.fast.<screen>.primary`).
    let screen: String
    let note: String?
    /// Warning when the note is why the primary is disabled.
    var noteTint: Color = FastTheme.textSecondary
    let secondary: (String, () -> Void)?
    /// The label, whether it is enabled, and what it does.
    let primary: (String, Bool, () -> Void)?
    /// The screen's own word that its primary's work is running (creating a team, restoring).
    var primaryLoading = false
    var primaryLoadingTitle: String? = nil
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

    /// A press holds the primary in loading until the next screen replaces this footer, the screen
    /// takes over with `primaryLoading`, or the button's state moves, so it never just sits greyed out.
    @State private var pressed = false
    @State private var pressedAt = Date.distantPast
    private static let pressHold: TimeInterval = 8

    var body: some View {
        HStack(spacing: spacing) {
            if let note {
                Text(note).font(FastTheme.note).foregroundColor(noteTint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 12)
            if let secondary {
                secondaryButton(secondary)
                    .fixedSize()
                    .accessibilityIdentifier(AXID.fastSecondary(screen))
            }
            if let primary {
                primaryButton(primary)
                    .keyboardShortcut(.defaultAction)
                    .disabled(!primary.1 && !loading)
                    .fixedSize()
                    .accessibilityIdentifier(AXID.fastPrimary(screen))
                    .onChange(of: primary.1) { _, _ in pressed = false }
            }
        }
        .padding(insets)
        .onChange(of: primaryLoading) { _, now in if !now { pressed = false } }
        .task(id: pressedAt) {
            guard pressed else { return }
            try? await Task.sleep(for: .seconds(Self.pressHold))
            pressed = false
        }
    }

    private var loading: Bool { primaryLoading || pressed }

    @ViewBuilder private func secondaryButton(_ secondary: (String, () -> Void)) -> some View {
        if quietSecondary {
            FastButton(title: secondary.0, kind: .quiet, action: secondary.1).padding(.trailing, 8)
        } else {
            FastButton(title: secondary.0, kind: .secondary(), size: .large, shape: secondaryShape, action: secondary.1)
        }
    }

    private func primaryButton(_ primary: (String, Bool, () -> Void)) -> some View {
        FastButton(title: primary.0, kind: quietPrimary ? .secondary() : .primary(glow: primaryGlow), size: .large,
                   shape: primaryShape, isLoading: loading, loadingTitle: primaryLoadingTitle) {
            pressed = true
            pressedAt = Date()
            primary.2()
        }
    }
}
