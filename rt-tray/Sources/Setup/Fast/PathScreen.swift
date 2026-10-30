import AppKit
import SwiftUI
import MattstackCore

/// P2: four cards, and choosing one moves on. No footer: the card is the answer.
struct PathScreenBody: View {
    /// Just me is a first-run choice only.
    let showsSolo: Bool
    let onChoose: (TeamChoice) -> Void

    private var cards: [(TeamChoice, String, String)] {
        [
            (.join, "Join a team", "ticket"),
            (.create, "Create a team", "person.2"),
            (.solo, "Just me", "person"),
            (.restore, "Move from another Mac", "laptopcomputer.and.arrow.down"),
        ].filter { showsSolo || $0.0 != .solo }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            FastScreenHeader(label: nil, title: "How are you setting up?", subtitle: nil)
            VStack(spacing: 10) {
                ForEach(cards, id: \.1) { choice, title, symbol in
                    Button { onChoose(choice) } label: { PathCardLabel(title: title, symbol: symbol) }
                        .buttonStyle(PathCardStyle())
                        .accessibilityIdentifier(AXID.fastPathCard(Self.name(choice)))
                }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .topLeading)
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
    let title: String
    let symbol: String

    /// The plain accent reads deep blue on a dark tile, so dark mode lifts it toward white.
    private static let glyph = NSColor(name: nil) { appearance in
        FastAppearance.isDark(appearance) ? NSColor.controlAccentColor.blended(withFraction: 0.35, of: .white) ?? .controlAccentColor : .controlAccentColor
    }
    private static let tile = NSColor(name: nil) { appearance in
        NSColor.controlAccentColor.withAlphaComponent(FastAppearance.isDark(appearance) ? 0.24 : 0.14)
    }

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 17))
                .foregroundStyle(Color(nsColor: Self.glyph))
                .frame(width: 36, height: 36)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: Self.tile)))
            Text(title).font(.body.weight(.medium))
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.callout.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .contentShape(RoundedRectangle(cornerRadius: 10))
    }
}

private struct PathCardStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        PathCard(label: configuration.label, pressed: configuration.isPressed)
    }
}

private struct PathCard<Label: View>: View {
    let label: Label
    let pressed: Bool
    @State private var hovering = false

    var body: some View {
        label
            .background {
                RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor))
                RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(pressed ? 0.08 : hovering ? 0.04 : 0))
            }
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color(nsColor: .separatorColor)))
            .onHover { hovering = $0 }
    }
}
