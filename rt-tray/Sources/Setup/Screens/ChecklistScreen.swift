import SwiftUI
import MattstackCore

struct ChecklistScreen: View {
    @ObservedObject var model: ReadinessModel
    let permissions: PermissionsService
    let rt: RtRunning
    let needs: NeedBroker
    enum Presentation {
        case accounts
        /// A wizard page: one group. nil while no plan has landed.
        case page(String?)
        /// Setup status, and the wizard's last step when `overview` is set.
        /// `rowsConfirmed` is false while the model still holds the pre-install rows: the summary then shows its Overview alone.
        /// `recheck` replaces the model's own re-read: the summary's gate must see every re-read, or a second fetch would let its check confirm rows it never read.
        case sidebar(overview: AnyView?, onSkip: ((PlanRow) -> Void)?, rowsConfirmed: Bool = true, recheck: (() async -> Void)? = nil)
    }
    var presentation: Presentation = .sidebar(overview: nil, onSkip: nil)
    private var scope: ReadinessModel.Scope { if case .accounts = presentation { return .accounts } else { return .all } }
    private var showsOverviewOnly: Bool { if case .sidebar(.some, _, false, _) = presentation { return true } else { return false } }
    private var presentationRecheck: (() async -> Void)? { if case .sidebar(_, _, _, let recheck) = presentation { return recheck } else { return nil } }
    @State private var connect: (row: PlanRow, fields: [ActionField], alternatives: [ActionAlternative], create: ActionLink?)?
    @State private var steps: (title: String, steps: [String])?
    @State private var choose: PlanRow?
    private struct RowFailure {
        let message: String
        /// The row's status when its action failed: the failure is shown until that changes.
        let status: RowStatus
    }
    @State private var actionErrors: [String: RowFailure] = [:]
    @State private var selected: String?
    @State private var filter: ChecklistLayout.SummaryKind?
    @State private var waitingOnYou: [String: String] = [:]

