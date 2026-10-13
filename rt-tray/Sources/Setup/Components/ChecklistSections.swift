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

/// What a row is doing right now, beyond what the plan says about it.
struct RowActivity {
    var checking: Set<String> = []
    var waiting: [String: String] = [:]
    var errors: [String: String] = [:]
}

/// One group's rows as Needs you, Optional, No action needed.
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

    private var noActionShown: Bool { noActionOpen || (section.needsYou.isEmpty && section.optional.isEmpty) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !section.needsYou.isEmpty {
                ChecklistCard {
                    header("Needs you", symbol: "exclamationmark.triangle.fill", multicolor: true)
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
                    header("Optional", symbol: nil, multicolor: false)
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
                            SettledRow(row: row, isChecking: activity.checking.contains(row.id))
                        }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(AXID.checklistSection("noAction"))
            }
        }
    }

    private func header(_ title: String, symbol: String?, multicolor: Bool) -> some View {
        HStack(spacing: 8) {
            if let symbol { Image(systemName: symbol).symbolRenderingMode(multicolor ? .multicolor : .monochrome) }
            Text(title).font(.callout.weight(.semibold))
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(Color.primary.opacity(0.03))
    }
}

/// An invisible element that keeps a row's status readable by id: the VM
/// walkthrough and the UI tests read `setup.checklist.row.<id>.status`, and
/// rows no longer draw a status icon.
struct RowStatusProbe: View {
    let status: RowStatus
    let id: String
    var body: some View {
        Color.clear.frame(width: 1, height: 1)
            .accessibilityElement()
            .accessibilityLabel(Text(status.rawValue))
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
            RowStatusProbe(status: isChecking ? .checking : row.status, id: ids.status(row.id))
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(ids.row(row.id))
    }
}

struct SettledRow: View {
    let row: PlanRow
    let isChecking: Bool
    var body: some View {
        HStack(spacing: 8) {
            Text(row.title).font(.callout)
            Spacer(minLength: 8)
            if let d = row.detail, !d.isEmpty {
                Text(d).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
            }
            RowStatusProbe(status: isChecking ? .checking : row.status, id: AXID.checklistRowStatus(row.id))
        }
        .padding(.horizontal, 14).padding(.vertical, 6)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.checklistRow(row.id))
    }
}
