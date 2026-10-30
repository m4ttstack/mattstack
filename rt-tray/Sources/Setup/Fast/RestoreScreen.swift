import SwiftUI
import MattstackCore

/// P3r: the backup repo and its recovery key, then rt's restore section
/// (Command Line Tools, which the clone needs) in one card. Restore waits on
/// `FastSetupFlow.restoreEnabled`.
struct RestoreScreenBody: View {
    let repo: Binding<String>
    let key: Binding<String>
    /// nil until rt's restore section arrives.
    let rows: [FormRow]?
    let waiting: [String: String]
    let errors: [String: String]
    let isRestoring: Bool
    let failure: String?
    let restoreEnabled: Bool
    let onAction: FormRowPerform
    let onBack: (() -> Void)?
    let onRestore: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 18) {
                FastScreenHeader(label: nil, title: "Move from another Mac", subtitle: nil)
                VStack(alignment: .leading, spacing: 14) {
                    labeled("Backup repo") {
                        boxed(TextField("Backup repo", text: repo, prompt: Text("janedoe/mattstack-home")))
                            .accessibilityIdentifier(AXID.fastRestoreRepo)
                    }
                    labeled("Recovery key", hint: Text("On your old Mac run ") + Text("rt home key export").font(.caption.monospaced())
                            + Text(", or find it in your password manager")) {
                        // The key is a secret: never a plain TextField, so it is never drawn or read back.
                        boxed(SecureField("Recovery key", text: key, prompt: Text("Recovery key")))
                            .accessibilityIdentifier(AXID.fastRestoreKey)
                    }
                }
                if let rows, !rows.isEmpty {
                    FormCard(title: nil, rows: rows, waiting: waiting, errors: errors, onAction: onAction)
                }
                outcome
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            Spacer(minLength: 0)
            FastFooter(screen: FastSetupScreen.restore.rawValue, note: nil,
                       secondary: isRestoring ? nil : onBack.map { ("Back", $0) }, primary: ("Restore", restoreEnabled && !isRestoring, onRestore))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.restore.rawValue))
    }

    private func labeled<Content: View>(_ label: String, hint: Text? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.callout.weight(.medium))
            content()
            if let hint {
                hint.font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func boxed<Field: View>(_ field: Field) -> some View {
        field
            .labelsHidden()
            .textFieldStyle(.plain)
            .padding(.horizontal, 8).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color(nsColor: .separatorColor)))
            .frame(maxWidth: 320, alignment: .leading)
    }

    @ViewBuilder private var outcome: some View {
        if isRestoring {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Restoring your settings…").font(.callout).foregroundStyle(.secondary)
            }
        } else if let failure {
            Label {
                Text(failure).fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "exclamationmark.circle.fill")
            }
            .font(.callout).foregroundStyle(.red)
            .accessibilityIdentifier(AXID.fastRestoreFailure)
        }
    }
}
