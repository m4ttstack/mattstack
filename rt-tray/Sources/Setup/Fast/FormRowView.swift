import AppKit
import SwiftUI
import MattstackCore

typealias FormRowPerform = (FormRow, [String: String]?, String?) -> Void

/// One fast-setup question: rt sends the row's state and action, and `waiting`
/// and `error` are the app's own overlays from `FormActionRunner`. Neither
/// overlay hides the control, so a wait that outlives rt's read can be retried.
struct FormRowView: View {
    let row: FormRow
    let waiting: String?
    let error: String?
    let onAction: FormRowPerform

    var body: some View {
        if let action = row.action, action.type == .placeRepo {
            RepoPlacementRow(row: FormRowPlan.planRow(row), action: action,
                             isChecking: row.state == .busy || waiting != nil, error: error, ids: .fast)
                .environment(\.repoPlacementAnswer) { _, mode, path in onAction(row, ["mode": mode, "path": path], nil) }
        } else {
            standard
        }
    }

    private var standard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.title).fontWeight(.medium)
                    if !row.subtext.isEmpty {
                        Text(row.subtext).font(.callout).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                trailing.layoutPriority(1)
            }
            if let error, !error.isEmpty {
                Label {
                    Text(error).fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "exclamationmark.circle.fill")
                }
                .font(.callout)
                .foregroundStyle(.red)
                .accessibilityIdentifier(AXID.fastRowError(row.id))
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastRow(row.id))
    }

    /// The line beside the control: a spinner while anything runs, else a done row's check.
    private var progressLine: String? {
        if let waiting { return waiting }
        guard row.state == .busy || row.state == .waiting else { return nil }
        return row.detail.isEmpty ? row.waiting : row.detail
    }

    @ViewBuilder private var trailing: some View {
        if let action = row.action, let options = FormRowChoice.segments(action) {
            FormRowChoice(row: row, action: action, options: options, onAction: onAction)
        } else if let action = row.action, FormRowFields.collects(action) {
            VStack(alignment: .trailing, spacing: 8) {
                status
                FormRowFields(row: row, action: action, onAction: onAction)
            }
        } else {
            HStack(spacing: 12) {
                status
                if let action = row.action { button(action) }
            }
        }
    }

    @ViewBuilder private var status: some View {
        if let line = progressLine {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text(line).font(.callout).foregroundStyle(.secondary)
                    .multilineTextAlignment(.trailing).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: 320, alignment: .trailing)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(AXID.fastRowWaiting(row.id))
        } else if row.state == .done {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                if !row.detail.isEmpty {
                    Text(row.detail).font(.callout).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                }
            }
            .frame(maxWidth: 300, alignment: .trailing)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(AXID.fastRow(row.id) + ".done")
        }
    }

    @ViewBuilder private func button(_ action: RowAction) -> some View {
        let label = row.state == .waiting || waiting != nil ? (action.again ?? action.label) : action.label
        switch action.type {
        case .unknown:
            EmptyView()
        case .chooseFolder:
            Button(label) { chooseFolder(action) }.fixedSize().accessibilityIdentifier(AXID.fastRowAction(row.id))
        default:
            if action.primary == true && row.state != .waiting && waiting == nil {
                Button(label) { onAction(row, nil, nil) }
                    .buttonStyle(.borderedProminent).fixedSize()
                    .accessibilityIdentifier(AXID.fastRowAction(row.id))
            } else {
                Button(label) { onAction(row, nil, nil) }.fixedSize().accessibilityIdentifier(AXID.fastRowAction(row.id))
            }
        }
    }

    private func chooseFolder(_ action: RowAction) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.prompt = "Choose"
        if let start = action.startAt, !start.isEmpty {
            panel.directoryURL = URL(fileURLWithPath: (start as NSString).expandingTildeInPath)
        }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        onAction(row, ["root": url.path], nil)
    }
}

/// `connect`, `form` and `owner-once` fields drawn in the row, submitted with Return or the action's button.
struct FormRowFields: View {
    let row: FormRow
    let action: RowAction
    let onAction: FormRowPerform
    @State private var values: [String: String]

    static func collects(_ action: RowAction) -> Bool {
        [.connect, .form, .ownerOnce].contains(action.type) && !(action.fields ?? []).isEmpty
    }

    init(row: FormRow, action: RowAction, onAction: @escaping FormRowPerform) {
        self.row = row; self.action = action; self.onAction = onAction
        var prefilled: [String: String] = [:]
        for f in action.fields ?? [] { if let v = f.value, !v.isEmpty { prefilled[f.name] = v } }
        _values = State(initialValue: prefilled)
    }

