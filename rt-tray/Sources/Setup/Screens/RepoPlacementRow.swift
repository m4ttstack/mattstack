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
    /// The fast screen draws P5b's repo block with rt's button label; the checklist keeps the system controls.
    let fast: Bool
    @Environment(\.repoPlacementAnswer) private var answer
    @Environment(\.colorScheme) private var scheme
    /// The segment on screen. A refused pick keeps it where the member put it, away from rt's `mode`.
    @State private var shown: String
    /// The segment the last answer was given on: its failure belongs to that segment alone.
    @State private var answeredMode: String?
    /// The fast block asks clone-or-checkout until rt says the row is answered, and again after Change.
    @State private var asking: Bool

    init(row: PlanRow, action: RowAction, badge: NeedBadge? = nil, context: String? = nil, isChecking: Bool, error: String?,
         ids: RowIDs, shown: String? = nil, fast: Bool = false) {
        self.row = row; self.action = action; self.badge = badge; self.context = context
        self.isChecking = isChecking; self.error = error; self.ids = ids; self.fast = fast
        let start = shown ?? action.mode ?? RepoPlacementState.clone
        _shown = State(initialValue: start)
        _answeredMode = State(initialValue: shown)
        _asking = State(initialValue: shown == nil && action.answered == false)
    }

    private var onRecordedMode: Bool { shown == action.mode }
    private var shownError: String? { shown == (answeredMode ?? action.mode) ? error : nil }
    /// rt's `problem` describes the recorded mode only; on the other segment it is not this path's problem.
    private var lastError: String? { shownError ?? (onRecordedMode ? action.problem : nil) }
    private var note: String? { shownError ?? (onRecordedMode ? (action.problem ?? action.note) : nil) }
    private var buttonLabel: String {
        fast ? RepoPlacementState.fastButtonLabel(mode: shown, lastError: lastError, action: action)
            : RepoPlacementState.buttonLabel(mode: shown, lastError: lastError)
    }
    private var style: RepoPlacementState.NoteStyle { RepoPlacementState.noteStyle(action: action, shown: shown, lastError: shownError) }

    var body: some View {
        if fast { fastBody } else { checklistBody }
    }

    /// P5b's repo block (setup.pen QA1, QA2): the clone-or-checkout question alone until it has an answer, then only
    /// what that answer needs. Finder opens only from its own button, never from picking an answer.
    private var fastBody: some View {
        VStack(alignment: .leading, spacing: asking ? 8 : 6) {
            fastHead
            if asking {
                choiceTiles
                if lastError != nil { fastNote }
            } else {
                answerControls
                fastNote
            }
        }
        // Behind the block, so the 1-point probe adds no stack gap under the note.
        .background(alignment: .topLeading) { RowStatusProbe(row: row, isChecking: isChecking, id: ids.status(row.id)) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(ids.row(row.id))
        .onChange(of: action.mode) { _, mode in if let mode { shown = mode } }
        .onChange(of: action.answered) { _, answered in if answered == true { asking = false } }
    }

    private var fastHead: some View {
        HStack(spacing: 8) {
            Text(action.repo ?? row.title).font(.system(size: 13, weight: FastTheme.weight(css: .semibold))).foregroundColor(FastTheme.textPrimary)
                .lineLimit(1).layoutPriority(1)
            if !row.why.isEmpty {
                Text(row.why).font(.system(size: 11)).foregroundColor(FastTheme.textTertiary).lineLimit(1).truncationMode(.middle)
            }
            Spacer(minLength: 8)
            if isChecking { FastSpinner() }
            if !asking {
                Text(shown == RepoPlacementState.clone ? Self.cloneAnswer : Self.checkoutAnswer)
                    .font(.system(size: 11, weight: FastTheme.weight(css: .medium))).foregroundColor(FastTheme.textSecondary)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(FastTheme.divider))
                    .fixedSize()
                Button("Change") { asking = true }
                    .buttonStyle(.plain)
                    .font(.system(size: 11, weight: FastTheme.weight(css: .medium))).foregroundColor(FastTheme.accent)
                    .fixedSize()
                    .disabled(isChecking)
                    .accessibilityIdentifier(ids.segment(row.id) + ".change")
            }
        }
    }

    static let cloneAnswer = "Clone fresh"
    static let checkoutAnswer = "Already on this Mac"

    private var choiceTiles: some View {
        HStack(spacing: 8) {
            Button { chooseClone() } label: {
                RepoChoiceTile(symbol: "arrow.down.circle", title: "Clone it fresh",
                               detail: action.clonePath.map { "Into \(FormRowView.displayPath($0))" } ?? "Pick where it goes")
            }
            .accessibilityIdentifier(ids.segment(row.id) + ".clone")
            Button { chooseCheckout() } label: {
                RepoChoiceTile(symbol: "folder", title: "Already on this Mac", detail: "Point to your checkout")
            }
            .accessibilityIdentifier(ids.segment(row.id) + ".checkout")
        }
        .buttonStyle(RepoChoiceTileStyle())
        .disabled(isChecking)
    }

    @ViewBuilder private var answerControls: some View {
        let path = RepoPlacementState.path(mode: shown, action: action)
        if shown == RepoPlacementState.checkout, path == nil {
            Button { pick(RepoPlacementState.checkout) } label: {
                HStack(spacing: 6) {
                    Image(systemName: "folder").font(.system(size: 11))
                    Text("Choose its folder…")
                }
            }
            .buttonStyle(FastSecondaryButtonStyle(shape: .slim))
            .fixedSize()
            .disabled(isChecking)
            .accessibilityIdentifier(ids.action(row.id))
        } else {
            HStack(spacing: 8) {
                FastValueField(value: path.map(FormRowView.displayPath), placeholder: "No checkout chosen yet", size: .slim)
                Button(buttonLabel) { pick(shown) }
                    .buttonStyle(FastSecondaryButtonStyle(shape: .slim))
                    .fixedSize()
                    .disabled(isChecking)
                    .accessibilityIdentifier(ids.action(row.id))
                // Before an answer rt's one click is "Clone it fresh"; after one it is a Retry.
                if action.answered != false, let oneClick = action.oneClick {
                    Button(oneClick.label) { record(oneClick.mode, oneClick.path) }
                        .buttonStyle(FastPrimaryButtonStyle(size: .small, shape: .slim))
                        .fixedSize()
                        .disabled(isChecking)
                        .accessibilityIdentifier(ids.oneClick(row.id))
                }
            }
        }
    }

    private func chooseClone() {
        asking = false
        if let path = action.clonePath { record(RepoPlacementState.clone, path) } else { pick(RepoPlacementState.clone) }
    }

    /// A checkout rt already found is the answer; otherwise the folder button waits for the member's click.
    private func chooseCheckout() {
        asking = false
        shown = RepoPlacementState.checkout
        if let path = action.checkoutPath { record(RepoPlacementState.checkout, path) }
    }

    /// rt's note in its style, with the board line joined on when the checkout is found (P5b's
    /// "Found your checkout. The board starts here"); on any other note the board line stands alone.
    @ViewBuilder private var fastNote: some View {
        let noteID = shownError != nil ? ids.error(row.id) : ids.row(row.id) + ".note"
        let board = action.board.flatMap { $0.isEmpty ? nil : $0 }
        if let note, !note.isEmpty {
            Group {
                switch style {
                case .ok: FastDoneLine(board.map { Self.joined(note, $0) } ?? note, textWidth: FormRowStyle.hintWidth)
                case .problem: FastHint(note, symbol: "exclamationmark.circle", tint: FastTheme.warning, textWidth: FormRowStyle.hintWidth)
                case .secondary: FastHint(note, textWidth: FormRowStyle.hintWidth)
                }
            }
            .hintSpill()
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(noteID)
        }
        if let board, style != .ok || (note ?? "").isEmpty {
            FastHint(board, textWidth: FormRowStyle.hintWidth).hintSpill()
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(ids.row(row.id) + ".board")
        }
    }

    static func joined(_ note: String, _ board: String) -> String {
        let stop = note.last.map { ".!?".contains($0) } ?? true
        return stop ? "\(note) \(board)" : "\(note). \(board)"
    }

    private var checklistBody: some View {
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
                Button(buttonLabel) { pick(shown) }
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
                    .accessibilityIdentifier(shownError != nil ? ids.error(row.id) : ids.row(row.id) + ".note")
            }
            if let board = action.board { boardLine(board) }
            RowStatusProbe(row: row, isChecking: isChecking, id: ids.status(row.id))
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(ids.row(row.id))
        .onChange(of: action.mode) { _, mode in if let mode { shown = mode } }
    }

    private func boardLine(_ text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "rectangle.3.group").foregroundStyle(Color.accentColor)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
        .font(.caption)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.accentColor.opacity(scheme == .dark ? 0.18 : 0.08)))
        .accessibilityIdentifier(ids.row(row.id) + ".board")
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

