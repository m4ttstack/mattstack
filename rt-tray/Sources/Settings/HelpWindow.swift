import AppKit
import SwiftUI
import MattstackCore

/// Ask Maude…: a request to the org's support host, and where it has got to.
@MainActor
final class HelpWindow: NSObject, NSWindowDelegate {
    private let model: HelpRequestModel
    private var window: NSWindow?
    private var poll: Task<Void, Never>?

    init(model: HelpRequestModel) { self.model = model }

    func show() {
        let w = window ?? make()
        w.title = "Ask \(model.availability.bot)"
        if !w.isVisibleOrAppHidden {
            w.center()
            Task { await model.opened() }
        }
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        poll?.cancel()
        poll = Task { [model] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(4))
                if Task.isCancelled { return }
                await model.refreshRequests()
            }
        }
    }

    func windowWillClose(_ notification: Notification) {
        poll?.cancel()
        poll = nil
    }

    private func make() -> NSWindow {
        let host = NSHostingController(rootView: HelpWindowContent(model: model) { [weak self] in self?.window?.close() })
        host.sizingOptions = [.preferredContentSize]
        let w = NSWindow(contentViewController: host)
        w.styleMask = [.titled, .closable, .miniaturizable]
        w.isReleasedWhenClosed = false
        w.delegate = self
        window = w
        return w
    }
}

private struct HelpWindowContent: View {
    @ObservedObject var model: HelpRequestModel
    let close: () -> Void

    var body: some View {
        HelpForm(
            availability: model.availability,
            text: $model.text,
            parts: model.parts,
            partsFailed: model.partsFailed,
            left: model.left,
            isSending: model.isSending,
            canSend: model.canSend,
            card: model.card,
            cardText: model.cardText,
            actions: HelpFormActions(
                toggle: model.toggle,
                reloadParts: { Task { await model.loadParts() } },
                send: { Task { await model.send() } },
                askAgain: model.askAgain,
                showIt: model.showIt,
                close: close
            )
        )
    }
}

struct HelpFormActions {
    var toggle: (HelpPart) -> Void = { _ in }
    var reloadParts: () -> Void = {}
    var send: () -> Void = {}
    var askAgain: () -> Void = {}
    var showIt: () -> Void = {}
    var close: () -> Void = {}
}

/// The window as a function of its state, so a snapshot can draw it.
struct HelpForm: View {
    let availability: HelpAvailability
    @Binding var text: String
    let parts: [HelpPart]?
    let partsFailed: Bool
    let left: Set<String>
    let isSending: Bool
    let canSend: Bool
    let card: HelpCard?
    let cardText: String
    let actions: HelpFormActions
    @FocusState private var isWriting: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let card { status(card) } else { form }
        }
        .padding(EdgeInsets(top: 6, leading: 20, bottom: 20, trailing: 20))
        .frame(width: 420)
        .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - Asking

    @ViewBuilder private var form: some View {
        HStack(spacing: 8) {
            Circle().fill(availability.away == true ? Color.orange : Color.green).frame(width: 8, height: 8)
            Text(availability.away == true ? "\(availability.hostFirstName)'s Mac is away" : "\(availability.hostFirstName)'s Mac answers in Slack")
                .foregroundStyle(.secondary)
        }
        TextEditor(text: $text)
            .font(.system(size: 13))
            .scrollContentBackground(.hidden)
            .padding(EdgeInsets(top: 8, leading: 5, bottom: 8, trailing: 5))
            .frame(height: 120)
            .background(RoundedRectangle(cornerRadius: 7).fill(Color(nsColor: .textBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(isWriting ? Color.accentColor : Color(nsColor: .separatorColor),
                                                                    lineWidth: isWriting ? 2 : 1))
            .overlay(alignment: .topLeading) {
                if text.isEmpty {
                    Text("What do you need help with?").foregroundStyle(.tertiary)
                        .padding(EdgeInsets(top: 8, leading: 10, bottom: 0, trailing: 10))
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .focused($isWriting)
            .onAppear { isWriting = true }
            .accessibilityLabel("What do you need help with?")
            .accessibilityIdentifier(AXID.helpText)
        sentWithIt
        if availability.away == true {
            Text("Your request will wait up to 7 days").font(.system(size: 12)).foregroundStyle(.secondary)
        }
        HStack(spacing: 8) {
            Text("Goes through mattstack's relay").font(.system(size: 12)).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            if isSending { ProgressView().controlSize(.small) }
            Button("Cancel", role: .cancel, action: actions.close).keyboardShortcut(.cancelAction)
            Button("Ask \(availability.bot)", action: actions.send)
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(!canSend)
                .accessibilityIdentifier(AXID.helpSend)
        }
    }

    @ViewBuilder private var sentWithIt: some View {
        if partsFailed {
            HStack {
                Text("rt did not say what would be sent").foregroundStyle(.red)
                Button("Try again", action: actions.reloadParts)
            }
        } else if let parts, !parts.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("Sent with it").font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
                VStack(spacing: 0) {
                    ForEach(Array(parts.enumerated()), id: \.element.id) { i, part in
                        if i > 0 { Divider().padding(.horizontal, 10) }
                        partRow(part)
                    }
                }
                .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .textBackgroundColor)))
            }
        }
    }

    private func partRow(_ part: HelpPart) -> some View {
        HStack(spacing: 10) {
            Toggle(part.shownLabel, isOn: Binding(get: { !left.contains(part.key) }, set: { _ in actions.toggle(part) }))
                .toggleStyle(.checkbox)
                .fixedSize()
            Text(part.value).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail).help(part.value)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .frame(height: 36)
        .accessibilityElement(children: .combine)
    }

    // MARK: - After

    @ViewBuilder private func status(_ card: HelpCard) -> some View {
        HStack(spacing: 10) {
            mark(card.mark).frame(width: 20, height: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(card.title).font(.system(size: 14, weight: .semibold))
                if let detail = card.detail { Text(detail).foregroundStyle(.secondary) }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(AXID.helpStatus)
        Text(cardText)
            .foregroundStyle(.secondary)
            .lineLimit(6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(EdgeInsets(top: 9, leading: 11, bottom: 9, trailing: 11))
            .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .textBackgroundColor)))
        HStack(spacing: 8) {
            Spacer()
            if isSending { ProgressView().controlSize(.small) }
            Button("Close", action: actions.close).keyboardShortcut(.cancelAction)
            switch card.action {
            case .openSlack(let url): primary("Open in Slack") { NSWorkspace.shared.open(url); actions.close() }
            case .askAgain: primary("Ask again", actions.askAgain)
            case .tryAgain: primary("Try again", actions.send)
            case .showIt: Button("Show it", action: actions.showIt)
            case nil: EmptyView()
            }
        }
    }

    private func primary(_ title: String, _ action: @escaping () -> Void) -> some View {
        Button(title, action: action).buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(isSending)
    }

    @ViewBuilder private func mark(_ mark: HelpCard.Mark) -> some View {
        switch mark {
        case .working: ProgressView().controlSize(.small)
        case .done: symbol("checkmark.circle", .green)
        case .clock: symbol("clock", .orange)
        case .moon: symbol("moon", .orange)
        case .failed: symbol("xmark.circle", .red)
        }
    }

    private func symbol(_ name: String, _ tint: Color) -> some View {
        Image(systemName: name).resizable().scaledToFit().fontWeight(.regular).foregroundStyle(tint)
    }
}

