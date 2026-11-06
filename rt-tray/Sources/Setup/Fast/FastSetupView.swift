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
    var toolsDone: () -> Void

    static let inert = FastSetupHandlers(choose: { _ in }, join: {}, create: {}, restore: {}, start: {}, hide: {}, retry: {},
                                         pausedAction: { _ in }, openHome: {}, readAgain: {}, toolsDone: {})
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
    @State private var shown: FastSetupScreen?

    private var drawn: FastSetupScreen {
        let next = flow.screen
        return FastSetupScreen.drawn(next: next, shown: shown, rowsLanded: next.section.flatMap { form.rows(for: $0) } != nil,
                                     readFailed: !form.isLoading && form.error != nil)
    }

    var body: some View {
        let drawn = drawn
        // `shown` still holds the screen being left during the render that changes it, so the direction reads here.
        let forward = Self.order(drawn) >= Self.order(shown ?? drawn)
        FastWindowChrome(step: FastStep.label(for: drawn, path: stepPath, entry: flow.entry)) {
            ZStack {
                screen(drawn)
                    .id(drawn)
                    .transition(Self.screenChange(forward: forward))
            }
            .animation(.spring(response: 0.42, dampingFraction: 0.9), value: drawn)
            // Anything rt's next read changes on this screen (a row's state, a card's rows, a failure) eases into place.
            .animation(.spring(response: 0.38, dampingFraction: 0.9), value: changeKey(drawn))
        }
            .onAppear { shown = drawn }
            .onChange(of: drawn) { _, now in shown = now }
            .frame(width: SetupWindowController.width)
            .frame(minHeight: SetupWindowController.minHeight)
            .controlSize(.large)
            .environment(\.formRowsRunning, actions.running)
            .environment(\.fastScreenFailure, status.failures[drawn])
            .sheet(item: $actions.sheet, onDismiss: { Task { await actions.sheetClosed() } }) { sheet in
                FastSetupSheet(sheet: sheet, actions: actions)
            }
    }

    /// What rt's reads and the presses change on a screen; typing changes none of it.
    private func changeKey(_ screen: FastSetupScreen) -> String {
        let rows = screen.section.flatMap { form.rows(for: $0) } ?? []
        let states = rows.map { "\($0.id):\($0.state.rawValue):\($0.action?.label ?? "")" }.joined(separator: ",")
        let failure = status.failures[screen] ?? ""
        return [states, actions.waiting.keys.sorted().joined(separator: ","), failure, String(status.busy == screen)].joined(separator: "|")
    }

    /// The new screen fades and slides in from the side it comes from; the old one leaves the other way.
    static func screenChange(forward: Bool) -> AnyTransition {
        let shift: CGFloat = forward ? 18 : -18
        return .asymmetric(
            insertion: .opacity.combined(with: .offset(x: shift)),
            removal: .opacity.combined(with: .offset(x: -shift)))
    }

    /// Where a screen sits on the way through setup, so Back slides the other way.
    static func order(_ screen: FastSetupScreen) -> Int {
        switch screen {
        case .loading: return 0
        case .macos: return 1
        case .path: return 2
        case .invite, .createTeam, .restore: return 3
        case .waiting: return 4
        case .connect: return 5
        case .thisMac: return 6
        case .tools: return 7
        case .running, .paused: return 8
        case .ready: return 9
        }
    }

    private var back: (() -> Void)? { flow.canGoBack ? { flow.back() } : nil }
    private var latest: SetupForm? { form.form }

    private func perform(_ row: FormRow, _ values: [String: String]?, _ alternative: String?) {
        Task { await actions.perform(row, values: values, alternative: alternative) }
    }

    @ViewBuilder private func screen(_ drawn: FastSetupScreen) -> some View {
        switch drawn {
        case .loading:
            FastLoadingBody(error: form.isLoading ? nil : form.error, onRetry: handlers.readAgain)
        case .macos:
            MacOSScreenBody(rows: form.rows(for: "macos") ?? [], waiting: actions.waiting, errors: actions.errors, onAction: perform)
        case .path:
            PathScreenBody(showsSolo: flow.entry == .firstRun, failure: status.failures[.path], onChoose: handlers.choose)
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
            ThisMacScreenBody(teamName: teamPath ? latest?.team?.name : nil, solo: stepPath == "solo", rows: form.rows(for: "this-mac") ?? [],
                              waiting: actions.waiting, errors: actions.errors, startReady: read?.startReady ?? false, start: read?.start, status: flow.entry == .status,
                              onAction: perform, onBack: back, onStart: handlers.start)
        case .tools:
            ToolsScreenBody(tools: form.read(carrying: "tools")?.tools, rows: form.rows(for: "tools") ?? [],
                            waiting: actions.waiting, errors: actions.errors, isAcking: status.busy == .tools,
                            failure: status.failures[.tools], onAction: perform, onLater: handlers.hide, onDone: handlers.toolsDone)
        case .running:
            RunScreen(model: install, startedAt: status.runStartedAt, paused: nil, onHide: handlers.hide,
                      onRetry: handlers.retry, onPausedAction: handlers.pausedAction)
        case .paused:
            RunScreen(model: install, startedAt: status.runStartedAt, paused: form.whole?.paused ?? Self.unknownPause,
                      onHide: handlers.hide, onRetry: handlers.retry, onPausedAction: handlers.pausedAction)
        case .ready:
            // Only a read lands on ready, and every read carries rt's home.
            if let home = latest?.home ?? form.whole?.home {
                ReadyScreenBody(home: home, notice: flow.entry == .status ? form.whole?.orgNotice : nil, onOpen: handlers.openHome)
            }
        }
    }

    /// rt's path, else the card picked in this window once past the cards: `team.choice` holds a default before then.
    private var stepPath: String? {
        if let path = latest?.path ?? form.whole?.path { return path }
        switch flow.screen {
        case .loading, .macos, .path: return nil
        default:
            switch team.choice {
            case .join: return "join"
            case .create: return "create"
            case .restore: return "restore"
            case .solo: return "solo"
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
                         joinEnabled: FastSetupFlow.joinEnabled(verdictOK: team.hasGoodVerdict, rows: rows), isJoining: joining,
                         onPaste: { team.pasteInvite() }, onAction: perform, onBack: joining ? nil : back, onJoin: handlers.join)
    }

    /// rt names no failed step when the run's holder died, and Retry then runs setup again from the top.
    private static let unknownPause = FormPaused(step: "", title: "Setup stopped before it finished", detail: "Retry runs it again")
}

