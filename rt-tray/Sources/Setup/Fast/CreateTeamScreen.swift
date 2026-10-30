import SwiftUI
import MattstackCore

/// P3c: the team's name, where its settings live, the group its repo goes
/// under, then rt's create section (Command Line Tools, the forge token) in
/// one card. Create team waits on `FastSetupFlow.createEnabled`.
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

    private var onGitHub: Bool { forge.wrappedValue == "github" }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 18) {
                FastScreenHeader(label: nil, title: "Create a team", subtitle: nil)
                VStack(alignment: .leading, spacing: 14) {
                    labeled("Team name") {
                        field("Team name", text: name, prompt: "Widgets", id: AXID.fastCreateName)
                    }
                    labeled("Where its settings live") {
                        Picker("Where its settings live", selection: forge) {
                            Text("GitLab").tag("gitlab")
                            Text("GitHub").tag("github")
                        }
                        .labelsHidden()
                        .pickerStyle(.segmented)
                        .fixedSize()
                        .accessibilityIdentifier(AXID.fastCreateForge)
                    }
                    labeled(onGitHub ? "Owner" : "Group",
                            hint: onGitHub ? "An organization or your own account" : "The team's repo goes in this group") {
                        field(onGitHub ? "Owner" : "Group", text: group, prompt: "acme", id: AXID.fastCreateGroup)
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
            FastFooter(screen: FastSetupScreen.createTeam.rawValue, note: nil,
                       secondary: isCreating ? nil : onBack.map { ("Back", $0) }, primary: ("Create team", createEnabled && !isCreating, onCreate))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.createTeam.rawValue))
    }

    private func labeled<Content: View>(_ label: String, hint: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.callout.weight(.medium))
            content()
            if let hint {
                Text(hint).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func field(_ label: String, text: Binding<String>, prompt: String, id: String) -> some View {
        TextField(label, text: text, prompt: Text(prompt))
            .labelsHidden()
            .textFieldStyle(.plain)
            .padding(.horizontal, 8).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color(nsColor: .separatorColor)))
            .frame(maxWidth: 320, alignment: .leading)
            .accessibilityIdentifier(id)
    }

    @ViewBuilder private var outcome: some View {
        if isCreating {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Creating your team…").font(.callout).foregroundStyle(.secondary)
            }
        } else if let failure {
            Label {
                Text(failure).fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "exclamationmark.circle.fill")
            }
            .font(.callout).foregroundStyle(.red)
            .accessibilityIdentifier(AXID.fastCreateFailure)
        }
    }
}
