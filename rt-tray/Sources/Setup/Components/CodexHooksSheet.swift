import SwiftUI
import MattstackCore

/// The Codex hooks row's review: rt's own payload, shown as the terminal
/// review shows it. Approve runs the approval's argv, and rt asks macOS for
/// Touch ID or the password itself; `onApprove` returns nil or rt's refusal,
/// which stays in the sheet.
struct CodexHooksSheet: View {
    let title: String
    let subtitle: String?
    let footnote: String?
    let approval: CodexHookApproval
    let onApprove: ([String]) async -> String?

    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    init?(row: PlanRow, onApprove: @escaping ([String]) async -> String?) {
        guard let action = row.action, let approval = CodexHookApproval(action: action) else { return nil }
        self.title = row.title
        self.subtitle = action.subtitle
        self.footnote = action.footnote
        self.approval = approval
        self.onApprove = onApprove
    }

    private var review: CodexHookReview { approval.review }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.padding(24)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 8) {
                        field("Codex home", review.codexHome)
                        field("Hooks file", review.hooksPath)
                        field("Trust written to", review.configPath)
                        field("Hook program", review.executable)
                        field("Program sha256", review.digest)
                    }
                    Text("Hooks Codex will trust, with the hashes Codex reported")
                        .font(.subheadline.weight(.semibold))
                        .padding(.top, 4)
                    ForEach(review.hooks, id: \.key) { hookCard($0) }
                }
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 420)
            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 24).padding(.vertical, 12)
                    .accessibilityIdentifier(AXID.codexHooksError)
            }
            Divider()
            footer.padding(.horizontal, 24).padding(.vertical, 16)
        }
        .frame(width: 640)
        .background(Color(nsColor: .windowBackgroundColor))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.codexHooksSheet)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "lock.shield")
                .font(.system(size: 28))
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.title2.bold())
                if let subtitle {
                    Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func field(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).font(.callout).foregroundStyle(.secondary)
                .frame(width: 130, alignment: .leading)
            Text(value).font(.system(.callout, design: .monospaced))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func hookCard(_ hook: CodexHookReview.Hook) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(hook.event).font(.headline)
            Group {
                Text(hook.key)
                Text(hook.hash)
                Text(hook.command)
            }
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
    }

    private var footer: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            if let footnote {
                Text(footnote).font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 12)
            Button("Cancel") { dismiss() }
                .keyboardShortcut(.cancelAction)
                .disabled(busy)
                .accessibilityIdentifier(AXID.codexHooksCancel)
            Button(busy ? "Waiting for macOS…" : "Approve…") { approve() }
                .buttonStyle(.borderedProminent)
                .disabled(busy)
                .accessibilityIdentifier(AXID.codexHooksApprove)
        }
    }

    private func approve() {
        guard !busy else { return }
        busy = true
        error = nil
        let args = approval.args
        Task { @MainActor in
            let failure = await onApprove(args)
            busy = false
            if let failure { error = failure } else { dismiss() }
        }
    }
}
