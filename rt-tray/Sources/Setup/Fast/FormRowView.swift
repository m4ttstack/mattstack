import AppKit
import SwiftUI
import MattstackCore

typealias FormRowPerform = (FormRow, [String: String]?, String?) -> Void

private struct FormRowsRunningKey: EnvironmentKey {
    static let defaultValue: Set<String> = []
}

private struct FastLinkIconKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// `FormActionRunner.running`: rows whose rt verb has not answered yet.
    var formRowsRunning: Set<String> {
        get { self[FormRowsRunningKey.self] }
        set { self[FormRowsRunningKey.self] = newValue }
    }

    /// P3 draws an external-link glyph after Create token; P5 does not.
    var fastLinkIcon: Bool {
        get { self[FastLinkIconKey.self] }
        set { self[FastLinkIconKey.self] = newValue }
    }
}

/// The mocks' row layouts. `tile` is P1's: an icon tile, title and
/// subtext, the control or status trailing. `labelled` is P3, P5, P5b and
/// P5s: a 120-point label column, then the control with its words beside it
/// or a hint line under it. `stacked` is P3c's form, outside any card: the
/// label above the control, with the large field.
enum FormRowStyle {
    case tile, labelled, stacked

    static let labelWidth: CGFloat = 120
    static let labelGap: CGFloat = 16
    /// The words of P5b's wrapped settings note; every hint line's words wrap at the same width.
    static let hintWidth: CGFloat = 440
    /// P5b's 440 note runs 7.5 past the control column into the row's trailing padding, so a labelled hint may too.
    static let hintOverhang: CGFloat = 8
}

extension View {
    /// Lets a labelled hint line take `FormRowStyle.hintOverhang` of the row's trailing padding.
    func hintSpill(_ on: Bool = true) -> some View {
        padding(.trailing, on ? -FormRowStyle.hintOverhang : 0)
    }
}

/// P5's label column beside a column of controls, at the mock's row padding.
struct FastLabelledRow<Control: View>: View {
    let label: String?
    @ViewBuilder let control: Control

    var body: some View {
        HStack(alignment: .top, spacing: FormRowStyle.labelGap) {
            Text(label ?? "")
                .font(.system(size: 13, weight: FastTheme.weight(css: .semibold)))
                .foregroundColor(FastTheme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(width: FormRowStyle.labelWidth, alignment: .leading)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 6) { control }
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 14).padding(.horizontal, 18)
    }
}

