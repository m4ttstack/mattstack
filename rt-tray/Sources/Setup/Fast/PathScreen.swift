import SwiftUI
import MattstackCore

/// P2: four cards to pick from, then Continue moves on.
struct PathScreenBody: View {
    /// Just me is a first-run choice only.
    let showsSolo: Bool
    var failure: String? = nil
    let onChoose: (TeamChoice) -> Void

    @State private var selected: TeamChoice?
    @FocusState private var focused: TeamChoice?

    init(showsSolo: Bool, failure: String? = nil, selected: TeamChoice? = nil, onChoose: @escaping (TeamChoice) -> Void) {
        self.showsSolo = showsSolo
        self.failure = failure
        self.onChoose = onChoose
        _selected = State(initialValue: selected)
    }

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
        FastScreen(insets: EdgeInsets(top: 40, leading: 48, bottom: 24, trailing: 48), spacing: 20) {
            FastScreenHeader(title: "How are you setting up?")
            ForEach(cards, id: \.title) { card in
                Button { selected = card.choice } label: { PathCardLabel(card: card) }
                    .buttonStyle(PathCardStyle(selected: selected == card.choice))
                    .focused($focused, equals: card.choice)
                    .accessibilityAddTraits(selected == card.choice ? .isSelected : [])
                    .accessibilityIdentifier(AXID.fastPathCard(Self.name(card.choice)))
            }
            if let failure { FastFailureLine(text: failure) }
        } footer: {
            FastFooter(screen: FastSetupScreen.path.rawValue, note: nil, secondary: nil,
                       primary: ("Continue", selected != nil, { if let selected { onChoose(selected) } }),
                       insets: ConnectScreenBody.footerInsets)
        }
        .onChange(of: focused) { _, now in
            if let now { selected = now }
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
    @Environment(\.pathCardSelected) private var selected

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
            PathRadio(on: selected)
        }
        .padding(FastTheme.rowInsets)
        .contentShape(RoundedRectangle(cornerRadius: FastTheme.cardRadius, style: .continuous))
    }
}

/// A pick-one mark: an empty ring, or an accent disc with a dot once chosen.
private struct PathRadio: View {
    let on: Bool

    var body: some View {
        ZStack {
            if on {
                Circle().fill(FastTheme.accent)
                Circle().fill(FastTheme.textPrimary).frame(width: 6, height: 6)
            } else {
                Circle().strokeBorder(FastTheme.outline, lineWidth: 1.5)
            }
        }
        .frame(width: 16, height: 16)
        .accessibilityHidden(true)
    }
}

private struct PathCardSelectedKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    fileprivate var pathCardSelected: Bool {
        get { self[PathCardSelectedKey.self] }
        set { self[PathCardSelectedKey.self] = newValue }
    }
}

private struct PathCardStyle: ButtonStyle {
    let selected: Bool

    func makeBody(configuration: Configuration) -> some View {
        PathCard(label: configuration.label, pressed: configuration.isPressed, selected: selected)
    }
}

private struct PathCard<Label: View>: View {
    let label: Label
    let pressed: Bool
    let selected: Bool
    @State private var hovered = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: FastTheme.cardRadius, style: .continuous)
        let lifted = hovered || pressed
        label
            .environment(\.pathCardSelected, selected)
            .background {
                shape.fill(FastTheme.card)
                if selected { shape.fill(FastTheme.accentWash) } else if lifted { shape.fill(Color.white.opacity(0.03)) }
            }
            .overlay(shape.strokeBorder(selected ? FastTheme.accent : lifted ? FastTheme.outlineHover : FastTheme.outline, lineWidth: 1))
            .onHover { hovered = $0 }
    }
}