    var body: some View {
        VStack(spacing: 0) {
            // The Overview carries its own spinner and failure, so it never waits behind the load states.
            switch showsOverviewOnly ? .loaded : model.loadState {
            case .loading:
                ChecklistLoadingView(title: scope == .all ? "Checking your setup…" : "Checking your accounts…")
            case .failed(let message):
                ChecklistLoadFailedView(title: scope == .all ? "Couldn't check your setup" : "Couldn't load your accounts",
                                        message: message) { recheck() }
            case .loaded:
                if model.lastRefreshFailed, !showsOverviewOnly {
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
                case .page(let id): pageBody(id)
                case .sidebar(let overview, let onSkip, let rowsConfirmed, _):
                    sidebarBody(overview: overview, onSkip: onSkip, rowsConfirmed: rowsConfirmed || overview == nil)
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
        .sheet(isPresented: Binding(get: { connect != nil }, set: { if !$0 { connect = nil } })) {
            if let c = connect {
                ConnectSheet(title: c.row.title, fields: c.fields, alternatives: c.alternatives, create: c.create) { values, alt in
                    guard let action = c.row.action else { return }
                    actionErrors[c.row.id] = nil
                    run(RowActionDispatcher.dispatch(action, fieldValues: values, alternative: alt), for: c.row)
                }
            }
        }
        .sheet(isPresented: Binding(get: { steps != nil }, set: { presented in
            guard !presented else { return }
            steps = nil
            // A finish-gated row changes outside the app (Chrome, a download): only the sheet's dismissal says to look again.
            if let recheck = presentationRecheck { Task { await recheck() } }
        })) {
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

    private var relaunchBanner: some View {
        HStack {
            Text("Full Disk Access was granted. Relaunch mattstack to apply it.").font(.caption)
            Spacer()
            Button("Relaunch mattstack") { AppRelaunch.relaunchInPlace(resumeAt: .checklist) }.accessibilityIdentifier(AXID.checklistRelaunch)
        }
    }

    private func pageBody(_ id: String?) -> some View {
        let layout = ChecklistLayout.make(model.groups, finishBlockedBy: model.finishBlockedBy)
        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if model.fdaNeedsRelaunch { relaunchBanner }
                if let section = layout.sections.first(where: { $0.id == id }) {
                    Text(PageLead.text(for: section)).font(.callout).foregroundStyle(.secondary)
                    ChecklistSectionsView(section: section, finishBlockedBy: layout.finishBlockedBy, activity: activity) { perform($0) }
                        .id(section.id)
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .background(Color.primary.opacity(0.035))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.checklistPage(id ?? ""))
    }

    private func sidebarBody(overview: AnyView?, onSkip: ((PlanRow) -> Void)?, rowsConfirmed: Bool) -> some View {
        let layout = ChecklistLayout.make(model.groups, finishBlockedBy: model.finishBlockedBy, afterInstall: true)
        let entries = layout.entries(overview: overview != nil, running: model.checkingRowIds, failed: Set(liveErrors.keys))
            .filter { rowsConfirmed || $0.id == ChecklistLayout.overviewID }
        let current = rowsConfirmed ? layout.selection(preferred: selected, overview: overview != nil) : ChecklistLayout.overviewID
        let shownFilter = rowsConfirmed ? layout.activeFilter(filter) : nil
        return VStack(alignment: .leading, spacing: 12) {
            if rowsConfirmed {
                HStack(spacing: 6) {
                    ForEach(layout.summary, id: \.kind) { part in
                        SummaryCount(part: part, isOn: part.kind == shownFilter) {
                            if part.kind == .needsYou {
                                filter = nil
                                selected = ChecklistLayout.needsYouID
                            } else {
                                filter = part.kind == shownFilter ? nil : part.kind
                            }
                        }
                    }
                    Spacer()
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(AXID.checklistSummary)
            }
            if model.fdaNeedsRelaunch { relaunchBanner }
            HStack(alignment: .top, spacing: 12) {
                ChecklistCard {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { Divider() }
                        // A pick made before the rows are confirmed would keep the summary off Needs you once they are.
                        ChecklistSidebarEntry(entry: entry, isSelected: shownFilter == nil && entry.id == current) {
                            if rowsConfirmed { filter = nil; selected = entry.id }
                        }
                    }
                }
                .frame(width: 220)
                ScrollView {
                    Group {
                        if let shownFilter {
                            ChecklistFilterView(kind: shownFilter, layout: layout, activity: activity) { perform($0) }
                        } else if current == ChecklistLayout.overviewID, let overview {
                            ChecklistCard { overview }
                        } else if current == ChecklistLayout.needsYouID {
                            ChecklistSectionsView(
                                needsYou: layout.attention.map(\.row), finishBlockedBy: layout.finishBlockedBy, activity: activity,
                                contexts: Dictionary(layout.attention.map { ($0.row.id, $0.groupTitle) }, uniquingKeysWith: { first, _ in first }),
                                needsYouIDs: overview != nil ? .beforeYouFinish : .checklist, onSkip: onSkip) { perform($0) }
                        } else if let section = layout.sections.first(where: { $0.id == current }) {
                            ChecklistSectionsView(section: section, finishBlockedBy: layout.finishBlockedBy, activity: activity,
                                                  onSkip: onSkip) { perform($0) }
                                .id(section.id)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.primary.opacity(0.035))
        // A filter left set after its rows went would come back on, with no click, when a later re-read gave it rows again.
        .onChange(of: layout.activeFilter(filter)) { _, active in if active == nil { filter = nil } }
    }

    @ViewBuilder
    private func fullRow(_ row: PlanRow) -> some View {
        RowView(row: row, isChecking: model.checkingRowIds.contains(row.id), waiting: waitingOnYou[row.id]) { perform(row) }
        if let message = liveErrors[row.id] {
            Text(message).font(.caption).foregroundStyle(.red).accessibilityIdentifier(AXID.checklistRowError(row.id))
        }
    }

    private var isRefreshing: Bool { model.loadState == .loaded && model.isLoading }

    private func footerText(now: Date) -> String {
        guard model.loadState == .loaded else { return "" }
        let note = ChecklistFooter.refreshNote(isRefreshing: isRefreshing, lastCheckedAt: model.lastCheckedAt, now: now)
        guard !isRefreshing else { return note ?? "" }
        let status: String?
        switch presentation {
        case .accounts: status = nil
        case .page(let id):
            let group = model.groups.first { $0.id == id }
            let isLast = WizardPages(groups: model.groups).ids.last == id
            status = PageGate.footer(blockers: group.map { PageGate.blockers(in: $0).count } ?? 0, isLast: isLast, canInstall: model.canInstall)
        case .sidebar(let overview, _, _, _):
            status = overview == nil ? ChecklistFooter.text(canInstall: model.canInstall, requiredMissingCount: model.requiredMissing.count,
                                                            owedBeforeFinish: ChecklistFooter.owedBeforeFinish(model.allRows)) : nil
        }
        return [note, status].compactMap { $0 }.joined(separator: " · ")
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
        let recheck = presentationRecheck
        Task { if let recheck { await recheck() } else { await model.recheckAll() } }
    }

    private func perform(_ row: PlanRow) {
        guard let action = row.action else { return }
        actionErrors[row.id] = nil
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

enum PageLead {
    static func text(for section: ChecklistLayout.Section) -> String {
        let required = section.needsYou.filter(ChecklistSorting.blocksInstall).count
        if required == 1 { return "One thing here needs you before Install can run." }
        if required > 1 { return "\(required) things here need you before Install can run." }
        if !section.needsYou.isEmpty { return "Nothing here blocks Install. One thing is needed before you finish." }
        return section.optional.isEmpty ? "Nothing here needs you." : "Nothing here blocks Install."
    }
}

struct SummaryGlyph: View {
    let kind: ChecklistLayout.SummaryKind
    var body: some View {
        switch kind {
        case .needsYou: Image(systemName: "exclamationmark.triangle.fill").symbolRenderingMode(.multicolor)
        case .ready: Image(systemName: "checkmark.circle").foregroundStyle(.green)
        case .optional: Image(systemName: "circle").foregroundStyle(.secondary)
        case .notNeeded: Image(systemName: "circle.dashed").foregroundStyle(.secondary)
        }
    }
}

struct SummaryCount: View {
    let part: ChecklistLayout.SummaryPart
    let isOn: Bool
    let onPick: () -> Void
    var body: some View {
        Button(action: onPick) {
            HStack(spacing: 4) {
                SummaryGlyph(kind: part.kind).accessibilityHidden(true)
                // The hidden copy holds the semibold width, so turning a filter on moves no other count.
                Text(part.text).font(.callout).fontWeight(.semibold).hidden()
                    .overlay(alignment: .leading) { Text(part.text).font(.callout).fontWeight(isOn ? .semibold : .regular) }
            }
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Capsule().fill(isOn ? Color.accentColor.opacity(0.16) : Color.primary.opacity(0.06)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(AXID.checklistFilter(idName))
        .accessibilityLabel(Text(part.text))
        .accessibilityValue(Text(isOn ? "on" : "off"))
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }

    /// Spelled out, not read off the case: the UI tests click these ids, and a renamed case must not rename one.
    private var idName: String {
        switch part.kind {
        case .needsYou: return "needsYou"
        case .ready: return "ready"
        case .optional: return "optional"
        case .notNeeded: return "notNeeded"
        }
    }
}

struct ChecklistSidebarEntry: View {
    let entry: ChecklistLayout.Entry
    let isSelected: Bool
    let onSelect: () -> Void
    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 6) {
                mark.frame(width: 20, height: 20)
                Text(entry.title).font(.callout).fontWeight(isSelected ? .semibold : .regular).lineLimit(1)
                Spacer(minLength: 6)
                if let count = entry.count { Text("\(count)").font(.caption).foregroundStyle(.secondary) }
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(isSelected ? Color.accentColor.opacity(0.16) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(AXID.checklistGroup(entry.id))
        .accessibilityValue(Text(String(describing: entry.mark)))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    @ViewBuilder private var mark: some View {
        switch entry.mark {
        case .overview: Image(systemName: "house").foregroundStyle(.secondary)
        case .failed: Image(systemName: "xmark.circle").foregroundStyle(.red)
        case .running: ProgressView().controlSize(.small)
        case .needsYou: Image(systemName: "exclamationmark.triangle.fill").symbolRenderingMode(.multicolor)
        case .settled: Image(systemName: "checkmark.circle").foregroundStyle(.green)
        }
    }
}
