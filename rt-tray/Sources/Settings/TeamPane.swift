import SwiftUI
import MattstackCore

struct TeamPane: View {
    let env: SettingsEnvironment
    @ObservedObject private var model: TeamSettingsModel
    init(env: SettingsEnvironment) { self.env = env; self.model = env.team }

    var body: some View {
        TeamPaneForm(
            info: model.info,
            invite: model.invite,
            error: model.error,
            maskedRemote: model.maskedRemote,
            onCreateTeam: env.onCreateTeam,
            onJoin: env.onJoinAnotherTeam,
            onUseTeam: { team in Task { await model.useTeam(team) } },
            onInvite: { handle, team in Task { await model.mintInvite(handle: handle, team: team) } },
            isSwitchingTeam: model.isSwitchingTeam,
            packNotice: model.packNotice
        )
        .task { await model.load() }
    }
}

/// The pane as a function of what rt reported. It holds no model, so a
/// snapshot can draw it from fixtures.
struct TeamPaneForm: View {
    let info: TeamSettingsInfo?
    let invite: InviteResult?
    let error: String?
    let maskedRemote: String
    let onCreateTeam: () -> Void
    let onJoin: () -> Void
    let onUseTeam: (String) -> Void
    let onInvite: (_ handle: String, _ team: String?) -> Void
    var isSwitchingTeam = false
    var packNotice: String? = nil

    @State private var handle = ""
    @State private var inviteTeam = ""

    private var isAdmin: Bool { info?.isAdmin ?? true }
    private var teamChoices: [String] { info?.inviteTeamChoices ?? [] }
    private var trimmedHandle: String { handle.trimmingCharacters(in: .whitespaces) }
    /// The team an invite is for: the picked one, else your own. Nil sends no --teams, and rt uses your active team.
    private var inviteTarget: String? {
        if teamChoices.isEmpty { return nil }
        return inviteTeam.isEmpty ? info?.activeTeam : inviteTeam
    }

    var body: some View {
        Form {
            if info?.mode == "solo" {
                Section("Team") {
                    Text("You're set up as Just me: no team repo, no forge account.")
                    HStack {
                        Button("Create a team…", action: onCreateTeam).accessibilityIdentifier(AXID.settingsTeamCreate)
                        Button("Join a team…", action: onJoin).accessibilityIdentifier(AXID.settingsTeamJoinAnother)
                    }
                }
            } else {
                Section("Org") {
                    LabeledContent("Name") { Text(info?.orgIdentity ?? "...") }
                    LabeledContent("Your team") { yourTeam }
                    LabeledContent("Remote") {
                        HStack { Text(maskedRemote).textSelection(.enabled)
                            // Copies the masked form, never `info?.remote`,
                            // since an HTTPS remote can carry a token in its userinfo.
                            Button { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(maskedRemote, forType: .string) } label: { Image(systemName: "doc.on.doc") }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("Copy remote")
                                .accessibilityIdentifier(AXID.settingsTeamCopyRemote) }
                    }
                    LabeledContent("Backup") { Text(info?.lastPush.map { "last push \($0)" } ?? "no push recorded") }
                    if isSwitchingTeam {
                        ProgressView("Switching your team…")
                            .controlSize(.small)
                            .accessibilityLabel("Switching your team")
                    }
                }
                Section(info?.activeTeam.map { "Members of \($0)" } ?? "Members") {
                    if let m = info?.members, !m.isEmpty { ForEach(m, id: \.username) { Text($0.username) } }
                    else { Text("Not visible with the current token.").foregroundStyle(.secondary) }
                }
                if isAdmin { inviteSection }
                Section {
                    Button("Rejoin this org…", action: onJoin).accessibilityIdentifier(AXID.settingsTeamJoinAnother)
                    Text("Use a new invite from your org admin. This Mac holds one org.").font(.caption).foregroundStyle(.secondary)
                }
            }
            if let notice = packNotice {
                Section {
                    Label { Text(notice) } icon: { Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange) }
                    LabeledContent("Next") {
                        Text("rt setup pack").font(.system(.body, design: .monospaced)).textSelection(.enabled)
                    }
                }
            }
            if let e = error { Text(e).font(.caption).foregroundStyle(.red) }
        }
        .formStyle(.grouped)
        // `initial: true` because status is often loaded before this pane
        // appears (the Apps pane loads it first), and a plain onChange would
        // never fire for a value that does not change again.
        .onChange(of: info?.activeTeam, initial: true) { _, team in
            if inviteTeam.isEmpty, let team { inviteTeam = team }
        }
    }

    @ViewBuilder private var yourTeam: some View {
        if info?.canSwitchTeam == true {
            Picker("Your team", selection: Binding(get: { info?.activeTeam ?? "" }, set: onUseTeam)) {
                ForEach(info?.myTeams ?? [], id: \.self) { Text($0).tag($0) }
            }
            .labelsHidden()
            .disabled(isSwitchingTeam)
            .accessibilityHint(isSwitchingTeam ? "Wait for your team to finish switching." : "Choose one of your teams.")
            .accessibilityIdentifier(AXID.settingsTeamYourTeam)
        } else {
            Text(info?.activeTeam ?? "None yet").accessibilityIdentifier(AXID.settingsTeamYourTeam)
        }
    }

    private var inviteSection: some View {
        Section("Invite") {
            if !teamChoices.isEmpty {
                Picker("Team", selection: $inviteTeam) {
                    ForEach(teamChoices, id: \.self) { Text($0).tag($0) }
                }
                .accessibilityIdentifier(AXID.settingsTeamInviteTeam)
            }
            HStack {
                TextField("Forge handle", text: $handle, prompt: Text("teammate's GitHub/GitLab handle")).accessibilityIdentifier(AXID.settingsTeamInviteHandle)
                Button("Invite…") { onInvite(trimmedHandle, inviteTarget) }
                    .disabled(trimmedHandle.isEmpty || (!teamChoices.isEmpty && (inviteTarget ?? "").isEmpty))
                    .accessibilityIdentifier(AXID.settingsTeamInvite)
            }
            if let inv = invite { inviteResult(inv) }
        }
    }

    private func inviteResult(_ inv: InviteResult) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let link = inv.link {
                HStack {
                    Button("Copy invite link") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(link, forType: .string) }
                        .accessibilityIdentifier(AXID.settingsTeamCopyLink)
                    Button("Share…") { share(link) }
                        .accessibilityIdentifier(AXID.settingsTeamShareInvite)
                }
                Text(link).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
            }
            Text(inv.pasteBlock).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
            HStack {
                Button("Copy paste block") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(inv.pasteBlock, forType: .string) }
                    .accessibilityIdentifier(AXID.settingsTeamCopyPaste)
                Text("expires \(inv.expiresAt) · forge access: \(inv.forgeAccess)").font(.caption).foregroundStyle(.secondary)
            }
            if let steps = inv.manualSteps, !steps.isEmpty { ForEach(steps, id: \.self) { Text("• \($0)").font(.caption) } }
            if let warning = inv.peeringWarning {
                Label { Text(warning) } icon: { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
                    .font(.caption)
                    .accessibilityIdentifier(AXID.settingsTeamInvitePeeringWarning)
            }
        }
    }

    /// The picker is how the link reaches Messages, Mail or AirDrop without rt
    /// ever handling a recipient.
    private func share(_ link: String) {
        guard let view = NSApp.keyWindow?.contentView else { return }
        NSSharingServicePicker(items: [link]).show(relativeTo: .zero, of: view, preferredEdge: .minY)
    }
}
