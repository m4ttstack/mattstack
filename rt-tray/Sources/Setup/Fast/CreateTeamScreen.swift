import SwiftUI
import MattstackCore

/// P3c: the team's name, where its settings live, the group its repo goes
/// under, then rt's create section (Git tools, the forge token) as
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
    static let subtitle = "Sets up your org and its first team"
    static let footerNote = "Next: the same short form"

    private var onGitHub: Bool { forge.wrappedValue == "github" }

    /// The repo creating the team makes, spelled out as it is typed, so "group" never has to be explained.
    private var repoLine: String {
        let owner = group.wrappedValue.trimmingCharacters(in: CharacterSet(charactersIn: " /"))
        let host = onGitHub ? "github.com" : "gitlab.com"
        guard !owner.isEmpty else {
            return onGitHub ? "The organization or account your team's settings repo goes in"
                            : "The GitLab group your team's settings repo goes in"
        }
        let slug = Self.teamSlug(name.wrappedValue)
        return "Creates \(host)/\(owner)/mattstack-team-\(slug.isEmpty ? "<team>" : slug)"
    }

    /// Mirrors `slugify` in lib/team/slug.ts, which names the repo rt actually creates.
    static func teamSlug(_ name: String) -> String {
        let lowered = name.lowercased()
        var out = ""
        var lastDash = false
        for scalar in lowered.unicodeScalars {
            if ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar) {
                out.unicodeScalars.append(scalar); lastDash = false
            } else if !lastDash {
                out.append("-"); lastDash = true
            }
        }
        let trimmed = out.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return String(trimmed.prefix(40)).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }

    var body: some View {
        FastScreen(insets: EdgeInsets(top: 36, leading: 48, bottom: 20, trailing: 48), spacing: 16) {
            FastScreenHeader(title: "Create your team", subtitle: Self.subtitle, spacing: 16)
            FastStackedRow(label: "Team name") {
                FastField("Widgets", text: name, size: .large, id: AXID.fastCreateName, label: "Team name")
            }
            FastStackedRow(label: "Settings live on") { forgePicker }
            FastStackedRow(label: "Where the repo goes") {
                VStack(alignment: .leading, spacing: 6) {
                    FastField(onGitHub ? "acme" : "acme/platform", text: group, size: .large, monospaced: true, id: AXID.fastCreateGroup,
                              label: onGitHub ? "GitHub organization or account" : "GitLab group")
                    FastHint(repoLine)
                        .animation(.easeOut(duration: 0.15), value: repoLine)
                }
            }
            ForEach(rows ?? [], id: \.id) { row in
                FormRowView(row: labelled(row), waiting: waiting[row.id], error: errors[row.id], style: .stacked, onAction: onAction)
            }
            outcome
        } footer: {
            FastFooter(screen: FastSetupScreen.createTeam.rawValue, note: Self.footerNote,
                       secondary: isCreating ? nil : onBack.map { ("Back", $0) }, primary: ("Create team", createEnabled, onCreate), primaryLoading: isCreating, primaryLoadingTitle: "Creating…",
                       quietSecondary: true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.createTeam.rawValue))
    }

    /// P3c names the token field; rt's row title is the bare forge name.
    private func labelled(_ row: FormRow) -> FormRow {
        guard row.id == "forge.token" else { return row }
        var named = row
        named.title = onGitHub ? "GitHub token" : "GitLab token"
        return named
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
            FastFailureLine(text: failure)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AXID.fastCreateFailure)
        }
    }
}
