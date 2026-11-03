import SwiftUI
import MattstackCore

/// P5b: rt's this-mac section in one card, its repo rows under "Your repos" and each
/// other row under its own label. Set up this Mac waits on rt's `startReady`.
struct ThisMacScreenBody: View {
    /// Nil on Just me, or before rt names the team.
    let teamName: String?
    /// rt's path is Just me.
    let solo: Bool
    let rows: [FormRow]
    let waiting: [String: String]
    let errors: [String: String]
    let startReady: Bool
    let onAction: FormRowPerform
    let onBack: (() -> Void)?
    let onStart: () -> Void

    static let insets = EdgeInsets(top: 32, leading: 48, bottom: 24, trailing: 48)
    static let footerInsets = EdgeInsets(top: 14, leading: 48, bottom: 22, trailing: 48)

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
        FastScreen(insets: Self.insets, spacing: 18) {
            FastScreenHeader(title: "Last bit: this Mac", subtitle: subtitle, spacing: 18)
            // Leftovers lead: they are why a finished run came back here, and they hold Set up this Mac.
            if !cards.leftover.isEmpty { card("Still to do", cards.leftover) }
            if !cards.repos.isEmpty || !cards.settings.isEmpty { mainCard(cards.repos + cards.settings) }
            if solo { soloNote }
        } footer: {
            FastFooter(screen: FastSetupScreen.thisMac.rawValue, note: solo ? "About 5 minutes once you start" : "About 10 minutes once you start",
                       secondary: onBack.map { ("Back", $0) }, primary: ("Set up this Mac", startReady, onStart),
                       insets: Self.footerInsets, quietSecondary: true)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.thisMac.rawValue))
    }

    /// "Your repos" labels the run of repo rows only; every other row carries its own label, so the card has no title above.
    private func mainCard(_ rows: [FormRow]) -> some View {
        let hasRepoRun = rows.contains { $0.action?.type == .placeRepo }
        return FormCard(title: hasRepoRun ? "Your repos" : nil, rows: rows, waiting: waiting, errors: errors, style: .labelled,
                        onAction: onAction)
    }

    static let soloNoteText = "No questions for writing style (sparse), the board's folder or your editors"

    /// P5s: what Just me settles without asking.
    private var soloNote: some View {
        HStack(alignment: .center, spacing: 8) {
            Image(systemName: "sparkles").font(.system(size: 13, weight: .light))
            Text(Self.soloNoteText).font(.system(size: 12))
        }
        .foregroundColor(FastTheme.textTertiary)
    }

    private func card(_ title: String, _ rows: [FormRow]) -> some View {
        FormCard(title: title, rows: rows, waiting: waiting, errors: errors, style: .labelled, onAction: onAction)
    }
}