    private var fields: [ActionField] { action.fields ?? [] }
    private var complete: Bool { !fields.contains { (values[$0.name] ?? "").isEmpty } }

    /// The dispatcher drops a create link that is not https, so the row takes it from there.
    private var create: ActionLink? {
        if case .collectFields(_, _, _, let link) = RowActionDispatcher.dispatch(action, fieldValues: nil, alternative: nil) { return link }
        return nil
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            ForEach(Array(fields.enumerated()), id: \.element.name) { index, field in
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 4) {
                        input(field)
                        if let hint = field.hint, !hint.isEmpty {
                            Text(hint).font(.caption).foregroundStyle(.secondary)
                                .frame(width: 220, alignment: .leading)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if index == fields.count - 1, let create, let url = URL(string: create.url) {
                            Button(create.label) { NSWorkspace.shared.open(url) }
                                .buttonStyle(.link).fixedSize()
                                .accessibilityIdentifier(AXID.fastRowAction(row.id, "link"))
                        }
                    }
                    if index == fields.count - 1 {
                        Button(action.label, action: submit)
                            .disabled(!complete).fixedSize()
                            .accessibilityIdentifier(AXID.fastRowAction(row.id))
                    }
                }
            }
            if let alternatives = action.alternatives, !alternatives.isEmpty {
                HStack(spacing: 8) {
                    ForEach(alternatives, id: \.id) { alt in
                        Button(alt.label) { onAction(row, nil, alt.id) }
                            .fixedSize()
                            .accessibilityIdentifier(AXID.fastRowAction(row.id, alt.id))
                    }
                }
            }
        }
    }

    @ViewBuilder private func input(_ field: ActionField) -> some View {
        Group {
            if field.secret {
                SecureField(field.label, text: binding(field.name))
            } else {
                TextField(field.label, text: binding(field.name))
            }
        }
        .textFieldStyle(.roundedBorder)
        .frame(width: 220)
        .onSubmit(submit)
        .accessibilityLabel(field.label)
        .accessibilityIdentifier(fields.count == 1 ? AXID.fastRowField(row.id) : AXID.fastRowField(row.id, field.name))
    }

    private func submit() {
        guard complete else { return }
        onAction(row, values, nil)
    }

    private func binding(_ name: String) -> Binding<String> {
        Binding(get: { values[name] ?? "" }, set: { values[name] = $0 })
    }
}

/// A two-option `choose` drawn as a segmented control; picking records at once.
struct FormRowChoice: View {
    let row: FormRow
    let action: RowAction
    let options: [ChooseOption]
    let onAction: FormRowPerform
    @State private var shown: String

    /// Only a plain pick of two fits a segment; anything wider keeps rt's own sheet.
    static func segments(_ action: RowAction) -> [ChooseOption]? {
        guard action.type == .choose, action.other == nil, let options = action.options, options.count == 2 else { return nil }
        return options
    }

    init(row: FormRow, action: RowAction, options: [ChooseOption], onAction: @escaping FormRowPerform) {
        self.row = row; self.action = action; self.options = options; self.onAction = onAction
        _shown = State(initialValue: action.selected ?? "")
    }

    var body: some View {
        Picker(row.title, selection: Binding(get: { shown }, set: { picked in
            shown = picked
            if picked != action.selected { onAction(row, ["id": picked], nil) }
        })) {
            ForEach(options, id: \.id) { Text($0.label).tag($0.id) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
        .disabled(row.state == .busy)
        .accessibilityIdentifier(AXID.fastRowAction(row.id))
        .onChange(of: action.selected) { _, selected in if let selected { shown = selected } }
    }
}

/// `RepoPlacementRow` reads a plan row; a form row carries the same action.
enum FormRowPlan {
    /// rt puts the board line in a repo row's subtext, and `RepoPlacementRow` already draws `board` under the path.
    static func planRow(_ row: FormRow) -> PlanRow {
        let why = row.action?.board == row.subtext ? "" : row.subtext
        let status: RowStatus
        switch row.state {
        case .done: status = .ready
        case .todo: status = .needsYou
        case .busy, .waiting: status = .checking
        }
        return PlanRow(id: row.id, kind: .access, title: row.title, why: why, required: !row.optional,
                       status: status, detail: row.detail, action: row.action, recheck: .manual)
    }
}

extension RowIDs {
    static let fast = RowIDs(row: AXID.fastRow, action: { AXID.fastRowAction($0) }, status: { AXID.fastRow($0) + ".status" },
                             segment: { AXID.fastRow($0) + ".segment" }, oneClick: { AXID.fastRowAction($0, "oneClick") })
}
