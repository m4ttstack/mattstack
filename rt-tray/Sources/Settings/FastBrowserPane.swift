import SwiftUI
import MattstackCore

/// The one Settings surface for the finish gate: the extension row as the
/// checklist shows it, and the way back from a Skip for now.
struct FastBrowserPane: View {
    let env: SettingsEnvironment
    @ObservedObject private var readiness: ReadinessModel
    @State private var steps: (title: String, steps: [String])?
    @State private var busy = false
    @State private var error: String?

    private static let rowId = "tool.fast-browser-extension"

    init(env: SettingsEnvironment) { self.env = env; self.readiness = env.readiness }

    var body: some View {
        Form {
            Section("Chrome extension") {
                if let row = readiness.row(Self.rowId) {
                    RowView(row: row, isChecking: readiness.checkingRowIds.contains(row.id), rowID: AXID.settingsFastBrowserRow,
                            actionID: AXID.settingsFastBrowserRowAction, statusID: AXID.settingsFastBrowserRowStatus) { show(row) }
                    if row.isWaived {
                        HStack {
                            Text("Skipped on this Mac").font(.caption).accessibilityIdentifier(AXID.settingsFastBrowserSkipped)
                            Spacer()
                            Button(busy ? "Un-skipping…" : "Un-skip") { unskip() }
                                .disabled(busy)
                                .accessibilityIdentifier(AXID.settingsFastBrowserUnskip)
                        }
                    }
                } else if let e = readiness.lastError {
                    Text("Couldn't read the checklist: \(e)").font(.caption).foregroundStyle(.red)
                } else {
                    Text(readiness.isLoading ? "Checking…" : "No extension row in this checklist.").foregroundStyle(.secondary)
                }
                if let error {
                    Text(error).font(.caption).foregroundStyle(.red).accessibilityIdentifier(AXID.settingsFastBrowserError)
                } else if readiness.lastRefreshFailed, let e = readiness.lastError {
                    Text("Couldn't re-read the checklist: \(e)").font(.caption).foregroundStyle(.red).accessibilityIdentifier(AXID.settingsFastBrowserError)
                }
            }
        }
        .formStyle(.grouped)
        .task { await readiness.refreshUnlessLoading() }
        // Add to Chrome leaves for the Web Store; coming back is when the extension may have landed.
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await readiness.refreshUnlessLoading() }
        }
        .sheet(isPresented: Binding(get: { steps != nil }, set: { presented in
            guard !presented else { return }
            steps = nil
            Task { await readiness.recheckAll() }
        })) {
            if let steps { StepsSheet(title: steps.title, steps: steps.steps) }
        }
    }

    private func show(_ row: PlanRow) {
        guard let action = row.action else { return }
        switch RowActionDispatcher.dispatch(action, fieldValues: nil, alternative: nil) {
        case .openURL(let url): NSWorkspace.shared.open(url)
        case .showSteps(let list): steps = (title: row.title, steps: list)
        default: break
        }
    }

    /// The verb is awaited; the re-read is not, so a slow or hung plan can
    /// never pin the button. The pane renders whatever `readiness` says once
    /// it lands, including its error line above.
    private func unskip() {
        busy = true
        error = nil
        Task {
            error = await env.waivers.unwaive(Self.rowId)
            busy = false
            if error == nil { await readiness.recheckAll() }
        }
    }
}
