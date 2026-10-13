import SwiftUI
import MattstackCore

struct RowIDs {
    let row: (String) -> String
    let action: (String) -> String
    let status: (String) -> String
    static let checklist = RowIDs(row: AXID.checklistRow, action: AXID.checklistRowAction, status: AXID.checklistRowStatus)
    static let beforeYouFinish = RowIDs(row: AXID.doneBeforeYouFinishRow, action: AXID.doneBeforeYouFinishRowAction,
                                        status: AXID.doneBeforeYouFinishRowStatus)
}

struct RowActivity {
    var checking: Set<String> = []
    var waiting: [String: String] = [:]
    var errors: [String: String] = [:]
}

struct ChecklistSectionsView: View {
    private struct Rows {
        let needsYou: [PlanRow]
        let optional: [PlanRow]
        let noAction: [PlanRow]
    }

    private let section: Rows
    let finishBlockedBy: Set<String>
    let activity: RowActivity
    /// The group each row came from, for the summary's Needs you pane.
    let contexts: [String: String]
    let needsYouIDs: RowIDs
    let onSkip: ((PlanRow) -> Void)?
    let perform: (PlanRow) -> Void
    @State private var noActionOpen = false

    init(section: ChecklistLayout.Section, finishBlockedBy: Set<String>, activity: RowActivity, contexts: [String: String] = [:],
         needsYouIDs: RowIDs = .checklist, onSkip: ((PlanRow) -> Void)? = nil, perform: @escaping (PlanRow) -> Void) {
        self.section = Rows(needsYou: section.needsYou, optional: section.optional, noAction: section.noAction)
        self.finishBlockedBy = finishBlockedBy; self.activity = activity; self.contexts = contexts
        self.needsYouIDs = needsYouIDs; self.onSkip = onSkip; self.perform = perform
    }

    /// Rows lifted out of their groups into one Needs you card.
    /// `ChecklistLayout.Section` has no public initializer, so this pane cannot be handed one.
    init(needsYou: [PlanRow], finishBlockedBy: Set<String>, activity: RowActivity, contexts: [String: String],
         needsYouIDs: RowIDs, onSkip: ((PlanRow) -> Void)?, perform: @escaping (PlanRow) -> Void) {
        self.section = Rows(needsYou: needsYou, optional: [], noAction: [])
        self.finishBlockedBy = finishBlockedBy; self.activity = activity; self.contexts = contexts
        self.needsYouIDs = needsYouIDs; self.onSkip = onSkip; self.perform = perform
    }

