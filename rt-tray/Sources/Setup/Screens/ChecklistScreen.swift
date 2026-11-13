import SwiftUI
import MattstackCore

struct ChecklistScreen: View {
    @ObservedObject var model: ReadinessModel
    let permissions: PermissionsService
    let rt: RtRunning
    let needs: NeedBroker
    enum Presentation {
        case accounts
        /// Only these rows, in one card, on another setup page: no load states and no Re-check bar.
        case rows([String])
    }
    var presentation: Presentation = .accounts
    private var scope: ReadinessModel.Scope { if case .accounts = presentation { return .accounts } else { return .all } }
    @State private var connect: (row: PlanRow, fields: [ActionField], alternatives: [ActionAlternative], create: ActionLink?)?
    @State private var steps: (title: String, steps: [String])?
    @State private var choose: PlanRow?
    private struct RowFailure {
        let message: String
        /// The row's status when its action failed: the failure is shown until that changes.
        let status: RowStatus
    }
    @State private var actionErrors: [String: RowFailure] = [:]
    @State private var waitingOnYou: [String: String] = [:]
    /// Rows whose waiting line came from opening a page, not from an apply run.
    @State private var pageWaits: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
            if case .rows(let ids) = presentation {
                rowsCard(ids)
            } else {
                screenBody
            }
        }
        .sheet(isPresented: Binding(get: { connect != nil }, set: { if !$0 { connect = nil } })) {
            if let c = connect {
                ConnectSheet(title: c.row.title, fields: c.fields, alternatives: c.alternatives, create: c.create) { values, alt in
                    guard let action = c.row.action else { return }
                    actionErrors[c.row.id] = nil
                    run(RowActionDispatcher.dispatch(action, fieldValues: values, alternative: alt), for: c.row)
                }
            }
        }
        .sheet(isPresented: Binding(get: { steps != nil }, set: { if !$0 { steps = nil } })) {
            if let s = steps { StepsSheet(title: s.title, steps: s.steps) }
        }
        .sheet(item: $choose) { row in
            ChooseSheet(row: row) { id in
                let failure = await ChoiceClient(rt: rt).choose(verb: row.action?.verb ?? [], id: id)
                if failure == nil { await model.afterAction(rowId: row.id) }
                return failure
            }
        }
        .environment(\.repoPlacementAnswer, { row, mode, path in placeRepo(row, mode: mode, path: path) })
        .onChange(of: model.allRows) { _, rows in settlePageWaits(rows) }
        // .contain: without it, the footer HStack's only interactive child
        // (Re-check) reports THIS screen-level identifier instead of its own.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(screenID)
    }

    private var screenID: String {
        if case .rows = presentation { return AXID.checklistRows }
        return scope == .all ? AXID.checklistScreen : AXID.settingsAccountsScreen
    }

    private func rowsCard(_ ids: [String]) -> some View {
        let rows = ids.compactMap { model.row($0) }
        return ChecklistCard {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if index > 0 { Divider() }
                SectionRow(row: row, badge: nil, context: nil, activity: activity, ids: .checklist, onSkip: nil, perform: perform)
            }
        }
    }

    @ViewBuilder private var screenBody: some View {
        switch model.loadState {
        case .loading:
            ChecklistLoadingView(title: scope == .all ? "Checking your setup…" : "Checking your accounts…")
        case .failed(let message):
            ChecklistLoadFailedView(title: scope == .all ? "Couldn't check your setup" : "Couldn't load your accounts",
                                    message: message) { recheck() }
        case .loaded:
            if model.lastRefreshFailed {
                // A failed refresh keeps the last loaded plan on screen, and Install may still be enabled under it.
                Label(scope == .all ? "Couldn't refresh the checklist. Re-check to try again."
                                    : "Couldn't refresh your accounts. Re-check to try again.",
                      systemImage: "exclamationmark.triangle")
                    .font(.callout).foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20).padding(.top, 12)
            }
            switch presentation {
            case .accounts: flatList
            case .rows: EmptyView()
            }
        }
        HStack(spacing: 6) {
            if isRefreshing { ProgressView().controlSize(.small) }
            TimelineView(.periodic(from: .now, by: 30)) { context in
                Text(footerText(now: context.date)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Re-check") { recheck() }.controlSize(.small).disabled(model.loadState == .loading).accessibilityIdentifier(scope == .all ? AXID.checklistRecheck : AXID.settingsAccountsRecheck)
        }
        .padding(.horizontal, 20).padding(.vertical, 6)
    }

    private var flatList: some View {
        Form {
            ForEach(model.groups(for: scope)) { group in
                Section(group.title) {
                    ForEach(group.rows) { row in fullRow(row) }
                }
            }
        }
        .formStyle(.grouped)
    }

    private var activity: RowActivity {
        RowActivity(checking: model.checkingRowIds, waiting: waitingOnYou, errors: liveErrors)
    }

    private var liveErrors: [String: String] {
        var live: [String: String] = [:]
        for row in model.allRows {
            if let failure = actionErrors[row.id], failure.status == row.status { live[row.id] = failure.message }
        }
        return live
    }

    @ViewBuilder
    private func fullRow(_ row: PlanRow) -> some View {
        RowView(row: row, isChecking: model.checkingRowIds.contains(row.id), team: model.team, waiting: waitingOnYou[row.id]) { perform(row) }
        if let message = liveErrors[row.id] {
            Text(message).font(.caption).foregroundStyle(.red).textSelection(.enabled).accessibilityIdentifier(AXID.checklistRowError(row.id))
        }
    }

    private var isRefreshing: Bool { model.loadState == .loaded && model.isLoading }

    private func footerText(now: Date) -> String {
        guard model.loadState == .loaded else { return "" }
        return ChecklistFooter.refreshNote(isRefreshing: isRefreshing, lastCheckedAt: model.lastCheckedAt, now: now) ?? ""
    }

    private func recordFailure(_ message: String, for row: PlanRow) {
        actionErrors[row.id] = RowFailure(message: message, status: model.row(row.id)?.status ?? row.status)
    }

    /// For after the plan re-read an action triggers: that re-read may move the row's status, and must not erase the failure the action just produced.
    private func restampFailure(_ message: String?, for row: PlanRow) {
        guard let message, actionErrors[row.id]?.message == message else { return }
        recordFailure(message, for: row)
    }

    private func recheck() {
        actionErrors = [:]
        Task { await model.recheckAll() }
    }

    /// A page wait ends when the row reads ready, or when a re-read moves it to an action that waits on nothing (the pairing steps).
    private func settlePageWaits(_ rows: [PlanRow]) {
        for row in rows where pageWaits.contains(row.id) && (row.status == .ready || row.action?.waiting == nil) {
            waitingOnYou[row.id] = nil
            pageWaits.remove(row.id)
        }
    }

    private func perform(_ row: PlanRow) {
        guard let action = row.action else { return }
        actionErrors[row.id] = nil
        run(RowActionDispatcher.dispatch(action, fieldValues: nil, alternative: nil), for: row)
    }

    /// rt's `then` (indexing or cloning what was just placed) runs only once the pick is recorded, exactly as a `run` action's verb would.
    private func placeRepo(_ row: PlanRow, mode: String, path: String) {
        guard let action = row.action else { return }
        actionErrors[row.id] = nil
        run(RowActionDispatcher.dispatch(action, fieldValues: ["mode": mode, "path": path], alternative: nil), for: row) {
            guard let then = action.then, !then.isEmpty else { return }
            run(RowActionDispatcher.dispatch(RowAction(type: .run, label: action.label, verb: then), fieldValues: nil, alternative: nil), for: row)
        }
    }

    private func run(_ dispatched: DispatchedAction, for row: PlanRow, onSuccess: (() -> Void)? = nil) {
        switch dispatched {
        case .openSettings(let target):
            permissions.openSettings(target)
        case .requestPermission(let which):
            Task { _ = await permissions.request(which); await model.afterAction(rowId: row.id) }
        case .rtVerb(let args, let stdin):
            // Redaction over-approximates: stdin carries a secret for
            // `connect`/`owner-once` but only a folder path for
            // `choose-folder`, which still redacts here. Its verb exits 2 on
            // every validation failure, and exit 2 routes through the JSON
            // envelope instead of this copy, so the redacted branch is
            // reachable for it only on a non-validation crash. Narrowing the
            // signal to the secret-carrying action types is a named follow-up.
            let redactStderr = stdin != nil
            model.beginChecking(row.id)
            Task {
                defer { model.endChecking(row.id) }
                let verb = args.joined(separator: " ")
                if RowVerbRun.streamsApplyEvents(args) {
                    let rowId = row.id
                    let failure = await RowVerbRun.apply(args, rt: rt, needs: needs, waiting: { copy in
                        await MainActor.run { waitingOnYou[rowId] = copy }
                    })
                    if let failure {
                        TrayLog.warn("row action failed", ["row": row.id, "err": failure])
                        recordFailure(failure, for: row)
                    }
                    await model.afterAction(rowId: row.id)
                    restampFailure(failure, for: row)
                    return
                }
                var failure: String?
                do {
                    let result = try await rt.run(args, stdin: stdin)
                    if let e = result.userError(redactStderr: redactStderr) {
                        TrayLog.warn("row action failed", ["row": row.id, "err": e.message])
                        failure = e.message
                    } else if result.exitCode != 0 {
                        let copy = result.failureCopy(verb: verb, redactStderr: redactStderr)
                        TrayLog.warn("row action failed", ["row": row.id, "err": copy])
                        failure = copy
                    }
                } catch {
                    let copy = (error as? RtClientError)?.copy ?? "rt \(verb) failed to start."
                    TrayLog.warn("row action failed", ["row": row.id, "err": copy])
                    failure = copy
                }
                if let failure { recordFailure(failure, for: row) }
                await model.afterAction(rowId: row.id)
                restampFailure(failure, for: row)
                // A task of its own, so it starts after this one's deferred endChecking and its own spinner is not cleared by it.
                if failure == nil, let onSuccess { Task { onSuccess() } }
            }
        case .chooseFolder(let startAt):
            guard let action = row.action else { return }
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.canCreateDirectories = true
            panel.allowsMultipleSelection = false
            panel.prompt = "Use this folder"
            if let s = startAt { panel.directoryURL = URL(fileURLWithPath: s) }
            guard panel.runModal() == .OK, let url = panel.url else { return }
            run(RowActionDispatcher.dispatch(action, fieldValues: ["root": url.path], alternative: nil), for: row)
        case .openURL(let url):
            NSWorkspace.shared.open(url)
            if let waiting = row.action?.waiting {
                waitingOnYou[row.id] = waiting
                pageWaits.insert(row.id)
            }
        case .showSteps(let list):
            steps = (row.title, list)
        case .collectFields(let fields, _, let alternatives, let create):
            connect = (row, fields, alternatives, create)
        case .chooseOption:
            choose = row
        case .placeRepo(let action):
            guard let mode = action.mode, let path = RepoPlacementPanel.pick(mode: mode, action: action) else { return }
            placeRepo(row, mode: mode, path: path)
        case .none:
            break
        }
    }

}

