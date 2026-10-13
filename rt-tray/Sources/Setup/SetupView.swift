import SwiftUI
import MattstackCore

struct SetupView: View {
    @ObservedObject var flow: SetupFlowModel
    @ObservedObject var team: TeamChoiceModel
    @ObservedObject var readiness: ReadinessModel
    @ObservedObject var install: InstallRunModel
    @ObservedObject var done: DoneModel
    let permissions: PermissionsService
    let env: SetupEnvironment
    let onFinish: () -> Void
    @State private var busy = false
    @State private var errorText: String?

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ZStack {
                switch flow.step {
                case .welcome: WelcomeScreen().transition(pushTransition)
                case .team: TeamScreen(model: team, showsSolo: flow.entry == .firstRun).transition(pushTransition)
                case .checklist:
                    ChecklistScreen(model: readiness, permissions: permissions, rt: env.rt, needs: env.needs,
                                    presentation: flow.readOnly ? .sidebar(overview: nil, onSkip: nil) : .page(flow.page))
                        .transition(pushTransition)
                case .install: InstallScreen(model: install).transition(pushTransition)
                case .done:
                    ChecklistScreen(
                        model: readiness, permissions: permissions, rt: env.rt, needs: env.needs,
                        presentation: .sidebar(
                            overview: AnyView(SummaryOverview(
                                model: done, install: install,
                                isOwner: DoneRole.owner(planTeam: readiness.team, choice: team.choice),
                                solo: DoneRole.solo(planTeam: readiness.team, choice: team.choice),
                                onInvite: { NotificationCenter.default.post(name: .rtShowSettingsTeam, object: nil) },
                                onRetry: { id in install.retry(from: id); flow.jump(to: .install) })),
                            onSkip: { done.requestSkip($0) },
                            rowsConfirmed: done.hasConfirmedRows))
                        .task { await done.checkPostInstall() }
                        .sheet(item: $done.skipTarget) { _ in SkipConfirmSheet(model: done) }
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier(AXID.doneScreen)
                        .transition(pushTransition)
                }
            }
            .animation(.easeInOut(duration: 0.22), value: flow.step)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            if let errorText {
                Text(errorText)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20).padding(.vertical, 8)
                    .accessibilityIdentifier(AXID.error(screenName))
            }
            Divider()
            footer
        }
        .frame(minWidth: SetupWindowController.width, maxWidth: .infinity, minHeight: SetupWindowController.minHeight, maxHeight: .infinity)
        .controlSize(.large)
        // .task(id:) reruns on the *initial* value too (unlike onChange), so a
        // deep link that opens straight into .checklist or .install still
        // loads/starts — onChange alone would silently no-op on first appear.
        .task(id: flow.step) {
            if flow.step == .checklist || flow.step == .done {
                if !flow.readinessIsVisible { flow.readinessIsVisible = true; readiness.becameVisible() }
                if flow.step == .checklist { await readiness.load() }
            } else if flow.readinessIsVisible {
                flow.readinessIsVisible = false
                readiness.becameHidden()
            }
            // A retry started from the Done screen is already running; entering Install must not restart the whole run over it.
            if flow.step == .install, flow.mayStartInstall, !install.isRunning { flow.isInstalling = true; install.start() }
        }
        .onChange(of: install.phase) { _, phase in
            flow.isInstalling = (phase == .running)
            if flow.step == .install, install.advancesOnSuccess { flow.next() }
        }
        // The window controller observes only the flow, so the gate is
        // mirrored there for the titlebar's close and minimize buttons.
        .onChange(of: done.finishEnabled, initial: true) { _, open in flow.finishGateOpen = open }
        .onChange(of: readiness.groups, initial: true) { _, groups in flow.setPages(groups) }
    }

    private var pushTransition: AnyTransition {
        .asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .move(edge: .leading).combined(with: .opacity))
    }

    private var header: some View {
        VStack(spacing: 10) {
            HStack {
                Text(flow.headerTitle).font(.title2.weight(.semibold))
                Spacer()
                if let indicator = flow.headerIndicator {
                    Text(indicator).font(.caption).foregroundStyle(.secondary)
                        .accessibilityIdentifier(AXID.stepIndicator)
                }
            }
            if let progress = flow.progress {
                HStack(spacing: 4) {
                    ForEach(1...progress.total, id: \.self) { i in
                        Capsule().fill(i < progress.current ? Color.green : i == progress.current ? Color.accentColor : Color.primary.opacity(0.12))
                            .frame(height: 4)
                    }
                }
                .accessibilityElement()
                .accessibilityIdentifier(AXID.progress)
                .accessibilityValue(Text("\(progress.current) of \(progress.total)"))
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
    }

    private var footer: some View {
        HStack {
            Spacer()
            if flow.showsBack {
                // Always present (never removed) so the AX walkthrough finds a
                // stable setup.<screen>.back element and reads its enabled state.
                Button("Back") { flow.back() }
                    .disabled(!flow.canGoBack)
                    .accessibilityIdentifier(AXID.back(screenName))
            }
            Button(flow.continueTitle) { Task { await advance() } }
                .keyboardShortcut(.defaultAction)
                .disabled(!continueEnabled || busy)
                .accessibilityIdentifier(flow.primaryClosesWindow ? AXID.statusClose : AXID.continue(screenName))
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
    }

    private var screenName: String { String(describing: flow.step) }

    private var continueEnabled: Bool {
        guard !flow.primaryClosesWindow else { return true }
        switch flow.step {
        case .welcome: return true
        case .team: return team.canContinue
        case .checklist:
            let group = readiness.groups.first { $0.id == flow.page }
            return PageGate.continueEnabled(blockers: group.map { PageGate.blockers(in: $0).count } ?? 0,
                                            isLast: flow.isLastPage, canInstall: readiness.canInstall)
        case .install: return install.phase == .succeeded
        case .done: return done.finishEnabled
        }
    }

    private func advance() async {
        errorText = nil
        guard !flow.primaryClosesWindow else { onFinish(); return }
        switch flow.step {
        case .team:
            busy = true; defer { busy = false }
            if let err = await team.validateAndPrepare() { errorText = err; return }
            flow.next()
        case .done:
            onFinish()
        default:
            flow.next()
        }
    }
}

extension Notification.Name {
    static let rtShowSettingsTeam = Notification.Name("rtShowSettingsTeam")
    static let rtAppsChanged = Notification.Name("rtAppsChanged")
}
