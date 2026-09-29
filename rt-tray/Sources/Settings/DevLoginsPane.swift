import SwiftUI
import MattstackCore

/// Saved dev logins. No control here ever reveals a saved password.
struct DevLoginsPane: View {
    let env: SettingsEnvironment
    @ObservedObject private var model: DevLoginsModel
    @State private var sheetTarget: SheetTarget?
    @State private var linkQueue = DevLoginLinkQueue()
    @State private var confirmDelete: String?
    @State private var actionError: String?

    private struct SheetTarget: Identifiable { let origin: String?; var email = ""; var id: String { origin ?? "new" } }

    init(env: SettingsEnvironment) { self.env = env; self.model = env.devLogins }

    var body: some View {
        Form {
            Section {
                if model.rows.isEmpty {
                    if model.loaded {
                        emptyState
                    } else if model.error == nil {
                        Text("Loading…").foregroundStyle(.secondary)
                    }
                }
                ForEach(model.rows) { row in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(row.origin).font(.body.monospaced())
                            HStack(spacing: 8) {
                                Text(row.email)
                                Text("••••••").fontWeight(.black).tracking(1).accessibilityLabel("Password saved")
                            }
                            .font(.callout)
                            .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Edit…") { open(row.origin, email: row.email) }
                            .accessibilityIdentifier(AXID.settingsDevLoginsReplace(row.origin))
                        Button("Delete…", role: .destructive) { actionError = nil; confirmDelete = row.origin }
                            .accessibilityIdentifier(AXID.settingsDevLoginsDelete(row.origin))
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier(AXID.settingsDevLoginsRow(row.origin))
                }
                if let e = actionError ?? model.error {
                    Text(e).font(.caption).foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier(AXID.settingsDevLoginsError)
                }
                HStack {
                    Spacer()
                    Button("Add a dev login…") { open(nil) }.accessibilityIdentifier(AXID.settingsDevLoginsAdd)
                }
            } header: {
                Text("Saved logins")
            } footer: {
                Text("Saved encrypted on this Mac. A saved password is never shown again; edit or delete it here.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .task { await model.load() }
        .onReceive(model.$addRequest.compactMap { $0 }) { origin in
            model.addRequest = nil
            if let now = linkQueue.arrive(origin, sheetPresented: sheetTarget != nil) { open(now) }
        }
        .sheet(item: $sheetTarget, onDismiss: {
            if let held = linkQueue.sheetDismissed() { open(held) }
        }) { target in
            DevLoginSheet(fixedOrigin: target.origin, email: target.email, isSaved: { model.isSaved($0) }) { origin, email, password in
                await model.save(origin: origin, email: email, password: password)
            }
        }
        .alert("Delete the dev login for \(confirmDelete ?? "")?", isPresented: Binding(
            get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } })) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                guard let origin = confirmDelete else { return }
                Task { actionError = await model.remove(origin: origin) }
            }
        } message: {
            Text("Browser runs will stop filling it in, and ask you to log in instead.")
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("No dev logins yet").font(.headline).foregroundStyle(.primary)
            Text("A dev login is an email and password for a dev or test site. When a browser run reaches that site's login page, it fills the login in for you instead of stopping to ask.")
            Text("Use a password made only for the dev site, never one you use anywhere else.")
        }
        .font(.callout)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AXID.settingsDevLoginsEmpty)
    }

    private func open(_ origin: String?, email: String = "") {
        actionError = nil
        sheetTarget = SheetTarget(origin: origin, email: email)
    }
}
