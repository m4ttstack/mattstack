import SwiftUI
import MattstackCore

/// P3r: the backup repo and its recovery key, then rt's restore section
/// (Command Line Tools, which the clone needs) as more label-above fields.
/// Restore waits on `FastSetupFlow.restoreEnabled`.
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

    /// rt sends none of these lines, so the screen carries P3r's own copy.
    static let subtitle = "Your settings, repos list and team come back from your backup"
    static let footerNote = "Then straight to the progress bar"
    /// Every age key starts with this prefix, so the masked field may show it.
    static let keyPlaceholder = "AGE-SECRET-KEY-1…"

    var body: some View {
        FastScreen(insets: EdgeInsets(top: 36, leading: 48, bottom: 20, trailing: 48), spacing: 16) {
            FastTheme.heading("Move from another Mac").fixedSize(horizontal: false, vertical: true)
            FastTheme.sub(Self.subtitle).fixedSize(horizontal: false, vertical: true)
            FastStackedRow(label: "Backup repo") {
                FastField("janedoe/mattstack-home", text: repo, size: .large, monospaced: true, id: AXID.fastRestoreRepo,
                          label: "Backup repo")
            }
            FastStackedRow(label: "Recovery key") {
                // The key is a secret: a secure field, so it is never drawn or read back.
                FastField(Self.keyPlaceholder, text: key, size: .large, monospaced: true, secure: true,
                          maskPrefix: FastField.prefix(fromHint: Self.keyPlaceholder), id: AXID.fastRestoreKey, label: "Recovery key")
            }
            keyHint
            ForEach(rows ?? [], id: \.id) { row in
                FormRowView(row: row, waiting: waiting[row.id], error: errors[row.id], style: .stacked, onAction: onAction)
            }
            outcome
        } footer: {
            FastFooter(screen: FastSetupScreen.restore.rawValue, note: Self.footerNote,
                       secondary: isRestoring ? nil : onBack.map { ("Back", $0) }, primary: ("Restore", restoreEnabled && !isRestoring, onRestore),
                       quietSecondary: true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.restore.rawValue))
    }

    private var keyHint: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "info.circle").font(.system(size: 13, weight: .light))
            (Text("On your old Mac run ") + Text("rt home key export").font(.system(size: 12, weight: .light, design: .monospaced))
                + Text(", or find it in your password manager"))
                .font(.system(size: 12))
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundColor(FastTheme.textTertiary)
    }

    @ViewBuilder private var outcome: some View {
        if isRestoring {
            HStack(spacing: 6) {
                FastSpinner()
                Text("Restoring your settings…").font(.system(size: 12)).foregroundColor(FastTheme.textSecondary)
            }
        } else if let failure {
            FastHint(failure, size: 12, symbol: "exclamationmark.circle", tint: FastTheme.warning)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AXID.fastRestoreFailure)
        }
    }
}
