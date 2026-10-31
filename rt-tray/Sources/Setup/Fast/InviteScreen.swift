import SwiftUI
import MattstackCore

/// P3: the invite code with Join beside it, the team it reads as, then rt's
/// invite section (the forge token, Command Line Tools) in one card. Join
/// waits on `FastSetupFlow.joinEnabled`.
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
    let onPaste: () -> Void
    let onAction: FormRowPerform
    let onBack: (() -> Void)?
    let onJoin: () -> Void

    /// rt sends none of these lines, so the screen carries P3's own copy.
    static let subtitle = "Your team admin sent it as a link or a code"
    static let linkNote = "Opened mattstack from the invite link? It's already filled in"

    var body: some View {
        FastScreen(insets: EdgeInsets(top: 40, leading: 48, bottom: onBack == nil ? 40 : 20, trailing: 48), spacing: 16) {
            FastTheme.heading("Paste your invite").fixedSize(horizontal: false, vertical: true)
            FastTheme.sub(Self.subtitle).fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .top, spacing: 10) {
                InviteCodeField(code: code, onPaste: onPaste)
                Button("Join", action: onJoin)
                    .buttonStyle(FastPrimaryButtonStyle(shape: FastButtonShape(vertical: 12, horizontal: 22, radius: 11)))
                    .keyboardShortcut(.defaultAction)
                    .disabled(!joinEnabled)
                    .fixedSize()
                    .accessibilityIdentifier(AXID.fastPrimary(FastSetupScreen.invite.rawValue))
            }
            .padding(.top, 8)
            verdict
            if let rows, !rows.isEmpty {
                FormCard(title: nil, rows: rows, waiting: waiting, errors: errors, style: .labelled, onAction: onAction)
                    .environment(\.fastLinkIcon, true)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "link").font(.system(size: 12, weight: .light))
                Text(Self.linkNote).font(.system(size: 12)).fixedSize(horizontal: false, vertical: true)
            }
            .foregroundColor(FastTheme.textTertiary)
        } footer: {
            if let onBack {
                HStack {
                    Button("Back", action: onBack)
                        .buttonStyle(FastSecondaryButtonStyle(size: .large))
                        .fixedSize()
                        .accessibilityIdentifier(AXID.fastSecondary(FastSetupScreen.invite.rawValue))
                    Spacer(minLength: 0)
                }
                .padding(FastTheme.footerInsets)
            }
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
            FastHint(failure, size: 12, symbol: "exclamationmark.circle", tint: FastTheme.warning)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AXID.fastInviteFailure)
        } else if let inviteLine {
            FastDoneLine(inviteLine, size: 12, iconSize: 13)
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
        ZStack(alignment: .topLeading) {
            if empty {
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
        .padding(.vertical, size.vertical).padding(.leading, size.horizontal)
        .padding(.trailing, empty ? 72 : size.horizontal)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(shape.fill(FastTheme.fieldFill))
        .overlay(shape.strokeBorder(focused || !empty ? FastTheme.accent : FastTheme.outline, lineWidth: 1))
        .overlay(alignment: .trailing) {
            if empty {
                Button("Paste", action: onPaste)
                    .buttonStyle(FastSecondaryButtonStyle(shape: FastButtonShape(vertical: 5, horizontal: 10, radius: 7)))
                    .fixedSize()
                    .padding(.trailing, 8)
                    .accessibilityIdentifier(AXID.fastInvitePaste)
            }
        }
    }
}
