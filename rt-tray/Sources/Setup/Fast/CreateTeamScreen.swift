import SwiftUI
import MattstackCore

/// P3c: the team's name, where its settings live, the group its repo goes
/// under, then rt's create section (Command Line Tools, the forge token) as
/// more label-above fields. Create team waits on `FastSetupFlow.createEnabled`.
struct CreateTeamScreenBody: View {
    let name: Binding<String>
    /// "gitlab" or "github".
    let forge: Binding<String>
    let group: Binding<String>
    /// nil until rt's create section arrives.
    let rows: [FormRow]?
    let waiting: [String: String]
    let errors: [String: String]
    let isCreating: Bool
    let failure: String?
    let createEnabled: Bool
    let onAction: FormRowPerform
    let onBack: (() -> Void)?
    let onCreate: () -> Void

    /// rt sends none of these lines, so the screen carries P3c's own copy.
    static let subtitle = "No waiting. You're its admin"
    static let footerNote = "Next: the same short form"

    private var onGitHub: Bool { forge.wrappedValue == "github" }

    var body: some View {
        FastScreen(insets: EdgeInsets(top: 36, leading: 48, bottom: 20, trailing: 48), spacing: 16) {
            FastTheme.heading("Create your team").fixedSize(horizontal: false, vertical: true)
            FastTheme.sub(Self.subtitle).fixedSize(horizontal: false, vertical: true)
            FastStackedRow(label: "Team name") {
                FastField("Widgets", text: name, size: .large, id: AXID.fastCreateName, label: "Team name")
            }
            FastStackedRow(label: "Settings live on") { forgePicker }
            FastStackedRow(label: onGitHub ? "Owner" : "Group") {
                FastField("acme", text: group, size: .large, monospaced: true, id: AXID.fastCreateGroup,
                          label: onGitHub ? "Owner" : "Group")
                    .help(onGitHub ? "An organization or your own account" : "The team's repo goes in this group")
            }
            ForEach(rows ?? [], id: \.id) { row in
                FormRowView(row: row, waiting: waiting[row.id], error: errors[row.id], style: .stacked, onAction: onAction)
            }
            outcome
        } footer: {
            FastFooter(screen: FastSetupScreen.createTeam.rawValue, note: Self.footerNote,
                       secondary: isCreating ? nil : onBack.map { ("Back", $0) }, primary: ("Create team", createEnabled && !isCreating, onCreate))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.createTeam.rawValue))
    }

    private var forgePicker: some View {
        let options = [(id: "gitlab", label: "GitLab"), (id: "github", label: "GitHub")]
        return FastSegmented(options: options, selection: forge)
            // Scripts pick the forge by a radio group's role, which the drawn buttons do not have.
            .accessibilityRepresentation {
                Picker("Settings live on", selection: forge) {
                    ForEach(options, id: \.id) { Text($0.label).tag($0.id) }
                }
                .pickerStyle(.segmented)
            }
            .accessibilityIdentifier(AXID.fastCreateForge)
    }

    @ViewBuilder private var outcome: some View {
        if isCreating {
            HStack(spacing: 6) {
                FastSpinner()
                Text("Creating your team…").font(.system(size: 12)).foregroundColor(FastTheme.textSecondary)
            }
        } else if let failure {
            FastHint(failure, size: 12, symbol: "exclamationmark.circle", tint: FastTheme.warning)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AXID.fastCreateFailure)
        }
    }
}
