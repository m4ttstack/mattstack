import SwiftUI
import MattstackCore

/// P3: the invite code, the team it reads as, then rt's invite section (the
/// forge token, Git tools) in one card. Join sits in the footer, where every
/// screen's next step is, and waits on `FastSetupFlow.joinEnabled`.
struct InviteScreenBody: View {
    let code: Binding<String>
    let inviteLine: String?
    let failure: String?
    let isChecking: Bool
    /// nil until rt's invite section arrives.
    let rows: [FormRow]?
    let waiting: [String: String]
    let errors: [String: String]
    let joinEnabled: Bool
    var isJoining = false
    let onPaste: () -> Void
    let onAction: FormRowPerform
    let onBack: (() -> Void)?
    let onJoin: () -> Void

    /// rt sends none of these lines, so the screen carries P3's own copy.
    static let subtitle = "Your team admin sent it as a link or a code"
    static let linkNote = "Opened mattstack from the invite link? It's already filled in"

    var body: some View {
        FastScreen(insets: EdgeInsets(top: 40, leading: 48, bottom: 40, trailing: 48), spacing: 16) {
            FastScreenHeader(title: "Paste your invite", subtitle: Self.subtitle, spacing: 16)
            InviteCodeField(code: code, onPaste: onPaste)
                .padding(.top, 8)
            Group {
                verdict.transition(.opacity)
                if let rows, !rows.isEmpty {
                    FormCard(title: nil, rows: rows, waiting: waiting, errors: errors, style: .labelled, onAction: onAction)
                        .environment(\.fastLinkIcon, true)
                        .transition(.opacity.combined(with: .offset(y: -6)))
                }
            }
            .animation(.spring(response: 0.38, dampingFraction: 0.9), value: [String(isChecking), failure ?? "", inviteLine ?? "", String(rows?.count ?? 0)])
            HStack(spacing: 6) {
                // SF's link at 12 fills the CSS's 13 box as Lucide's does.
                Image(systemName: "link").font(.system(size: 12, weight: .light)).frame(width: 13, height: 13)
                Text(Self.linkNote).font(.system(size: 12)).fixedSize(horizontal: false, vertical: true)
            }
            .foregroundColor(FastTheme.textTertiary)
        } footer: {
            FastFooter(screen: FastSetupScreen.invite.rawValue, note: nil,
                       secondary: onBack.map { ("Back", $0) }, primary: ("Join", joinEnabled, onJoin), primaryLoading: isJoining, primaryLoadingTitle: "Joining…",
                       insets: ConnectScreenBody.footerInsets, quietSecondary: true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.invite.rawValue))
    }

    @ViewBuilder private var verdict: some View {
        if isChecking {
            HStack(spacing: 6) {
                FastSpinner()
                Text("Reading your invite…").font(.system(size: 12)).foregroundColor(FastTheme.textSecondary)
            }
        } else if let failure {
            FastFailureLine(text: failure)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AXID.fastInviteFailure)
        } else if let inviteLine {
            FastDoneLine(inviteLine, size: 12, iconSize: 15)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AXID.fastInviteLine)
        }
    }
}

/// P3's code field: the large mono field, its edge in accent once a code is in.
/// It wraps rather than scrolls, as a whole code must stay readable. While it
/// is empty, Paste sits inside its trailing edge and reads a link or a code
/// off the clipboard.
private struct InviteCodeField: View {
    let code: Binding<String>
    let onPaste: () -> Void
    @FocusState private var focused: Bool

    private let size = FastField.Size.invite

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size.radius, style: .continuous)
        let empty = code.wrappedValue.isEmpty
        HStack(alignment: .top, spacing: 8) {
            field
            if empty {
                // Laid out at the text's line height, so the field keeps the mock's height while Paste draws its full size.
                Button("Paste", action: onPaste)
                    .buttonStyle(FastSecondaryButtonStyle(shape: FastButtonShape(vertical: 5, horizontal: 10, radius: 7)))
                    .fixedSize()
                    .frame(height: size.monoLine)
                    .accessibilityIdentifier(AXID.fastInvitePaste)
            }
        }
        .padding(.vertical, size.vertical).padding(.leading, size.horizontal)
        .padding(.trailing, empty ? 8 : size.horizontal)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(shape.fill(FastTheme.fieldFill))
        .overlay(shape.strokeBorder(focused || !empty ? FastTheme.accent : FastTheme.outline, lineWidth: 1))
    }

    private var field: some View {
        ZStack(alignment: .topLeading) {
            if code.wrappedValue.isEmpty {
                Text("Invite code or link").font(.system(size: size.points)).foregroundColor(FastTheme.textTertiary)
                    .lineLimit(1).allowsHitTesting(false)
            }
            TextField("", text: code, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...3)
                .font(.system(size: size.points, weight: .light, design: .monospaced))
                .foregroundColor(FastTheme.textPrimary)
                .focused($focused)
                .accessibilityLabel("Invite code")
                .accessibilityIdentifier(AXID.fastInviteCode)
        }
        .frame(minHeight: size.monoLine, alignment: .topLeading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
