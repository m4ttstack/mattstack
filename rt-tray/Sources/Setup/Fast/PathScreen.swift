import SwiftUI
import MattstackCore

/// P2: four cards, and choosing one moves on. No footer: the card is the answer.
struct PathScreenBody: View {
    /// Just me is a first-run choice only.
    let showsSolo: Bool
    var failure: String? = nil
    let onChoose: (TeamChoice) -> Void

    @State private var hovered: TeamChoice?
    @FocusState private var focused: TeamChoice?

    struct Card {
        let choice: TeamChoice
        let title: String
        let subtitle: String
        let symbol: String
    }

    /// The tray owns these cards, so their copy lives here rather than in rt's form.
    static let allCards = [
        Card(choice: .join, title: "Join a team", subtitle: "You have an invite from your team admin", symbol: "person.2"),
        Card(choice: .create, title: "Create a team", subtitle: "Invite people once it's ready", symbol: "plus"),
        Card(choice: .solo, title: "Just me", subtitle: "No team. Add one later in Settings", symbol: "person"),
        Card(choice: .restore, title: "Move from another Mac", subtitle: "Bring your setup over from your backup", symbol: "laptopcomputer"),
    ]

    private var cards: [Card] { Self.allCards.filter { showsSolo || $0.choice != .solo } }

    /// Exactly one card is lit, as in the mock: the hovered one, else the focused one, else the first.
    private var lit: TeamChoice? { hovered ?? focused ?? cards.first?.choice }

    var body: some View {
        FastScreen(insets: EdgeInsets(top: 40, leading: 48, bottom: 40, trailing: 48), spacing: 20) {
            FastScreenHeader(title: "How are you setting up?")
            ForEach(cards, id: \.title) { card in
                Button { onChoose(card.choice) } label: { PathCardLabel(card: card) }
                    .buttonStyle(PathCardStyle(lit: lit == card.choice))
                    .focused($focused, equals: card.choice)
                    .onHover { inside in
                        if inside { hovered = card.choice } else if hovered == card.choice { hovered = nil }
                    }
                    .accessibilityIdentifier(AXID.fastPathCard(Self.name(card.choice)))
            }
            if let failure { FastFailureLine(text: failure) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.path.rawValue))
    }

    private static func name(_ choice: TeamChoice) -> String {
        switch choice {
        case .join: return "join"
        case .create: return "create"
        case .solo: return "solo"
        case .restore: return "restore"
        }
    }
}

private struct PathCardLabel: View {
    let card: PathScreenBody.Card
    @Environment(\.pathCardLit) private var lit

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            FastIconTile(symbol: card.symbol)
            VStack(alignment: .leading, spacing: 3) {
                Text(card.title).font(.system(size: 14, weight: FastTheme.weight(css: .semibold)))
                    .foregroundColor(FastTheme.textPrimary)
                Text(card.subtitle).font(.system(size: 12)).foregroundColor(FastTheme.textSecondary)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .medium))
                .foregroundColor(lit ? FastTheme.accent : FastTheme.textTertiary)
                .frame(width: 16, height: 16)
                .accessibilityHidden(true)
        }
        .padding(FastTheme.rowInsets)
        .contentShape(RoundedRectangle(cornerRadius: FastTheme.cardRadius, style: .continuous))
    }
}

private struct PathCardLitKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// The lit path card draws its chevron in accent.
    fileprivate var pathCardLit: Bool {
        get { self[PathCardLitKey.self] }
        set { self[PathCardLitKey.self] = newValue }
    }
}

private struct PathCardStyle: ButtonStyle {
    let lit: Bool

    func makeBody(configuration: Configuration) -> some View {
        PathCard(label: configuration.label, pressed: configuration.isPressed, lit: lit)
    }
}

private struct PathCard<Label: View>: View {
    let label: Label
    let pressed: Bool
    let lit: Bool

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: FastTheme.cardRadius, style: .continuous)
        label
            .environment(\.pathCardLit, lit)
            .background {
                shape.fill(lit ? FastTheme.accentWash : FastTheme.card)
                if pressed { shape.fill(FastTheme.accentWash) }
            }
            .overlay(shape.strokeBorder(lit ? FastTheme.accent : FastTheme.outline, lineWidth: 1))
    }
}
