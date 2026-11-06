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

/// P5's label column beside a column of controls. The mocks' CSS pads rows 14
/// both ways, but their picture leaves 13 under a control (a button row is 56,
/// not 57), so the bottom pads 13 and the label column keeps a done row at 48.
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
                .padding(.top, 6).padding(.bottom, 1)
            VStack(alignment: .leading, spacing: 6) { control }
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.top, 14).padding(.bottom, 13).padding(.horizontal, 18)
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
            doneMark(size: 13, iconSize: 16)
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
            // Tiles carry their own lines, so rt's longer subtext would only repeat them.
            if !FormRowChoice.tiles(options) { subtextHint }
        } else if let action = row.action, FormRowFields.collects(action) {
            if row.state == .done && progressLine == nil { doneMark(size: 13, iconSize: 14, spacing: 8) }
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
            trailingDone
        } else if row.tone == .failed && progressLine == nil {
            failedLine
        } else if row.subtext.isEmpty {
            controlsLine
        } else {
            // P5's words sit beside the controls when the line has room; else they drop below as a hint, so they
            // share the leading edge and style of the hint lines under them.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) {
                    controlsLine
                    Text(row.subtext).font(.system(size: 11)).foregroundColor(FastTheme.textTertiary).lineLimit(1).fixedSize()
                }
                VStack(alignment: .leading, spacing: 6) {
                    controlsLine
                    subtextHint
                }
            }
        }
        notes
    }

    private var failedLine: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                failedControls
                failureText.lineLimit(1).fixedSize()
            }
            VStack(alignment: .leading, spacing: 6) {
                failedControls
                failureText.fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: FormRowStyle.hintWidth, alignment: .leading)
                    .hintSpill(style == .labelled)
            }
        }
        .frame(minHeight: 28)
    }

    private var failedControls: some View {
        HStack(spacing: 10) {
            if let action = row.action { button(action) }
            if let press = row.secondaryPress, let secondary = press.action, FormActionRunner.control(for: secondary) != .none {
                FastButton(title: secondary.label, kind: .secondary(muted: true), size: .small) { onAction(press, nil, nil) }
                    .fixedSize()
                    .accessibilityIdentifier(AXID.fastRowAction(row.id, "secondary"))
            }
        }
    }

    private var failureText: some View {
        Text(row.detail).font(.system(size: 11)).foregroundColor(FastTheme.failure)
            .accessibilityIdentifier(AXID.fastRowReason(row.id))
    }

    /// A row with a button shows its progress on the button itself; a row with nothing to press keeps the busy chip.
    private var controlsLine: some View {
        HStack(spacing: 10) {
            if let action = row.action {
                button(action)
            } else if let line = progressLine {
                FastBusyChip(text: line)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier(AXID.fastRowWaiting(row.id))
            }
        }
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
        // The button carries a short working word; rt's whole progress line goes here.
        if row.action != nil, let line = progressLine {
            FastHint(line, textWidth: FormRowStyle.hintWidth).hintSpill(style == .labelled)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AXID.fastRowWaiting(row.id))
        }
        if let reason {
            FastHint(reason, textWidth: FormRowStyle.hintWidth).hintSpill(style == .labelled)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AXID.fastRowReason(row.id))
        }
        if let error = row.shownError(error) {
            FastHint(error, symbol: "exclamationmark.circle", tint: FastTheme.warning, textWidth: FormRowStyle.hintWidth)
                .hintSpill(style == .labelled)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(AXID.fastRowError(row.id))
        }
    }

    /// rt's word on why a row still waits on the person. While its action runs, the spinner's line says it instead.
    private var reason: String? {
        guard row.state == .todo, waiting == nil, !row.detail.isEmpty, row.tone != .failed else { return nil }
        return row.detail
    }

    /// The line a spinner carries while anything runs.
    private var progressLine: String? {
        if let waiting { return waiting }
        guard row.state == .busy || row.state == .waiting else { return nil }
        return row.detail.isEmpty ? row.waiting : row.detail
    }

    /// rt's words in grey and the mark at the row's end, so a card of finished rows reads as one calm column.
    /// The label's padding centres it on a 28pt control line, so this line takes that height too.
    private var trailingDone: some View {
        HStack(spacing: 12) {
            Text(row.detail).font(.system(size: 13)).foregroundColor(FastTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityHidden(true)
            if let action = row.action { button(action) }
            FastDoneDisc(off: row.tone == .off)
                .accessibilityElement()
                .accessibilityLabel(row.detail.isEmpty ? "Done" : row.detail)
                .accessibilityIdentifier(AXID.fastRowDone(row.id))
        }
        .frame(minHeight: 28)
    }

    /// Never beside a segment: the segment already reads as the answer. An answer of no (rt's `off` tone) draws a grey disc and dash.
    private func doneMark(size: CGFloat, iconSize: CGFloat, weight: Font.Weight = .regular, spacing: CGFloat = 8) -> some View {
        FastDoneLine(row.detail, size: size, weight: weight, spacing: spacing, iconSize: iconSize, off: row.tone == .off)
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
            FastButton(title: label, kind: .secondary(), size: .small) { chooseFolder(action) }
                .fixedSize().accessibilityIdentifier(AXID.fastRowAction(row.id))
        default:
            // Loading also holds off a second press: a second `setup apply` would raise a second admin prompt.
            let loading = runningRows.contains(row.id) || progressLine != nil
            let quiet = (retry || row.state == .done) && !loading
            Group {
                switch (style, quiet) {
                case (.tile, false):
                    FastButton(title: label, size: .small, isLoading: loading, loadingTitle: Self.workingLabel(label)) { onAction(row, nil, nil) }
                case (.labelled, false), (.stacked, false):
                    FastButton(title: label, glyph: rowGlyph, kind: .outline, size: .small, isLoading: loading,
                               loadingTitle: Self.workingLabel(label)) { onAction(row, nil, nil) }
                case (_, true):
                    FastButton(title: label, kind: .secondary(), size: .small) { onAction(row, nil, nil) }
                }
            }
            .fixedSize()
            .accessibilityIdentifier(AXID.fastRowAction(row.id))
        }
    }

    /// A button's short word while it works, from its own first word: "Install" reads "Installing…".
    /// A label it does not know keeps its own words.
    static func workingLabel(_ label: String) -> String {
        let first = label.split(separator: " ").first.map(String.init)?.lowercased() ?? ""
        let words: [String: String] = [
            "install": "Installing…", "connect": "Connecting…", "sign": "Signing in…", "allow": "Waiting…",
            "retry": "Retrying…", "trust": "Trusting…", "update": "Updating…", "add": "Adding…",
            "open": "Opening…", "re-check": "Checking…", "check": "Checking…", "set": "Setting up…",
            "fix": "Fixing…", "turn": "Turning on…", "create": "Creating…", "reconnect": "Connecting…",
        ]
        return words[first] ?? label
    }

    private var rowGlyph: AnyView? {
        guard let symbol = row.tone == .failed ? "arrow.counterclockwise" : Self.buttonSymbol(row.id),
              let glyph = FastLucideGlyph(symbol: symbol, box: 13) else { return nil }
        return AnyView(glyph)
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
                        FastButton(title: alt.label, kind: .secondary(), size: .small) { onAction(row, nil, alt.id) }
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
            FastButton(title: action.label, size: .small, shape: large ? .besideLargeField : nil,
                       isLoading: runningRows.contains(row.id), loadingTitle: "Checking…", action: submit)
                .disabled(!complete).fixedSize()
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
                  maskPrefix: SecretPrefix.fromHint(field.hint),
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
    /// Tiles ask until rt has an answer, and again after Change.
    @State private var asking: Bool

    /// Options that each say what they mean draw as tiles (setup.pen QB1); bare labels draw as a segment.
    static func tiles(_ options: [ChooseOption]) -> Bool {
        options.allSatisfy { !$0.detail.isEmpty }
    }

    /// Only a plain pick of two fits a segment; anything wider keeps rt's own sheet.
    static func segments(_ action: RowAction) -> [ChooseOption]? {
        guard action.type == .choose, action.other == nil, let options = action.options, options.count == 2 else { return nil }
        return options
    }

    init(row: FormRow, action: RowAction, options: [ChooseOption], disabled: Bool, error: String?, onAction: @escaping FormRowPerform) {
        self.row = row; self.action = action; self.options = options
        self.disabled = disabled; self.error = error; self.onAction = onAction
        _shown = State(initialValue: action.selected ?? "")
        _asking = State(initialValue: action.selected == nil)
    }

    var body: some View {
        if Self.tiles(options) { tileBody } else { segmentBody }
    }

    private func pick(_ id: String) {
        shown = id
        asking = false
        if id != action.selected { onAction(row, ["id": id], nil) }
    }

    @ViewBuilder private var tileBody: some View {
        let picked = options.first { $0.id == shown }
        VStack(alignment: .leading, spacing: 6) {
            if asking || picked == nil {
                HStack(spacing: 8) {
                    ForEach(options, id: \.id) { option in
                        Button { pick(option.id) } label: {
                            FastChoiceTile(symbol: nil, title: option.label, detail: option.detail, warn: option.warn == true)
                        }
                        .accessibilityIdentifier(AXID.fastRowAction(row.id) + "." + option.id)
                    }
                }
                .buttonStyle(FastChoiceTileStyle())
                .disabled(disabled)
            } else if let picked {
                FastAnswerChip(label: picked.label, changeID: AXID.fastRowAction(row.id) + ".change") { asking = true }
                    .disabled(disabled)
                if picked.warn == true {
                    FastHint(picked.detail, symbol: "exclamationmark.triangle", tint: FastTheme.warning, textWidth: FormRowStyle.hintWidth)
                }
            }
        }
        .onChange(of: action.selected) { _, selected in
            if let selected { shown = selected; asking = false }
        }
        .onChange(of: error) { _, error in if error != nil { shown = action.selected ?? ""; asking = action.selected == nil } }
    }

    private var segmentBody: some View {
        let selection = Binding(get: { shown }, set: { picked in
            shown = picked
            if picked != action.selected { onAction(row, ["id": picked], nil) }
        })
        return FastSegmented(options: options.map { (id: $0.id, label: $0.label) }, selection: selection)
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
