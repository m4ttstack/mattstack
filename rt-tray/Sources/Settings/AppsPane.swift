import SwiftUI
import MattstackCore

struct AppsPane: View {
    let env: SettingsEnvironment
    @ObservedObject private var model: AppsSettingsModel
    @ObservedObject private var team: TeamSettingsModel
    init(env: SettingsEnvironment) { self.env = env; self.model = env.apps; self.team = env.team }

    var body: some View {
        Form {
            Section("Apps") {
                ForEach(model.apps) { app in
                    VStack(alignment: .leading, spacing: 2) {
                        Toggle(app.displayName, isOn: Binding(get: { app.enabled }, set: { on in Task { await model.setEnabled(app.name, on) } }))
                            .toggleStyle(.switch)
                            .disabled(model.inFlight.contains(app.name))
                            .accessibilityIdentifier(AXID.settingsAppToggle(app.name))
                        if let description = app.description {
                            Text(description).font(.caption).foregroundStyle(.secondary)
                        }
                        if app.requiresTeam, team.isSolo {
                            Text("Needs a team. Create or join one under Team to use this.").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if model.apps.isEmpty { Text("No apps listed. Is deck running?").foregroundStyle(.secondary) }
            }
            if let e = model.error { Text(e).font(.caption).foregroundStyle(.red) }
        }
        .formStyle(.grouped)
        .task { await model.load(); await team.load() }
    }
}