/// One answer to "where does this repo live": a symbol, the answer and a line on what it means.
private struct RepoChoiceTile: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 7) {
                Image(systemName: symbol).font(.system(size: 12))
                Text(title).font(.system(size: 12, weight: FastTheme.weight(css: .semibold)))
            }
            .foregroundColor(FastTheme.textPrimary)
            Text(detail).font(.system(size: 11)).foregroundColor(FastTheme.textSecondary)
                .lineLimit(1).truncationMode(.middle)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 11)
        .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// The path cards' hover: the outline lifts and the fill brightens a touch; nothing reads as picked.
private struct RepoChoiceTileStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        RepoChoiceTileFrame(label: configuration.label, pressed: configuration.isPressed)
    }
}

private struct RepoChoiceTileFrame<Label: View>: View {
    let label: Label
    let pressed: Bool
    @State private var hovered = false
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        let lifted = enabled && (hovered || pressed)
        label
            .background {
                shape.fill(FastTheme.fieldFill)
                if lifted { shape.fill(Color.white.opacity(0.03)) }
            }
            .overlay(shape.strokeBorder(lifted ? FastTheme.outlineHover : FastTheme.outline, lineWidth: 1))
            .opacity(enabled ? 1 : 0.5)
            .onHover { hovered = $0 }
    }
}
