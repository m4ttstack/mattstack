import SwiftUI
import MattstackCore

/// What only the coordinator can do: run rt's verbs for a screen's primary
/// button, start or retry the bar, and close the window.
struct FastSetupHandlers {
    var choose: (TeamChoice) -> Void
    var join: () -> Void
    var create: () -> Void
    var restore: () -> Void
    /// Set up this Mac.
    var start: () -> Void
    var hide: () -> Void
    var retry: () -> Void
    var pausedAction: (RowAction) -> Void
    var openHome: () -> Void
    var readAgain: () -> Void

    static let inert = FastSetupHandlers(choose: { _ in }, join: {}, create: {}, restore: {}, start: {}, hide: {}, retry: {},
                                         pausedAction: { _ in }, openHome: {}, readAgain: {})
}

/// The coordinator's state for the screens that run a verb of their own.
@MainActor
final class FastSetupStatus: ObservableObject {
    /// When the run on the bar began: rt's record after a relaunch, now for a new run or a Retry.
    @Published var runStartedAt = Date()
    /// The screen whose primary button is running its verb.
    @Published var busy: FastSetupScreen?
    @Published var failures: [FastSetupScreen: String] = [:]
}

/// Fast setup's one window: draws the screen `FastSetupFlow` is on from rt's
/// form, and moves the flow for the steps between two whole reads.
struct FastSetupView: View {
    @ObservedObject var flow: FastSetupFlow
    @ObservedObject var form: SetupFormModel
    @ObservedObject var actions: FormActionRunner
    @ObservedObject var install: InstallRunModel
    @ObservedObject var team: TeamChoiceModel
    @ObservedObject var status: FastSetupStatus
    let handlers: FastSetupHandlers

    var body: some View {
        screen
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .frame(minWidth: SetupWindowController.width, minHeight: SetupWindowController.minHeight)
            .controlSize(.large)
    }

    private var back: (() -> Void)? { flow.canGoBack ? { flow.back() } : nil }
    private var latest: SetupForm? { form.form }

    private func perform(_ row: FormRow, _ values: [String: String]?, _ alternative: String?) {
        Task { await actions.perform(row, values: values, alternative: alternative) }
    }

    @ViewBuilder private var screen: some View {
        switch flow.screen {
        case .loading:
            FastLoadingBody(error: form.isLoading ? nil : form.error, onRetry: handlers.readAgain)
        case .macos:
            MacOSScreenBody(rows: form.rows(for: "macos") ?? [], waiting: actions.waiting, errors: actions.errors, onAction: perform)
        case .path:
            VStack(alignment: .leading, spacing: 0) {
                PathScreenBody(showsSolo: flow.entry == .firstRun, onChoose: handlers.choose)
                if let failure = status.failures[.path] { FastFailureLine(text: failure).padding(.horizontal, 24) }
            }
        case .invite:
            invite
        case .createTeam:
            let rows = form.rows(for: "create")
            CreateTeamScreenBody(name: $team.teamName, forge: $team.forge, group: $team.group, rows: rows,
                                 waiting: actions.waiting, errors: actions.errors,
                                 isCreating: status.busy == .createTeam, failure: status.failures[.createTeam],
                                 createEnabled: FastSetupFlow.createEnabled(nameAndGroup: team.canCreateTeam, rows: rows),
                                 onAction: perform, onBack: back, onCreate: handlers.create)
        case .restore:
            let rows = form.rows(for: "restore")
            RestoreScreenBody(repo: $team.restoreRepo, key: $team.restoreAgeKey, rows: rows,
                              waiting: actions.waiting, errors: actions.errors,
                              isRestoring: status.busy == .restore, failure: status.failures[.restore],
                              restoreEnabled: FastSetupFlow.restoreEnabled(repo: team.restoreRepo, key: team.restoreAgeKey, rows: rows),
                              onAction: perform, onBack: back, onRestore: handlers.restore)
        case .waiting:
            WaitingScreenBody(team: latest?.team?.name ?? "", admin: latest?.team?.invitedBy, onHide: handlers.hide)
        case .connect:
            let read = form.read(carrying: "connect")
            ConnectScreenBody(teamFirst: teamPath, rows: form.rows(for: "connect") ?? [],
                              waiting: actions.waiting, errors: actions.errors, continueReady: read?.continueReady ?? false,
                              onAction: perform, onBack: back, onContinue: { flow.continueToThisMac() })
        case .thisMac:
            let read = form.read(carrying: "this-mac")
            ThisMacScreenBody(teamName: teamPath ? latest?.team?.name : nil, rows: form.rows(for: "this-mac") ?? [],
                              waiting: actions.waiting, errors: actions.errors, startReady: read?.startReady ?? false,
                              onAction: perform, onBack: back, onStart: handlers.start)
        case .running:
            RunScreen(model: install, startedAt: status.runStartedAt, paused: nil, onHide: handlers.hide,
                      onRetry: handlers.retry, onPausedAction: handlers.pausedAction)
        case .paused:
            RunScreen(model: install, startedAt: status.runStartedAt, paused: form.whole?.paused ?? Self.unknownPause,
                      onHide: handlers.hide, onRetry: handlers.retry, onPausedAction: handlers.pausedAction)
        case .ready:
            // Only a read lands on ready, and every read carries rt's home.
            if let home = latest?.home ?? form.whole?.home {
                ReadyScreenBody(home: home, onOpen: handlers.openHome)
            }
        }
    }

    /// Join and Create land here through the invite or create screens; Just me has no team.
    private var teamPath: Bool {
        if let path = latest?.path { return path != "solo" }
        return latest?.team != nil
    }

    @ViewBuilder private var invite: some View {
        let rows = form.rows(for: "invite")
        let joining = status.busy == .invite
        InviteScreenBody(code: $team.inviteCode, inviteLine: team.inviteLine,
                         failure: status.failures[.invite] ?? team.joinError,
                         // Join stays grey until rt's invite rows land, so the read shows as still going.
                         isChecking: team.isChecking || (team.hasGoodVerdict && rows == nil),
                         rows: rows, waiting: actions.waiting, errors: actions.errors,
                         joinEnabled: !joining && FastSetupFlow.joinEnabled(verdictOK: team.hasGoodVerdict, rows: rows),
                         onPaste: { team.pasteInvite() }, onAction: perform, onBack: joining ? nil : back, onJoin: handlers.join)
    }

    /// rt names no failed step when the run's holder died, and Retry then runs setup again from the top.
    private static let unknownPause = FormPaused(step: "", title: "Setup stopped before it finished", detail: "Retry runs it again")
}

/// Before rt's first whole read: nothing says which screen setup is on yet.
struct FastLoadingBody: View {
    let error: String?
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Spacer(minLength: 0)
            if let error {
                FastFailureLine(text: error)
                Button("Try again", action: onRetry)
                    .accessibilityIdentifier(AXID.fastPrimary(FastSetupScreen.loading.rawValue))
            } else {
                ProgressView().controlSize(.regular)
                Text("Checking where setup left off…").foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.loading.rawValue))
    }
}

/// A screen's own verb failed: rt's sentence, in the failure colour.
struct FastFailureLine: View {
    let text: String

    var body: some View {
        Label {
            Text(text).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "exclamationmark.circle.fill")
        }
        .font(.callout)
        .foregroundStyle(.red)
    }
}