/// A row's sheet: rt's steps for something only the person can do, or a pick wider than a segment.
struct FastSetupSheet: View {
    let sheet: FormSheet
    let actions: FormActionRunner

    var body: some View {
        switch sheet {
        case .steps(let row, let steps):
            StepsSheet(title: row.title, steps: steps).environment(\.fastSheet, true)
        case .choose(let row):
            ChooseSheet(row: FormRowPlan.planRow(row), submitLabel: "Choose") { id in await actions.choose(row, id: id) }
                .environment(\.fastSheet, true)
        }
    }
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
                    .buttonStyle(FastSecondaryButtonStyle(size: .large))
                    .accessibilityIdentifier(AXID.fastPrimary(FastSetupScreen.loading.rawValue))
            } else {
                FastSpinner(size: 18)
                FastTheme.sub("Getting setup ready…")
            }
            Spacer(minLength: 0)
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 48).padding(.vertical, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.loading.rawValue))
    }
}

/// A screen's own verb failed: rt's sentence in the warning colour, as P6b draws what failed, at the 12-point hint size of
/// the blocks it sits in. A row's error keeps its row's 11-point hints instead.
struct FastFailureLine: View {
    let text: String

    var body: some View {
        FastHint(text, size: 12, symbol: "exclamationmark.circle", tint: FastTheme.warning)
    }
}
