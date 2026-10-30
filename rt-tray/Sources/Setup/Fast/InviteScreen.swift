import SwiftUI
import MattstackCore

/// P3: the invite code, the team it reads as, then rt's invite section (the
/// forge token, Command Line Tools) in one card. Join waits on
/// `FastSetupFlow.joinEnabled`.
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

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 18) {
                FastScreenHeader(label: nil, title: "Paste your invite", subtitle: nil)
                VStack(alignment: .leading, spacing: 8) {
                    codeField
                    verdict
                }
                if let rows, !rows.isEmpty {
                    FormCard(title: nil, rows: rows, waiting: waiting, errors: errors, onAction: onAction)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            Spacer(minLength: 0)
            FastFooter(screen: FastSetupScreen.invite.rawValue, note: nil,
                       secondary: onBack.map { ("Back", $0) }, primary: ("Join", joinEnabled, onJoin))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.invite.rawValue))
    }

    private var codeField: some View {
        HStack(alignment: .top, spacing: 8) {
            // .roundedBorder never wraps on macOS, and a whole code must stay readable.
            TextField("Invite code", text: code, prompt: Text("Invite code or link"), axis: .vertical)
                .labelsHidden()
                .textFieldStyle(.plain)
                .lineLimit(1...3)
                .font(.system(.body, design: .monospaced))
                .padding(.horizontal, 8).padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color(nsColor: .separatorColor)))
                .accessibilityIdentifier(AXID.fastInviteCode)
            Button("Paste", action: onPaste).fixedSize()
                .accessibilityIdentifier(AXID.fastInvitePaste)
        }
    }

    @ViewBuilder private var verdict: some View {
        if isChecking {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Reading your invite…").font(.callout).foregroundStyle(.secondary)
            }
        } else if let failure {
            Label {
                Text(failure).fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "exclamationmark.circle.fill")
            }
            .font(.callout).foregroundStyle(.red)
            .accessibilityIdentifier(AXID.fastInviteFailure)
        } else if let inviteLine {
            Label {
                Text(inviteLine).foregroundStyle(.primary)
            } icon: {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            }
            .font(.callout)
            .accessibilityIdentifier(AXID.fastInviteLine)
        }
    }
}
