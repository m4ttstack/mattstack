import SwiftUI
import MattstackCore

/// What the section draws, apart from what its controls do.
struct SupportSectionState {
    var view: SupportHostView
    var shownHost: String?
    var busy: SupportSettingsModel.Busy?
    var orgError: String?
    var hostError: String?
}

struct SupportSectionActions {
    var pickHost: (String) -> Void = { _ in }
    var setEnabled: (Bool) -> Void = { _ in }
    var setAccepting: (Bool) -> Void = { _ in }
    var chooseRepo: (String) -> Void = { _ in }
    var makeKey: () -> Void = {}
    var openAccounts: () -> Void = {}
    var openChatName: () -> Void = {}
    var showWaiting: () -> Void = {}
}

/// The org's switch for its admins, and this Mac's for the person who answers.
struct SupportSection: View {
    let state: SupportSectionState
    let actions: SupportSectionActions

    private var view: SupportHostView { state.view }
    private var hostName: String? { view.person(state.shownHost)?.shownName ?? state.shownHost }
    private var hostFirstName: String { hostName?.split(separator: " ").first.map(String.init) ?? "" }

    var body: some View {
        Section("Support") {
            if let org = view.org { orgRows(org) }
            if view.showsHostRows { hostRows }
        }
    }

    // MARK: - The org's admin

    @ViewBuilder private func orgRows(_ org: SupportOrg) -> some View {
        LabeledContent("Who answers") {
            Picker("Who answers", selection: Binding(get: { state.shownHost ?? "" }, set: actions.pickHost)) {
                if state.shownHost == nil { Text("Choose…").tag("") }
                ForEach(org.people, id: \.username) { Text($0.shownName).tag($0.username) }
            }
            .labelsHidden()
            .disabled(state.busy != nil)
            .accessibilityIdentifier(AXID.settingsSupportHost)
        }
        SupportSwitch(
            title: "Let people ask for help",
            detail: orgDetail(org),
            isError: state.orgError != nil,
            isOn: view.enabled,
            isBusy: state.busy == .turningOn || state.busy == .turningOff,
            isEnabled: state.busy == nil && (view.enabled || state.shownHost != nil),
            set: actions.setEnabled
        )
        .accessibilityIdentifier(AXID.settingsSupportEnabled)
        if view.enabled, !org.hasKey {
            if state.busy == .makingKey {
                SupportRow(symbol: "key", tint: .secondary, title: "Support key", detail: "Making the org's support key") {
                    ProgressView().controlSize(.small)
                }
            } else {
                SupportRow(symbol: "exclamationmark.triangle", tint: .orange, title: "Support key", detail: "Your org has support on but no key") {
                    Button("Fix", action: actions.makeKey)
                        .buttonStyle(.borderedProminent)
                        .disabled(state.busy != nil || state.shownHost == nil)
                        .accessibilityIdentifier(AXID.settingsSupportKey)
                }
            }
        }
        if view.enabled, org.hasKey, state.shownHost != nil {
            if org.answering == true {
                SupportRow(symbol: "checkmark.circle", tint: .green, title: "\(hostFirstName)'s Mac") { answer("Answering") }
            } else if org.answering == false {
                SupportRow(symbol: "clock", tint: .orange, title: "\(hostFirstName)'s Mac",
                           detail: "\(hostFirstName) turns it on in Settings > Team") { answer("Not answering yet") }
            }
        }
    }

    private func answer(_ text: String) -> some View { Text(text).foregroundStyle(.secondary) }

    private func orgDetail(_ org: SupportOrg) -> String {
        if let e = state.orgError { return e }
        if state.busy == .turningOn, !org.hasKey { return "Making the org's support key" }
        if !view.enabled, state.shownHost == nil { return "Pick who answers first" }
        return "Adds Need help? to everyone's board and app"
    }

    // MARK: - The person who answers

    @ViewBuilder private var hostRows: some View {
        SupportSwitch(
            title: "Answer help requests on this Mac",
            detail: hostDetail,
            isError: state.hostError != nil,
            isOn: view.accepting,
            isBusy: state.busy == .accepting,
            isEnabled: state.busy == nil && (view.accepting || (view.needs.isEmpty && !view.otherMac)),
            set: actions.setAccepting
        )
        .accessibilityIdentifier(AXID.settingsSupportAccept)
        if !view.otherMac {
            ForEach(view.needs) { need in
                SupportRow(symbol: "exclamationmark.triangle", tint: .orange, title: need.label,
                           detail: need.command.map { "Run \($0)" }) { fix(need) }
            }
        }
        if view.accepting {
            LabeledContent("Open now") { Text("\(view.open) of \(view.cap)") }
            if view.waiting > 0 {
                LabeledContent("Waiting for you") {
                    Button("Show \(view.waiting)", action: actions.showWaiting)
                        .accessibilityIdentifier(AXID.settingsSupportWaiting)
                }
            }
        }
    }

    private var hostDetail: String {
        if let e = state.hostError { return e }
        if view.otherMac { return "Turn it off on your other Mac first" }
        if !view.accepting, !view.needs.isEmpty { return "Finish these first" }
        return "\(view.persona) opens Slack chats with your teammates"
    }

    @ViewBuilder private func fix(_ need: SupportNeed) -> some View {
        switch need.fix {
        case "accounts": Button("Open Accounts", action: actions.openAccounts)
        case "chat-name": Button("Set…", action: actions.openChatName)
        case "repo":
            if !view.repos.isEmpty {
                Menu("Choose…") {
                    ForEach(view.repos, id: \.self) { repo in Button(repo) { actions.chooseRepo(repo) } }
                }
                .menuIndicator(.hidden)
                .fixedSize()
                .disabled(state.busy != nil)
                .accessibilityIdentifier(AXID.settingsSupportRepo)
            }
        default: EmptyView()
        }
    }
}

/// A switch with a line under its title, greyed whole when it cannot be used.
private struct SupportSwitch: View {
    let title: String
    let detail: String
    let isError: Bool
    let isOn: Bool
    let isBusy: Bool
    let isEnabled: Bool
    let set: (Bool) -> Void

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(isEnabled || isBusy ? .primary : .secondary)
                Text(detail).font(.subheadline).foregroundStyle(isError ? Color.red : Color.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if isBusy { ProgressView().controlSize(.small) }
            Toggle(title, isOn: Binding(get: { isOn }, set: set))
                .labelsHidden()
                .toggleStyle(.switch).controlSize(.mini)
                .disabled(!isEnabled)
                .accessibilityHint(detail)
        }
    }
}

private struct SupportRow<Trailing: View>: View {
    let symbol: String
    let tint: Color
    let title: String
    var detail: String? = nil
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).foregroundStyle(tint).frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let detail { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 8)
            trailing()
        }
    }
}