    private var noActionShown: Bool {
        noActionOpen || (section.needsYou.isEmpty && section.optional.isEmpty)
            || section.noAction.contains { activity.errors[$0.id] != nil }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !section.needsYou.isEmpty {
                ChecklistCard {
                    ChecklistCardHeader(title: "Needs you", symbol: "exclamationmark.triangle.fill", multicolor: true)
                    ForEach(section.needsYou) { row in
                        Divider()
                        SectionRow(row: row, badge: ChecklistSorting.badge(for: row, finishBlockedBy: finishBlockedBy),
                                   context: contexts[row.id], activity: activity, ids: needsYouIDs,
                                   onSkip: row.waivable && finishBlockedBy.contains(row.id) ? onSkip : nil, perform: perform)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(AXID.checklistSection("needsYou"))
            }
            if !section.optional.isEmpty {
                ChecklistCard {
                    ChecklistCardHeader(title: "Optional")
                    ForEach(section.optional) { row in
                        Divider()
                        SectionRow(row: row, badge: nil, context: nil, activity: activity, ids: .checklist, onSkip: nil, perform: perform)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(AXID.checklistSection("optional"))
            }
            if !section.noAction.isEmpty {
                ChecklistCard {
                    Button { noActionOpen.toggle() } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.circle").foregroundStyle(.green)
                            Text("No action needed · \(section.noAction.count)").font(.callout.weight(.semibold))
                            if !noActionShown {
                                Text(section.noAction.map(\.title).joined(separator: ", "))
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
                            }
                            Spacer(minLength: 8)
                            Image(systemName: noActionShown ? "chevron.down" : "chevron.right").font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier(AXID.checklistNoActionToggle)
                    if noActionShown {
                        ForEach(section.noAction) { row in
                            Divider()
                            SettledRow(row: row, isChecking: activity.checking.contains(row.id), error: activity.errors[row.id], perform: perform)
                        }
                    } else {
                        // The walkthrough reads every row's status by id, folded or not.
                        HStack(spacing: 0) {
                            ForEach(section.noAction) { row in
                                ZStack { RowStatusProbe(row: row, isChecking: activity.checking.contains(row.id),
                                                        id: AXID.checklistRowStatus(row.id)) }
                                    .accessibilityElement(children: .contain)
                                    .accessibilityIdentifier(AXID.checklistRow(row.id))
                            }
                        }
                        .frame(height: 0)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(AXID.checklistSection("noAction"))
            }
        }
    }
}

struct ChecklistCardHeader: View {
    let title: String
    var symbol: String?
    var multicolor = false
    var body: some View {
        HStack(spacing: 8) {
            if let symbol { Image(systemName: symbol).symbolRenderingMode(multicolor ? .multicolor : .monochrome) }
            Text(title).font(.callout.weight(.semibold))
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(Color.primary.opacity(0.03))
    }
}

struct ChecklistFilterView: View {
    /// There is no case for Needs you rows: their badge and Skip are drawn by their own pane only.
    enum Rows { case optional, settled }

    let rows: Rows
    let groups: [ChecklistLayout.FilterGroup]
    let activity: RowActivity
    let perform: (PlanRow) -> Void

    init?(kind: ChecklistLayout.SummaryKind, layout: ChecklistLayout, activity: RowActivity, perform: @escaping (PlanRow) -> Void) {
        switch kind {
        case .needsYou: return nil
        case .optional: rows = .optional
        case .ready, .notNeeded: rows = .settled
        }
        groups = layout.filtered(kind); self.activity = activity; self.perform = perform
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(groups) { group in
                ChecklistCard {
                    ChecklistCardHeader(title: group.title)
                    ForEach(group.rows) { row in
                        Divider()
                        switch rows {
                        case .optional:
                            SectionRow(row: row, badge: nil, context: nil, activity: activity, ids: .checklist, onSkip: nil, perform: perform)
                        case .settled:
                            SettledRow(row: row, isChecking: activity.checking.contains(row.id), error: activity.errors[row.id], perform: perform)
                        }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(AXID.checklistSection("filter.\(group.id)"))
            }
        }
    }
}

/// An invisible element that keeps a row's status readable by id, since rows
/// draw no status icon. The VM walkthrough and the UI tests compare the value
/// of `setup.checklist.row.<id>.status`, so the value is the bare status; the
/// label names the row, since VoiceOver reaches a folded row's probe with
/// nothing beside it.
struct RowStatusProbe: View {
    let status: RowStatus
    let label: String
    let id: String

    init(status: RowStatus, label: String, id: String) {
        self.status = status; self.label = label; self.id = id
    }

    init(row: PlanRow, isChecking: Bool, id: String) {
        let status: RowStatus = isChecking ? .checking : row.status
        self.init(status: status, label: "\(row.title): \(status.rawValue)", id: id)
    }

    var body: some View {
        Color.clear.frame(width: 1, height: 1)
            .accessibilityElement()
            .accessibilityLabel(Text(label))
            .accessibilityValue(Text(status.rawValue))
            .accessibilityIdentifier(id)
    }
}

struct SectionRow: View {
    let row: PlanRow
    let badge: NeedBadge?
    let context: String?
    let activity: RowActivity
    let ids: RowIDs
    let onSkip: ((PlanRow) -> Void)?
    let perform: (PlanRow) -> Void

    private var isChecking: Bool { activity.checking.contains(row.id) }
    private var isBroken: Bool { row.status == .error || row.status == .invalid }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(row.title).fontWeight(.medium)
                    if let context { Text(context).font(.caption).foregroundStyle(.secondary) }
                    if let badge {
                        Text(badge.rawValue).font(.caption2).padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Capsule().fill(Color.orange.opacity(0.18)))
                    }
                }
                Text(row.why).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if let d = row.detail, !d.isEmpty {
                    Text(d).font(.caption).foregroundStyle(isBroken ? Color.red : Color.secondary)
                }
                if let n = row.optionalNote { Text(n).font(.caption).foregroundStyle(.secondary) }
                if let waiting = activity.waiting[row.id] { RowWaitingCaption(rowId: row.id, text: waiting).padding(.top, 2) }
                if let error = activity.errors[row.id] {
                    Text(error).font(.caption).foregroundStyle(.red).accessibilityIdentifier(AXID.checklistRowError(row.id))
                }
            }
            Spacer(minLength: 8)
            if isChecking { ProgressView().controlSize(.small) }
            if let onSkip {
                Button(FinishGate.skipSheetConfirm) { onSkip(row) }.controlSize(.regular)
                    .accessibilityIdentifier(AXID.doneSkipRow(row.id))
            }
            if let action = row.action, action.type != .unknown {
                Button(action.label) { perform(row) }.controlSize(.regular).disabled(isChecking)
                    .accessibilityIdentifier(ids.action(row.id))
            }
            RowStatusProbe(row: row, isChecking: isChecking, id: ids.status(row.id))
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(ids.row(row.id))
    }
}

struct SettledRow: View {
    let row: PlanRow
    let isChecking: Bool
    let error: String?
    let perform: (PlanRow) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                Text(row.title).font(.callout)
                Spacer(minLength: 8)
                if let d = row.detail, !d.isEmpty {
                    Text(d).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
                }
                if let action = row.action, action.type != .unknown {
                    Button(action.label) { perform(row) }.controlSize(.small).disabled(isChecking)
                        .accessibilityIdentifier(AXID.checklistRowAction(row.id))
                }
                RowStatusProbe(row: row, isChecking: isChecking, id: AXID.checklistRowStatus(row.id))
            }
            if let error {
                Text(error).font(.caption).foregroundStyle(.red).accessibilityIdentifier(AXID.checklistRowError(row.id))
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 6)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.checklistRow(row.id))
    }
}
