import SwiftUI
import MattstackCore

/// P2: four cards, and choosing one moves on. No footer: the card is the answer.
struct PathScreenBody: View {
    /// Just me is a first-run choice only.
    let showsSolo: Bool
    var failure: String? = nil
    /// Snapshots only: draws a card as the pointer would, since an offscreen render has no pointer.
    var hovered: TeamChoice? = nil
    let onChoose: (TeamChoice) -> Void

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

    var body: some View {
        FastScreen(insets: EdgeInsets(top: 40, leading: 48, bottom: 40, trailing: 48), spacing: 20) {
            FastTheme.heading("How are you setting up?").fixedSize(horizontal: false, vertical: true)
            ForEach(cards, id: \.title) { card in
                Button { onChoose(card.choice) } label: { PathCardLabel(card: card) }
                    .buttonStyle(PathCardStyle(forcedHover: hovered == card.choice))
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
    /// A path card under the pointer or holding keyboard focus draws in accent.
    fileprivate var pathCardLit: Bool {
        get { self[PathCardLitKey.self] }
        set { self[PathCardLitKey.self] = newValue }
    }
}

private struct PathCardStyle: ButtonStyle {
    var forcedHover = false

    func makeBody(configuration: Configuration) -> some View {
        PathCard(label: configuration.label, pressed: configuration.isPressed, forcedHover: forcedHover)
    }
}

private struct PathCard<Label: View>: View {
    let label: Label
    let pressed: Bool
    let forcedHover: Bool
    @State private var hovering = false
    @Environment(\.isFocused) private var focused

    var body: some View {
        let lit = hovering || focused || forcedHover
        let shape = RoundedRectangle(cornerRadius: FastTheme.cardRadius, style: .continuous)
        label
            .environment(\.pathCardLit, lit)
            .background {
                shape.fill(lit ? FastTheme.accentWash : FastTheme.card)
                if pressed { shape.fill(FastTheme.accentWash) }
            }
            .overlay(shape.strokeBorder(lit ? FastTheme.accent : FastTheme.outline, lineWidth: 1))
            .onHover { hovering = $0 }
    }
}
