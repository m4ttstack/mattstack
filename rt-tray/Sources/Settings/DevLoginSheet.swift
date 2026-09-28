import SwiftUI
import MattstackCore

/// The one place a dev login's values are typed. `fixedOrigin` is set for a
/// link or a Replace; the human types the origin only for a fresh Add.
struct DevLoginSheet: View {
    let fixedOrigin: String?
    let isSaved: (String) -> Bool
    let onSave: (String, String, String) async -> String?
    @State private var originText = ""
    @State private var email: String
    @State private var password = ""
    @State private var typedHost = ""
    @State private var error: String?
    @State private var saving = false
    @Environment(\.dismiss) private var dismiss

    init(fixedOrigin: String?, email: String = "", isSaved: @escaping (String) -> Bool,
         onSave: @escaping (String, String, String) async -> String?) {
        self.fixedOrigin = fixedOrigin
        self.isSaved = isSaved
        self.onSave = onSave
        _email = State(initialValue: email)
    }

    private var validated: DevLoginOrigin.Result { DevLoginOrigin.validate(fixedOrigin ?? originText) }

    private var validOrigin: (origin: String, host: String)? {
        guard case .valid(let origin, let host) = validated else { return nil }
        return (origin, host)
    }

    private var replacing: Bool {
        DevLoginSheetCopy.replacing(fixedOrigin: fixedOrigin, typedOrigin: originText, isSaved: isSaved)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(DevLoginSheetCopy.title(replacing: replacing)).font(.headline)
            if let fixedOrigin {
                if case .invalid(let why) = validated {
                    Text("mattstack can't save a login for \(fixedOrigin). \(why)")
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier(AXID.devLoginSheetInvalid)
                } else if let origin = validOrigin?.origin {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(origin).font(.title2.monospaced()).textSelection(.enabled)
                        if replacing { replaceCaption }
                    }
                }
            } else {
                SetupField(label: "Site", note: originNote) {
                    TextField("", text: $originText)
                        .labelsHidden()
                        .accessibilityLabel("Site")
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier(AXID.devLoginSheetOrigin)
                }
                if replacing { replaceCaption }
            }
            if case .valid(let origin, let host) = validated {
                ForEach(DevLoginConfirm.warnings(origin: origin), id: \.self) { w in
                    Label(w, systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .symbolRenderingMode(.multicolor)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier(AXID.devLoginSheetWarning)
                }
                SetupField(label: "Email") {
                    TextField("", text: $email)
                        .labelsHidden()
                        .accessibilityLabel("Email")
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier(AXID.devLoginSheetEmail)
                }
                SetupField(label: "Password", note: "Use a password that only this dev site uses.") {
                    SecureField("", text: $password)
                        .labelsHidden()
                        .accessibilityLabel("Password")
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier(AXID.devLoginSheetPassword)
                }
                if !isSaved(origin) {
                    SetupField(label: "Type \(host) to confirm", note: "Browser runs will fill this login only on this exact site.") {
                        TextField("", text: $typedHost)
                            .labelsHidden()
                            .accessibilityLabel("Type \(host) to confirm")
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier(AXID.devLoginSheetConfirmHost)
                    }
                }
            }
            if let error {
                Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving).accessibilityIdentifier(AXID.devLoginSheetCancel)
                Button(saving ? "Saving…" : "Save") { save() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canSave || saving)
                    .accessibilityIdentifier(AXID.devLoginSheetSave)
            }
        }
        .padding(20)
        .frame(width: 460)
        .interactiveDismissDisabled(saving)
    }

    private var replaceCaption: some View {
        Text(DevLoginSheetCopy.replaceCaption)
            .font(.caption).foregroundStyle(.secondary)
            .accessibilityIdentifier(AXID.devLoginSheetReplaceCaption)
    }

    private var originNote: String {
        if case .invalid(let why) = validated, !originText.trimmingCharacters(in: .whitespaces).isEmpty { return why }
        return "The login page's address without a path, like https://login.example.com"
    }

    private var canSave: Bool {
        guard case .valid(let origin, let host) = validated else { return false }
        return DevLoginConfirm.canSave(host: host, typedHost: typedHost, isFirstTime: !isSaved(origin), email: email, password: password)
    }

    private func save() {
        guard let origin = validOrigin?.origin else { return }
        saving = true
        error = nil
        Task {
            error = await onSave(origin, email, password)
            saving = false
            if error == nil { password = ""; dismiss() }
        }
    }
}
