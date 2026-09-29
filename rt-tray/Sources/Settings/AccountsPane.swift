import SwiftUI
import MattstackCore

/// The checklist's Accounts group, with the same Connect actions, so an
/// account verify fails on can be fixed after Setup has closed.
struct AccountsPane: View {
    let env: SettingsEnvironment

    var body: some View {
        ChecklistScreen(model: env.readiness, permissions: env.permissions, rt: env.rt, needs: env.needs, scope: .accounts)
            .task { await env.readiness.refreshUnlessLoading() }
    }
}