/// A bordered card of divided rows; a grouped Form spends too much height between sections.
struct ChecklistCard<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color(nsColor: .separatorColor)))
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

/// Fills the rows' area until the first plan arrives, so the window never opens blank.
struct ChecklistLoadingView: View {
    let title: String
    var body: some View {
        VStack(spacing: 12) {
            ProgressView().controlSize(.large)
            Text(title).font(.title3.weight(.semibold))
            Text("This can take a few seconds.").font(.callout).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AXID.checklistLoading)
    }
}

/// Shown in place of the rows when no plan has loaded yet and the last fetch failed.
struct ChecklistLoadFailedView: View {
    let title: String
    let message: String
    let onRetry: () -> Void
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .symbolRenderingMode(.multicolor)
                .font(.system(size: 36))
            Text(title).font(.title3.weight(.semibold))
            Text(message)
                .font(.callout).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(6)
                .textSelection(.enabled)
                .accessibilityIdentifier(AXID.checklistLoadFailed)
            Button("Try again", action: onRetry)
                .accessibilityIdentifier(AXID.checklistLoadRetry)
                .padding(.top, 4)
        }
        .padding(.horizontal, 40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct RowWaitingCaption: View {
    let rowId: String
    let text: String
    var body: some View {
        Label {
            Text(text).fontWeight(.medium)
        } icon: {
            Image(systemName: "hourglass").foregroundStyle(.orange)
        }
        .font(.caption)
        .accessibilityIdentifier(AXID.checklistRowWaiting(rowId))
    }
}
