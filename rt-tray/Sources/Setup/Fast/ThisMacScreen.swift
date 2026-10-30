import SwiftUI
import MattstackCore

/// P5b: rt's this-mac section split into cards by row id. Set up this Mac waits on rt's `startReady`.
struct ThisMacScreenBody: View {
    /// Nil on Just me.
    let teamName: String?
    let rows: [FormRow]
    let waiting: [String: String]
    let errors: [String: String]
    let startReady: Bool
    let onAction: FormRowPerform
    let onBack: (() -> Void)?
    let onStart: () -> Void

    /// Git leads the repos card: rt sends `tool.clt` first because nothing clones without it.
    static func cards(_ rows: [FormRow]) -> (repos: [FormRow], settings: [FormRow], leftover: [FormRow]) {
        let repos = rows.filter { $0.id == "tool.clt" || $0.id.hasPrefix("repos.") }
        let settings = rows.filter { $0.id.hasPrefix("settings.") }
        let leftover = rows.filter { row in !repos.contains { $0.id == row.id } && !settings.contains { $0.id == row.id } }
        return (repos, settings, leftover)
    }

    private var subtitle: String {
        guard let teamName, !teamName.isEmpty else { return "Where your repos and settings live" }
        return "Where \(teamName)'s repos and your settings live"
    }

    var body: some View {
        let cards = Self.cards(rows)
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    FastScreenHeader(label: nil, title: "Last bit: this Mac", subtitle: subtitle)
                    // Leftovers lead: they are why a finished run came back here, and they hold Set up this Mac.
                    if !cards.leftover.isEmpty { card("Still to do", cards.leftover) }
                    if !cards.repos.isEmpty { card("Your repos", cards.repos) }
                    if !cards.settings.isEmpty { card("Your settings", cards.settings) }
                }
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .scrollBounceBehavior(.basedOnSize)
            FastFooter(screen: FastSetupScreen.thisMac.rawValue, note: "About 10 minutes once you start",
                       secondary: onBack.map { ("Back", $0) }, primary: ("Set up this Mac", startReady, onStart))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.thisMac.rawValue))
    }

    private func card(_ title: String, _ rows: [FormRow]) -> some View {
        FormCard(title: title, rows: rows, waiting: waiting, errors: errors, onAction: onAction)
    }
}
