import SwiftUI
import MattstackCore

struct ChecklistScreen: View {
    @ObservedObject var model: ReadinessModel
    let permissions: PermissionsService
    let rt: RtRunning
    let needs: NeedBroker
    var scope: ReadinessModel.Scope = .all
    @State private var connect: (row: PlanRow, fields: [ActionField], alternatives: [ActionAlternative], create: ActionLink?)?
    @State private var steps: (title: String, steps: [String])?
    @State private var choose: PlanRow?
    @State private var actionError: (rowId: String, message: String)?
    @State private var waitingOnYou: [String: String] = [:]
    @State private var openGroups: Set<String> = []
    @State private var openRows: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
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
                if scope == .all { foldedList } else { flatList }
            }
            HStack(spacing: 6) {
                if isRefreshing { ProgressView().controlSize(.small) }
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    Text(footerText(now: context.date)).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button(isRefreshing ? "Checking…" : "Re-check") { recheck() }.controlSize(.small).disabled(model.isLoading).accessibilityIdentifier(scope == .all ? AXID.checklistRecheck : AXID.settingsAccountsRecheck)
            }
            .padding(.horizontal, 20).padding(.vertical, 6)
        }
        .sheet(isPresented: Binding(get: { connect != nil }, set: { if !$0 { connect = nil } })) {
            if let c = connect {
                ConnectSheet(title: c.row.title, fields: c.fields, alternatives: c.alternatives, create: c.create) { values, alt in
                    guard let action = c.row.action else { return }
                    actionError = nil
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
        // .contain: without it, the footer HStack's only interactive child
        // (Re-check) reports THIS screen-level identifier instead of its own
        // -- same fix as InstallScreen's stepRow.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(scope == .all ? AXID.checklistScreen : AXID.settingsAccountsScreen)
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

    private var foldedList: some View {
        let layout = ChecklistLayout.make(model.groups)
        return VStack(spacing: 0) {
            HStack(spacing: 14) {
                ForEach(layout.summary, id: \.text) { part in
                    HStack(spacing: 4) {
                        StatusBadge(status: part.status)
                        Text(part.text).font(.callout)
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 20).padding(.top, 12)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(AXID.checklistSummary)
            ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !layout.attention.isEmpty || model.fdaNeedsRelaunch {
                        ChecklistCard(title: "Needs you") {
                            ForEach(Array(layout.attention.enumerated()), id: \.element.id) { index, item in
                                if index > 0 { Divider() }
                                fullRow(item.row, context: item.groupTitle, statusLeads: true)
                                    .padding(.horizontal, 14).padding(.vertical, 6)
                            }
                            if model.fdaNeedsRelaunch {
                                if !layout.attention.isEmpty { Divider() }
                                HStack {
                                    Text("Full Disk Access was granted. Relaunch mattstack to apply it.").font(.caption)
                                    Spacer()
                                    Button("Relaunch mattstack") { AppRelaunch.relaunchInPlace(resumeAt: .checklist) }.accessibilityIdentifier(AXID.checklistRelaunch)
                                }
                                .padding(.horizontal, 14).padding(.vertical, 10)
                            }
                        }
                    }
                    if !layout.groups.isEmpty {
                        ChecklistCard(title: "Everything checked") {
                            ForEach(Array(layout.groups.enumerated()), id: \.element.id) { index, group in
                                if index > 0 { Divider() }
                                FoldedGroupHeader(group: group, isOpen: openGroups.contains(group.id)) {
                                    toggle(group.id, in: &openGroups)
                                    if openGroups.contains(group.id) { reveal(Self.groupAnchor(group.id), at: .top, with: proxy) }
                                }
                                .id(Self.groupAnchor(group.id))
                                if openGroups.contains(group.id) {
                                    ForEach(group.rows) { row in
                                        Divider()
                                        if staysOpen(row) {
                                            fullRow(row)
                                                .padding(.leading, 36).padding(.trailing, 14).padding(.vertical, 6)
                                                .contentShape(Rectangle())
                                                .onTapGesture { toggle(row.id, in: &openRows) }
                                                .id(Self.rowAnchor(row.id))
                                        } else {
                                            FoldedRow(row: row) {
                                                toggle(row.id, in: &openRows)
                                                reveal(Self.rowAnchor(row.id), at: nil, with: proxy)
                                            }
                                            .id(Self.rowAnchor(row.id))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.vertical, 14)
            }
            }
        }
        .background(Color.primary.opacity(0.035))
    }

    private static func groupAnchor(_ id: String) -> String { "group." + id }
    private static func rowAnchor(_ id: String) -> String { "row." + id }

    /// Deferred a turn: the expanded rows do not exist until the state change has laid out.
    private func reveal(_ anchor: String, at point: UnitPoint?, with proxy: ScrollViewProxy) {
        DispatchQueue.main.async {
            withAnimation(.easeInOut(duration: 0.2)) { proxy.scrollTo(anchor, anchor: point) }
        }
    }

    /// A row mid-action or showing a failure must not fold away under the user.
    private func staysOpen(_ row: PlanRow) -> Bool {
        openRows.contains(row.id) || model.checkingRowIds.contains(row.id) || waitingOnYou[row.id] != nil || actionError?.rowId == row.id
    }

    private func toggle(_ id: String, in set: inout Set<String>) {
        if set.contains(id) { set.remove(id) } else { set.insert(id) }
    }

    @ViewBuilder
    private func fullRow(_ row: PlanRow, context: String? = nil, statusLeads: Bool = false) -> some View {
        RowView(row: row, isChecking: model.checkingRowIds.contains(row.id), waiting: waitingOnYou[row.id], context: context,
                statusLeads: statusLeads) { perform(row) }
        if let actionError, actionError.rowId == row.id {
            Text(actionError.message).font(.caption).foregroundStyle(.red)
                .accessibilityIdentifier(AXID.checklistRowError(row.id))
        }
    }

    private var isRefreshing: Bool { model.loadState == .loaded && model.isLoading }

    private func footerText(now: Date) -> String {
        guard model.loadState == .loaded else { return "" }
        let note = ChecklistFooter.refreshNote(isRefreshing: isRefreshing, lastCheckedAt: model.lastCheckedAt, now: now)
        guard scope == .all, !isRefreshing else { return note ?? "" }
        let status = ChecklistFooter.text(canInstall: model.canInstall, requiredMissingCount: model.requiredMissing.count,
                                          owedBeforeFinish: ChecklistFooter.owedBeforeFinish(model.allRows))
        return [note, status].compactMap { $0 }.joined(separator: " · ")
    }

    private func recheck() {
        actionError = nil
        Task { await model.recheckAll() }
    }

    private func perform(_ row: PlanRow) {
        guard let action = row.action else { return }
        actionError = nil
        run(RowActionDispatcher.dispatch(action, fieldValues: nil, alternative: nil), for: row)
    }

    private func run(_ dispatched: DispatchedAction, for row: PlanRow) {
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
                    if let failure = await RowVerbRun.apply(args, rt: rt, needs: needs, waiting: { copy in
                        await MainActor.run { waitingOnYou[rowId] = copy }
                    }) {
                        TrayLog.warn("row action failed", ["row": row.id, "err": failure])
                        actionError = (row.id, failure)
                    }
                    await model.afterAction(rowId: row.id)
                    return
                }
                do {
                    let result = try await rt.run(args, stdin: stdin)
                    if let e = result.userError(redactStderr: redactStderr) {
                        TrayLog.warn("row action failed", ["row": row.id, "err": e.message])
                        actionError = (row.id, e.message)
                    } else if result.exitCode != 0 {
                        let copy = result.failureCopy(verb: verb, redactStderr: redactStderr)
                        TrayLog.warn("row action failed", ["row": row.id, "err": copy])
                        actionError = (row.id, copy)
                    }
                } catch {
                    let copy = (error as? RtClientError)?.copy ?? "rt \(verb) failed to start."
                    TrayLog.warn("row action failed", ["row": row.id, "err": copy])
                    actionError = (row.id, copy)
                }
                await model.afterAction(rowId: row.id)
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
        case .showSteps(let list):
            steps = (row.title, list)
        case .collectFields(let fields, _, let alternatives, let create):
            connect = (row, fields, alternatives, create)
        case .chooseOption:
            choose = row
        case .none:
            break
        }
    }

}

/// A titled card of divided rows; the grouped Form it replaces spends too much height between sections.
struct ChecklistCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.callout.weight(.semibold)).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 0) { content }
                .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color(nsColor: .separatorColor)))
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }
}

struct FoldedGroupHeader: View {
    let group: ChecklistLayout.FoldedGroup
    let isOpen: Bool
    let onToggle: () -> Void
    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 8) {
                Image(systemName: isOpen ? "chevron.down" : "chevron.right")
                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary).frame(width: 14)
                Text(group.title).fontWeight(.medium)
                Spacer(minLength: 8)
                Text(group.countText).font(.callout).foregroundStyle(.secondary)
                StatusBadge(status: group.attentionCount == 0 ? .ready : .needsYou)
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(AXID.checklistGroup(group.id))
    }
}

struct FoldedRow: View {
    let row: PlanRow
    let onOpen: () -> Void
    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 8) {
                Text(row.title).font(.callout)
                Spacer(minLength: 8)
                if let d = row.detail, !d.isEmpty {
                    Text(d).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
                }
                StatusBadge(status: row.status, id: AXID.checklistRowStatus(row.id))
            }
            .padding(.leading, 36).padding(.trailing, 14).padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(AXID.checklistRow(row.id))
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
