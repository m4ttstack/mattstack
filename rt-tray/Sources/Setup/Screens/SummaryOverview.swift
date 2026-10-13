import SwiftUI
import MattstackCore

/// The summary's Overview pane: what the Installed screen carried.
struct SummaryOverview: View {
    @ObservedObject var model: DoneModel
    @ObservedObject var install: InstallRunModel
    let isOwner: Bool
    /// A solo install turns board off, so the pane points at console.
    let solo: Bool
    let onInvite: () -> Void
    let onRetry: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Group {
                    // An empty blockedRows before the first post-install check means "not known yet", so the success glyph must wait for hasConfirmedRows.
                    if !model.hasConfirmedRows {
                        ProgressView().controlSize(.large)
                    } else if isBlocked {
                        Image(systemName: headlineSymbol).symbolRenderingMode(.multicolor)
                    } else {
                        Image(systemName: headlineSymbol).foregroundStyle(allDone ? Color.green : Color.accentColor)
                    }
                }
                .font(.system(size: 30))
                VStack(alignment: .leading, spacing: 2) {
                    Text(headline).font(.title3.weight(.semibold))
                    Text(verifySummary).foregroundStyle(.secondary)
                }
            }
            if model.refreshFailed {
                HStack {
                    Text("Couldn't confirm the checklist: \(model.refreshError ?? "unknown error")")
                        .font(.callout).foregroundStyle(.red)
                        .accessibilityIdentifier(AXID.doneRefreshError)
                    Spacer()
                    Button("Try again") { Task { await model.retryCheck() } }
                        .controlSize(.small)
                        .accessibilityIdentifier(AXID.doneRetryCheck)
                }
            }
            if !install.partialSteps.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Needs another try").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(install.partialSteps) { step in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(step.info.title)
                                    if let d = step.detail, !d.isEmpty { Text(d).font(.caption).foregroundStyle(.orange) }
                                }
                                Spacer()
                                Button("Retry from here") { onRetry(step.id) }
                                    .controlSize(.small)
                                    .disabled(install.isRunning)
                                    .accessibilityIdentifier(AXID.donePartialStepRetry(step.id))
                                RowStatusProbe(status: .missing, id: AXID.donePartialStepStatus(step.id))
                            }
                            if let r = step.remedy {
                                Text(r).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier(AXID.donePartialStep(step.id))
                    }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Where things live").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                LabeledContent("Menu bar") { Text("the m icon, top right") }
                LabeledContent("Terminal") { Text("run rt in a new terminal window") }
                LabeledContent(homeApp.title) { Link(homeApp.host, destination: homeApp.url) }
            }
            HStack {
                Button("Open the \(homeApp.title.lowercased())", action: openHomeApp).accessibilityIdentifier(AXID.doneOpenBoard)
                if isOwner { Button("Invite teammates…", action: onInvite).accessibilityIdentifier(AXID.doneInvite) }
                Spacer()
            }
            .controlSize(.regular)
        }
        .padding(16)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.doneOverview)
    }

    private var isBlocked: Bool { !model.blockedRows.isEmpty }
    private var allDone: Bool { model.stillToDoRows.isEmpty && install.partialSteps.isEmpty }
    private var headline: String {
        guard model.hasConfirmedRows, !isBlocked, !install.partialSteps.isEmpty else { return model.headline }
        return FinishGate.retryHeadline(partial: install.partialSteps.count)
    }
    private var headlineSymbol: String { FinishGate.headlineSymbol(blocked: isBlocked, allDone: allDone) }

    private var verifySummary: String {
        let verify = install.steps.first { $0.id == "verify" }
        let n = install.steps.filter { $0.state == .done || $0.state == .needsYou }.count
        let partial = install.partialSteps.count
        let steps = partial == 0 ? "\(n) steps done" : "\(n) steps done, \(partial) need\(partial == 1 ? "s" : "") another try"
        return verify?.detail.map { "\($0) · \(steps)" } ?? steps
    }

    private var homeApp: (title: String, host: String, url: URL) {
        solo ? ("Console", "console.mattstack", URL(string: "https://console.mattstack")!)
             : ("Board", "board.mattstack", URL(string: "https://board.mattstack")!)
    }

    /// Stub mode never opens a real browser tab.
    private func openHomeApp() {
        guard !BundleFlavor.isStubActive else {
            TrayLog.info("open \(homeApp.host) skipped (stub mode)")
            return
        }
        NSWorkspace.shared.open(homeApp.url)
    }
}

/// Confirms a Skip for now with the cost stated. Buttons are driven by
/// their wording from the VM walkthrough, so the labels are the contract.
struct SkipConfirmSheet: View {
    @ObservedObject var model: DoneModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(FinishGate.skipSheetTitle).font(.headline)
            Text(FinishGate.skipSheetBody).fixedSize(horizontal: false, vertical: true)
            if let e = model.skipError {
                Text(e).font(.caption).foregroundStyle(.red).accessibilityIdentifier(AXID.doneSkipConfirmError)
            }
            HStack {
                Spacer()
                Button(FinishGate.skipSheetCancel) { model.cancelSkip() }
                    .keyboardShortcut(.cancelAction)
                    .disabled(model.isSkipping)
                    .accessibilityIdentifier(AXID.doneSkipConfirmCancel)
                // `role: .destructive` alone draws nothing outside an alert on
                // macOS; the prominent style plus the red tint is what shows.
                Button(FinishGate.skipSheetConfirm, role: .destructive) { Task { await model.confirmSkip() } }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .disabled(model.isSkipping)
                    .accessibilityIdentifier(AXID.doneSkipConfirmSkip)
            }
        }
        .padding(20).frame(width: 440)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.doneSkipConfirm)
    }
}