/// P3c's form field: a quiet label above its control.
struct FastStackedRow<Control: View>: View {
    let label: String
    @ViewBuilder let control: Control

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 12, weight: FastTheme.weight(css: .semibold)))
                .foregroundColor(FastTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            control
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One fast-setup question: rt sends the row's state and action, and `waiting`
/// and `error` are the app's own overlays from `FormActionRunner`. Neither
/// overlay hides the control, so a wait that outlives rt's read can be retried;
/// only a verb still running holds its button.
struct FormRowView: View {
    static let needsNewerApp = "Needs a newer mattstack"
    let row: FormRow
    let waiting: String?
    let error: String?
    var style: FormRowStyle = .labelled
    /// A tile row whose title repeats the card's draws only its subtext.
    var showsTitle = true
    /// A place-repo row inside a card's "Your repos" group: the card draws the label column around it.
    var bare = false
    let onAction: FormRowPerform
    @Environment(\.formRowsRunning) private var runningRows

    var body: some View {
        if let action = row.action, action.type == .placeRepo {
            repoBlock(action)
        } else {
            Group {
                switch style {
                case .tile: tile
                case .labelled: FastLabelledRow(label: row.title) { labelledControl }
                case .stacked: FastStackedRow(label: row.title) { VStack(alignment: .leading, spacing: 6) { labelledControl } }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(AXID.fastRow(row.id))
        }
    }

    @ViewBuilder private func repoBlock(_ action: RowAction) -> some View {
        let block = RepoPlacementRow(row: FormRowPlan.planRow(row), action: action,
                                     isChecking: row.state == .busy || waiting != nil, error: error, ids: .fast, fast: true)
            .environment(\.repoPlacementAnswer) { _, mode, path in onAction(row, ["mode": mode, "path": path], nil) }
        if bare {
            block
        } else if style == .labelled {
            FastLabelledRow(label: nil) { block }
        } else {
            block.padding(FastTheme.rowInsets)
        }
    }

    // MARK: Tile (P1)

    private var tile: some View {
        HStack(alignment: .center, spacing: 14) {
            FastIconTile(symbol: Self.tileSymbol(row.id), done: row.state == .done && row.tone != .off)
            VStack(alignment: .leading, spacing: 3) {
                if showsTitle {
                    Text(row.title).font(.system(size: 14, weight: FastTheme.weight(css: .semibold))).foregroundColor(FastTheme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !row.subtext.isEmpty {
                    Text(row.subtext).font(.system(size: 12))
                        .foregroundColor(showsTitle ? FastTheme.textSecondary : FastTheme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                // Under the words, not trailing: a long wait line wraps here and leaves the subtext its one line.
                tileProgress.padding(.top, 3)
                notes.padding(.top, 3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            tileTrailing.layoutPriority(1)
        }
        .padding(FastTheme.rowInsets)
    }

    /// P1's glyph for each macOS row; rows the mock never drew take a neutral gear.
    static func tileSymbol(_ id: String) -> String {
        switch id {
        case "perm.fda": return "internaldrive"
        case "perm.notifications", "notifications": return "bell"
        case "mac.fancy-urls": return "globe"
        default: return "gearshape"
        }
    }

    @ViewBuilder private var tileTrailing: some View {
        if let action = row.action, let options = FormRowChoice.segments(action) {
            choice(action, options)
        } else if let action = row.action, FormRowFields.collects(action) {
            VStack(alignment: .trailing, spacing: 6) {
                tileStatus
                FormRowFields(row: row, action: action, onAction: onAction).frame(width: 280)
            }
        } else {
            HStack(spacing: 10) {
                tileStatus
                if let action = row.action { button(action) }
            }
        }
    }

    @ViewBuilder private var tileStatus: some View {
        if progressLine == nil && row.state == .done {
            doneMark(size: 13, iconSize: 16, weight: FastTheme.weight(css: .semibold))
                .modifier(CappedWidth(max: 240))
        }
    }

    @ViewBuilder private var tileProgress: some View {
        if let line = progressLine {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                FastSpinner().alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
                Text(line).font(.system(size: 12)).foregroundColor(FastTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(AXID.fastRowWaiting(row.id))
        }
    }

    // MARK: Labelled (P3, P5, P5b, P5s)

    @ViewBuilder private var labelledControl: some View {
        if let action = row.action, let options = FormRowChoice.segments(action) {
            HStack(spacing: 10) {
                choice(action, options)
                if let line = progressLine { inlineProgress(line) }
            }
            subtextHint
        } else if let action = row.action, FormRowFields.collects(action) {
            if row.state == .done && progressLine == nil { doneMark(size: 11, iconSize: 13, spacing: 10) }
            FormRowFields(row: row, action: action, large: style == .stacked, onAction: onAction)
            if let line = progressLine { inlineProgress(line) }
            subtextHint
        } else if let action = row.action, action.type == .chooseFolder {
            HStack(spacing: 8) {
                FastValueField(value: row.state == .done ? Self.displayPath(row.detail) : nil,
                               placeholder: Self.displayPath(action.startAt ?? ""))
                    .accessibilityElement(children: .combine)
                    // A finished folder row draws no check, so its done id rides on the value.
                    .modifier(FastAXID(id: row.state == .done ? AXID.fastRowDone(row.id) : nil))
                button(action)
            }
            if let line = progressLine { inlineProgress(line) }
            subtextHint
        } else if row.state == .done && progressLine == nil {
            HStack(spacing: 10) {
                doneMark(size: 11, iconSize: 13, spacing: 10)
                if let action = row.action { button(action) }
            }
        } else {
            BesideOrBelow {
                HStack(spacing: 10) {
                    if let line = progressLine {
                        FastBusyChip(text: line)
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier(AXID.fastRowWaiting(row.id))
                    }
                    if let action = row.action { button(action) }
                }
                if !row.subtext.isEmpty {
                    Text(row.subtext).font(.system(size: 11)).foregroundColor(FastTheme.textTertiary)
                }
            }
        }
        notes
    }

    @ViewBuilder private var subtextHint: some View {
        if !row.subtext.isEmpty {
            FastHint(row.subtext, textWidth: FormRowStyle.hintWidth).hintSpill(style == .labelled)
        }
    }

    private func inlineProgress(_ line: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            FastSpinner().alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
            Text(line).font(.system(size: 11)).foregroundColor(FastTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: FormRowStyle.hintWidth, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AXID.fastRowWaiting(row.id))
    }

    /// A path rt sends in full, shortened under the home folder as the mocks draw it.
    static func displayPath(_ path: String) -> String {
        path.hasPrefix("/") ? (path as NSString).abbreviatingWithTildeInPath : path
    }

    // MARK: Shared

    /// rt's reason on a todo row, then the app's refusal, each a hint line under the control.
    @ViewBuilder private var notes: some View {
        if let reason {
            FastHint(reason, textWidth: FormRowStyle.hintWidth).hintSpill(style == .labelled)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AXID.fastRowReason(row.id))
        }
        if let error, !error.isEmpty {
            FastHint(error, symbol: "exclamationmark.circle", tint: FastTheme.warning, textWidth: FormRowStyle.hintWidth)
                .hintSpill(style == .labelled)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AXID.fastRowError(row.id))
        }
    }

    /// rt's word on why a row still waits on the person. While its action runs, the spinner's line says it instead.
    private var reason: String? {
        guard row.state == .todo, waiting == nil, !row.detail.isEmpty else { return nil }
        return row.detail
    }

    /// The line a spinner carries while anything runs.
    private var progressLine: String? {
        if let waiting { return waiting }
        guard row.state == .busy || row.state == .waiting else { return nil }
        return row.detail.isEmpty ? row.waiting : row.detail
    }

    /// Never beside a segment: the segment already reads as the answer. An answer of no (rt's `off` tone) draws a grey dash.
    private func doneMark(size: CGFloat, iconSize: CGFloat, weight: Font.Weight = .regular, spacing: CGFloat = 6) -> some View {
        Group {
            if row.tone == .off {
                HStack(alignment: .firstTextBaseline, spacing: spacing) {
                    Image(systemName: "minus").font(.system(size: size, weight: .regular))
                    if !row.detail.isEmpty {
                        Text(row.detail).font(.system(size: size, weight: weight)).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .foregroundColor(FastTheme.textTertiary)
            } else {
                FastDoneLine(row.detail, size: size, weight: weight, spacing: spacing, iconSize: iconSize)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AXID.fastRowDone(row.id))
    }

    private func choice(_ action: RowAction, _ options: [ChooseOption]) -> some View {
        FormRowChoice(row: row, action: action, options: options, disabled: row.state == .busy || waiting != nil,
                      error: error, onAction: onAction)
    }

    /// The glyph P5 draws on each sign-in button; other rows' buttons are words only.
    static func buttonSymbol(_ id: String) -> String? {
        switch id {
        case "slack": return "message"
        case "claude": return "arrow.right.to.line"
        case "fast-browser": return "puzzlepiece.extension"
        default: return nil
        }
    }

    @ViewBuilder private func button(_ action: RowAction) -> some View {
        let retry = row.state == .waiting || waiting != nil
        let label = retry ? (action.again ?? action.label) : action.label
        switch action.type {
        case _ where FormActionRunner.control(for: action) == .none:
            // A button that does nothing would read as a way on; the row still holds the footer until rt reads it done.
            Text(Self.needsNewerApp).font(.system(size: 12)).foregroundColor(FastTheme.textSecondary).fixedSize()
                .accessibilityIdentifier(AXID.fastRowAction(row.id))
        case .chooseFolder:
            Button(label) { chooseFolder(action) }
                .buttonStyle(FastSecondaryButtonStyle())
                .fixedSize().accessibilityIdentifier(AXID.fastRowAction(row.id))
        default:
            // A second press of a running `setup apply` would raise a second admin prompt.
            let applying = runningRows.contains(row.id) || (waiting != nil && RowVerbRun.streamsApplyEvents(action.verb ?? []))
            let quiet = retry || row.state == .done
            Group {
                switch (style, quiet) {
                case (.tile, false):
                    Button(label) { onAction(row, nil, nil) }.buttonStyle(FastPrimaryButtonStyle(size: .small))
                case (.labelled, false), (.stacked, false):
                    Button { onAction(row, nil, nil) } label: {
                        if let symbol = Self.buttonSymbol(row.id), let glyph = FastLucideGlyph(symbol: symbol, box: 13) {
                            Label { Text(label) } icon: { glyph }
                        } else {
                            Text(label)
                        }
                    }
                    .buttonStyle(FastOutlineButtonStyle())
                case (_, true):
                    Button(label) { onAction(row, nil, nil) }.buttonStyle(FastSecondaryButtonStyle())
                }
            }
            .fixedSize().disabled(applying)
            .accessibilityIdentifier(AXID.fastRowAction(row.id))
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
/// A row with a create link shows that link beside the empty field, as P3 and P5 do, and gains its submit
/// button once every field holds a value; a row without one always shows the submit button.
struct FormRowFields: View {
    let row: FormRow
    let action: RowAction
    /// P3c's large field, with its buttons at the field's height.
    var large = false
    let onAction: FormRowPerform
    @State private var values: [String: String]
    @Environment(\.openSetupLink) private var openLink
    @Environment(\.formRowsRunning) private var runningRows
    @Environment(\.fastLinkIcon) private var linkIcon

    static func collects(_ action: RowAction) -> Bool {
        [.connect, .form, .ownerOnce].contains(action.type) && !(action.fields ?? []).isEmpty
    }

    init(row: FormRow, action: RowAction, large: Bool = false, onAction: @escaping FormRowPerform) {
        self.row = row; self.action = action; self.large = large; self.onAction = onAction
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
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(fields.enumerated()), id: \.element.name) { index, field in
                HStack(spacing: 8) {
                    input(field)
                    if index == fields.count - 1 { trailing }
                }
            }
            if let alternatives = action.alternatives, !alternatives.isEmpty {
                HStack(spacing: 8) {
                    ForEach(alternatives, id: \.id) { alt in
                        Button(alt.label) { onAction(row, nil, alt.id) }
                            .buttonStyle(FastSecondaryButtonStyle())
                            .fixedSize()
                            .accessibilityIdentifier(AXID.fastRowAction(row.id, alt.id))
                    }
                }
            }
        }
    }

    @ViewBuilder private var trailing: some View {
        let link = create.flatMap { link in URL(string: link.url).map { (link.label, $0) } }
        if link == nil || complete {
            Button(action.label, action: submit)
                .buttonStyle(FastPrimaryButtonStyle(size: .small, shape: large ? .besideLargeField : nil))
                .disabled(!complete || runningRows.contains(row.id)).fixedSize()
                .accessibilityIdentifier(AXID.fastRowAction(row.id))
        }
        if let link {
            Button { openLink(link.1) } label: {
                HStack(spacing: 6) {
                    Text(link.0)
                    if linkIcon { Image(systemName: "arrow.up.right.square").font(.system(size: 12, weight: .regular)) }
                }
            }
            .buttonStyle(FastSecondaryButtonStyle(shape: large ? .besideLargeField : nil))
            .fixedSize()
            .accessibilityIdentifier(AXID.fastRowAction(row.id, "link"))
        }
    }

    private func input(_ field: ActionField) -> some View {
        FastField(field.label, text: binding(field.name), size: large ? .large : .compact, monospaced: field.secret, secure: field.secret,
                  id: fields.count == 1 ? AXID.fastRowField(row.id) : AXID.fastRowField(row.id, field.name))
            .onSubmit(submit)
            // rt's hint is a format note (a forge token's scopes, a key's prefix), not screen copy: the mocks show none.
            .help(field.hint ?? "")
    }

    private func submit() {
        guard complete else { return }
        onAction(row, values, nil)
    }

    private func binding(_ name: String) -> Binding<String> {
        Binding(get: { values[name] ?? "" }, set: { values[name] = $0 })
    }
}

/// A two-option `choose` drawn as the mocks' segmented control; picking records at once.
struct FormRowChoice: View {
    let row: FormRow
    let action: RowAction
    let options: [ChooseOption]
    let disabled: Bool
    let error: String?
    let onAction: FormRowPerform
    @State private var shown: String

    /// Only a plain pick of two fits a segment; anything wider keeps rt's own sheet.
    static func segments(_ action: RowAction) -> [ChooseOption]? {
        guard action.type == .choose, action.other == nil, let options = action.options, options.count == 2 else { return nil }
        return options
    }

    init(row: FormRow, action: RowAction, options: [ChooseOption], disabled: Bool, error: String?, onAction: @escaping FormRowPerform) {
        self.row = row; self.action = action; self.options = options
        self.disabled = disabled; self.error = error; self.onAction = onAction
        _shown = State(initialValue: action.selected ?? "")
    }

    var body: some View {
        let selection = Binding(get: { shown }, set: { picked in
            shown = picked
            if picked != action.selected { onAction(row, ["id": picked], nil) }
        })
        FastSegmented(options: options.map { (id: $0.id, label: $0.label) }, selection: selection)
            .disabled(disabled)
            // Scripts read the row by a radio group's role, which the drawn buttons do not have.
            .accessibilityRepresentation {
                Picker(row.title, selection: selection) {
                    ForEach(options, id: \.id) { Text($0.label).tag($0.id) }
                }
                .pickerStyle(.segmented)
                .disabled(disabled)
            }
            .accessibilityIdentifier(AXID.fastRowAction(row.id))
            .onChange(of: action.selected) { _, selected in if let selected { shown = selected } }
            // A refused pick puts the segment back on what rt has recorded.
            .onChange(of: error) { _, error in if error != nil { shown = action.selected ?? "" } }
    }
}

/// The controls with their words beside them when the line has room (P5's
/// "Connect Slack  Lets mattstack…"), else the words wrap under them.
struct BesideOrBelow: Layout {
    var spacing: CGFloat = 10
    var lineSpacing: CGFloat = 6

    private func beside(_ width: CGFloat?, _ subviews: Subviews) -> Bool {
        guard subviews.count == 2 else { return true }
        let controls = subviews[0].sizeThatFits(.unspecified).width
        let words = subviews[1].sizeThatFits(.unspecified).width
        return controls + spacing + words <= (width ?? .infinity)
    }

    /// The controls at their own width, or narrowed to the column, where a long busy line wraps inside its chip.
    private func controlsProposal(_ width: CGFloat?, _ first: LayoutSubview) -> ProposedViewSize {
        let ideal = first.sizeThatFits(.unspecified).width
        guard let width, ideal > width else { return .unspecified }
        return ProposedViewSize(width: width, height: nil)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let first = subviews.first else { return .zero }
        let controls = first.sizeThatFits(controlsProposal(proposal.width, first))
        guard subviews.count == 2 else { return controls }
        if beside(proposal.width, subviews) {
            let words = subviews[1].sizeThatFits(.unspecified)
            return CGSize(width: controls.width + spacing + words.width, height: max(controls.height, words.height))
        }
        let width = proposal.width ?? controls.width
        let words = subviews[1].sizeThatFits(ProposedViewSize(width: width, height: nil))
        return CGSize(width: max(min(controls.width, width), words.width), height: controls.height + lineSpacing + words.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard let first = subviews.first else { return }
        let fit = controlsProposal(bounds.width, first)
        let controls = first.sizeThatFits(fit)
        guard subviews.count == 2 else {
            first.place(at: CGPoint(x: bounds.minX, y: bounds.minY), anchor: .topLeading, proposal: fit)
            return
        }
        if beside(bounds.width, subviews) {
            first.place(at: CGPoint(x: bounds.minX, y: bounds.midY), anchor: .leading, proposal: .unspecified)
            subviews[1].place(at: CGPoint(x: bounds.minX + controls.width + spacing, y: bounds.midY), anchor: .leading,
                              proposal: .unspecified)
        } else {
            first.place(at: CGPoint(x: bounds.minX, y: bounds.minY), anchor: .topLeading, proposal: fit)
            subviews[1].place(at: CGPoint(x: bounds.minX, y: bounds.minY + controls.height + lineSpacing), anchor: .topLeading,
                              proposal: ProposedViewSize(width: bounds.width, height: nil))
        }
    }
}

/// Takes only the width its content needs, up to `max`: a short line leaves the
/// subtext its room and a long one wraps. A `maxWidth` frame would claim all of `max`.
struct CappedWidth: ViewModifier {
    let max: CGFloat
    func body(content: Content) -> some View { CappedWidthLayout(max: max) { content } }
}

private struct CappedWidthLayout: Layout {
    let max: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let child = subviews.first else { return .zero }
        return child.sizeThatFits(ProposedViewSize(width: Swift.min(proposal.width ?? max, max), height: nil))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: CGPoint(x: bounds.maxX, y: bounds.midY), anchor: .trailing,
                              proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
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
    static let fast = RowIDs(row: AXID.fastRow, action: { AXID.fastRowAction($0) }, status: AXID.fastRowStatus,
                             segment: AXID.fastRowSegment, oneClick: { AXID.fastRowAction($0, "oneClick") }, error: AXID.fastRowError)
}
