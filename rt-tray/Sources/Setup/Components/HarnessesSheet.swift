import SwiftUI
import MattstackCore

/// The agent-apps row's picker: a checkbox card per app rt offers and, once
/// two or more are on, a default among them. `onSave` runs the draft's argv
/// and returns nil or rt's failure copy, which stays in the sheet.
struct HarnessesSheet: View {
    let title: String
    let subtitle: String?
    let footnote: String?
    let onSave: ([String]) async -> String?

    @State private var draft: HarnessChoiceDraft
    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    init?(row: PlanRow, onSave: @escaping ([String]) async -> String?) {
        guard let action = row.action, let draft = HarnessChoiceDraft(action: action) else { return nil }
        self.title = row.title
        self.subtitle = action.subtitle
        self.footnote = action.footnote
        self.onSave = onSave
        _draft = State(initialValue: draft)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.padding(24)
            Divider()
            VStack(alignment: .leading, spacing: 10) {
                ForEach(draft.options, id: \.id) { optionCard($0) }
                if draft.enabled.count > 1 { defaultPicker.padding(.top, 6) }
            }
            .padding(24)
            if let error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 24).padding(.bottom, 12)
                    .accessibilityIdentifier(AXID.harnessesError)
            }
            Divider()
            footer.padding(.horizontal, 24).padding(.vertical, 16)
        }
        .frame(width: 560)
        .background(Color(nsColor: .windowBackgroundColor))
        .onChange(of: draft) { _, _ in error = nil }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.harnessesSheet)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "person.2.badge.gearshape")
                .font(.system(size: 28))
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.title2.bold())
                if let subtitle {
                    Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func optionCard(_ o: ChooseOption) -> some View {
        let on = draft.isOn(o.id)
        return Button { draft.toggle(o.id) } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: on ? "checkmark.square.fill" : "square")
                    .foregroundStyle(on ? Color.accentColor : Color.secondary)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 4) {
                    Text(o.label).font(.headline)
                    Text(o.detail).font(.callout).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(on ? Color.accentColor : Color.clear, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityIdentifier(AXID.harnessesOption(o.id))
        .accessibilityAddTraits(on ? [.isSelected] : [])
    }

    private var defaultPicker: some View {
        Picker("Default for rt agent", selection: Binding(get: { draft.defaultHarness }, set: { draft.setDefault($0) })) {
            if draft.defaultHarness == nil { Text("Not chosen").tag(String?.none) }
            ForEach(draft.options.filter { draft.isOn($0.id) }, id: \.id) { Text($0.label).tag(Optional($0.id)) }
        }
        .pickerStyle(.menu)
        .fixedSize()
        .disabled(busy)
        .accessibilityIdentifier(AXID.harnessesDefault)
    }

    private var footer: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            if let footnote {
                Text(footnote).font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 12)
            Button("Cancel") { dismiss() }
                .keyboardShortcut(.cancelAction)
                .disabled(busy)
                .accessibilityIdentifier(AXID.harnessesCancel)
            Button(busy ? "Saving…" : "Save") { submit() }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(busy)
                .accessibilityIdentifier(AXID.harnessesSubmit)
        }
    }

    private func submit() {
        guard !busy else { return }
        busy = true
        error = nil
        let args = draft.args
        Task { @MainActor in
            let failure = await onSave(args)
            busy = false
            if let failure { error = failure } else { dismiss() }
        }
    }
}