#if DEBUG
/// `rt-tray --render-help-window-snapshots <out-dir>`
enum HelpWindowSnapshot {
    @MainActor
    static func runIfRequested() -> Bool {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--render-help-window-snapshots"), args.count > i + 1 else { return false }
        let out = URL(fileURLWithPath: args[i + 1])
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        _ = NSApplication.shared
        let words = "Setup says Slack is signed in, but the board can't post to our channel."
        let parts = [HelpPart(key: "versions", label: "Versions", value: "rt 2.41.0, app 2.41.0, macOS 27.2"),
                     HelpPart(key: "setup", label: "Setup rows that need attention", value: "accounts.slack")]
        let ready = HelpAvailability(state: "ready", host: "Alex Moreau", away: false, persona: "Maude")
        let away = HelpAvailability(state: "ready", host: "Alex Moreau", away: true, persona: "Maude")
        func form(_ a: HelpAvailability, _ text: String, _ card: HelpCard? = nil) -> HelpForm {
            HelpForm(availability: a, text: .constant(text), parts: parts, partsFailed: false, left: [], isSending: false,
                     canSend: !text.isEmpty, card: card, cardText: words, actions: HelpFormActions())
        }
        func card(_ state: String, away: Bool = false, dm: String? = nil, reason: String? = nil) -> HelpCard {
            HelpCards.request(HelpRequest(id: "r", text: words, state: state, reason: reason, dmLink: dm, away: away), host: "Alex", bot: "Maude")
        }
        let shots: [(String, HelpForm)] = [
            ("asking", form(ready, words)), ("empty", form(ready, "")), ("away", form(away, words)),
            ("sent", form(ready, "", card("sent"))), ("received", form(ready, "", card("received"))),
            ("opened", form(ready, "", card("opened", dm: "slack://user?team=T0ACME&id=U0ALEX"))),
            ("waiting", form(ready, "", card("waiting"))), ("mac-away", form(ready, "", card("sent", away: true))),
            ("failed", form(ready, "", card("failed", reason: "Alex's Mac could not reach Slack"))),
            ("expired", form(ready, "", card("expired"))),
            ("not-sent", form(ready, "", HelpCards.refusal(code: "support-unreachable", message: "", host: "Alex", waiting: false))),
        ]
        for (name, view) in shots {
            for scheme in ["light", "dark"] {
                SnapshotRenderer.render(view.background(Color(nsColor: .windowBackgroundColor)), appearance: scheme == "dark" ? .darkAqua : .aqua,
                                        to: out.appendingPathComponent("help-\(name)-\(scheme).png"), scale: 2, colorSpace: .sRGB)
            }
        }
        print("wrote \(shots.count * 2) snapshots to \(out.path)")
        return true
    }
}
#endif
