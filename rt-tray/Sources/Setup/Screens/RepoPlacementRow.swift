import AppKit
import SwiftUI
import MattstackCore

/// Records a "Your repos" answer: the row, then `mode` and the absolute `path` picked.
typealias RepoPlacementAnswer = @MainActor (PlanRow, String, String) -> Void

private struct RepoPlacementAnswerKey: EnvironmentKey {
    static let defaultValue: RepoPlacementAnswer? = nil
}

extension EnvironmentValues {
    /// Set by the checklist screen; the rows sit several views down, under initializers shared with every other row.
    var repoPlacementAnswer: RepoPlacementAnswer? {
        get { self[RepoPlacementAnswerKey.self] }
        set { self[RepoPlacementAnswerKey.self] = newValue }
    }
}

enum RepoPlacementPanel {
    /// The folder the member picked for `mode`, or nil when they cancelled.
    @MainActor
    static func pick(mode: String, action: RowAction) -> String? {
        if mode == RepoPlacementState.clone {
            let panel = NSSavePanel()
            panel.nameFieldStringValue = action.repo ?? ""
            panel.canCreateDirectories = true
            panel.prompt = "Clone here"
            if let parent = parent(of: action.clonePath) { panel.directoryURL = parent }
            guard panel.runModal() == .OK, let url = panel.url else { return nil }
            return url.path
        }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Use this checkout"
        if let parent = parent(of: action.checkoutPath ?? action.clonePath) { panel.directoryURL = parent }
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        return url.path
    }

    private static func parent(of path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        return URL(fileURLWithPath: (path as NSString).expandingTildeInPath).deletingLastPathComponent()
    }
}

/// One tracked repo on the "Your repos" page: rt sends the placement, the
/// segment, both paths and which presses record; this view only shows them
/// and hands a pick back through `repoPlacementAnswer`.
struct RepoPlacementRow: View {
    let row: PlanRow
    let action: RowAction
    var badge: NeedBadge? = nil
    var context: String? = nil
    let isChecking: Bool
    /// The last pick rt refused (or any other failure of this row's verbs).
    let error: String?
    let ids: RowIDs
    @Environment(\.repoPlacementAnswer) private var answer
    /// The segment on screen. A refused pick keeps it where the member put it, away from rt's `mode`.
    @State private var shown: String
    /// The segment the last answer was given on: its failure belongs to that segment alone.
    @State private var answeredMode: String?

    init(row: PlanRow, action: RowAction, badge: NeedBadge? = nil, context: String? = nil, isChecking: Bool, error: String?,
         ids: RowIDs, shown: String? = nil) {
        self.row = row; self.action = action; self.badge = badge; self.context = context
        self.isChecking = isChecking; self.error = error; self.ids = ids
        let start = shown ?? action.mode ?? RepoPlacementState.clone
        _shown = State(initialValue: start)
        _answeredMode = State(initialValue: shown)
    }

    private var onRecordedMode: Bool { shown == action.mode }
    private var shownError: String? { shown == (answeredMode ?? action.mode) ? error : nil }
    /// rt's `problem` describes the recorded mode only; on the other segment it is not this path's problem.
    private var lastError: String? { shownError ?? (onRecordedMode ? action.problem : nil) }
    private var note: String? { shownError ?? (onRecordedMode ? (action.problem ?? action.note) : nil) }
    private var style: RepoPlacementState.NoteStyle { RepoPlacementState.noteStyle(action: action, shown: shown, lastError: shownError) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                stateIcon.frame(width: 16)
                Text(action.repo ?? row.title).fontWeight(.semibold).lineLimit(1)
                Text(row.why).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                if let context { Text(context).font(.caption).foregroundStyle(.secondary).fixedSize() }
                if let badge {
                    Text(badge.rawValue).font(.caption2).padding(.horizontal, 6).padding(.vertical, 1)
                        .background(Capsule().fill(Color.orange.opacity(0.18))).fixedSize()
                }
                Spacer(minLength: 8)
                if isChecking { ProgressView().controlSize(.small) }
                Picker("Where this repo lives", selection: segment) {
                    Text("Current checkout").tag(RepoPlacementState.checkout)
                    Text("New checkout").tag(RepoPlacementState.clone)
                }
                .pickerStyle(.segmented)
                .controlSize(.small)
                .labelsHidden()
                .fixedSize()
                .disabled(isChecking)
                .accessibilityIdentifier(ids.segment(row.id))
            }
            HStack(spacing: 8) {
                pathField
                Button(RepoPlacementState.buttonLabel(mode: shown, lastError: lastError)) { pick(shown) }
                    .disabled(isChecking)
                    .accessibilityIdentifier(ids.action(row.id))
                if let oneClick = action.oneClick {
                    Button(oneClick.label) { record(oneClick.mode, oneClick.path) }
                        .buttonStyle(.borderedProminent)
                        .disabled(isChecking)
                        .accessibilityIdentifier(ids.oneClick(row.id))
                }
            }
            if let note, !note.isEmpty {
                Text(note).font(.caption).foregroundStyle(noteColor).fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier(shownError != nil ? AXID.checklistRowError(row.id) : ids.row(row.id) + ".note")
            }
            RowStatusProbe(row: row, isChecking: isChecking, id: ids.status(row.id))
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(ids.row(row.id))
        .onChange(of: action.mode) { _, mode in if let mode { shown = mode } }
    }

    @ViewBuilder private var stateIcon: some View {
        switch style {
        case .problem: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
        case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .secondary: Image(systemName: "arrow.down.circle.fill").foregroundStyle(.blue)
        }
    }

    private var noteColor: Color {
        switch style {
        case .problem: return .red
        case .ok: return .green
        case .secondary: return .secondary
        }
    }

    @ViewBuilder private var pathField: some View {
        let path = RepoPlacementState.path(mode: shown, action: action)
        Group {
            if let path {
                Text(path).font(.system(.caption, design: .monospaced)).foregroundStyle(.primary)
                    .lineLimit(1).truncationMode(.middle).textSelection(.enabled)
            } else {
                Text("No checkout chosen yet").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.04)))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color(nsColor: .separatorColor)))
    }

    /// rt's `segmentRecords` says whether a switch alone records; without it a switch only flips the view.
    private var segment: Binding<String> {
        Binding(get: { shown }, set: { picked in
            shown = picked
            guard action.segmentRecords == true, picked != action.mode else { return }
            if picked == RepoPlacementState.clone, let path = action.clonePath {
                record(picked, path)
            } else if picked == RepoPlacementState.checkout, let path = action.checkoutPath {
                record(picked, path)
            } else if picked == RepoPlacementState.checkout {
                // No checkout to fall back on: a cancelled Locate leaves the row where rt has it.
                if !pick(picked) { shown = action.mode ?? RepoPlacementState.clone }
            }
        })
    }

    @discardableResult
    private func pick(_ mode: String) -> Bool {
        guard let path = RepoPlacementPanel.pick(mode: mode, action: action) else { return false }
        record(mode, path)
        return true
    }

    private func record(_ mode: String, _ path: String) {
        shown = mode
        answeredMode = mode
        answer?(row, mode, path)
    }
}
