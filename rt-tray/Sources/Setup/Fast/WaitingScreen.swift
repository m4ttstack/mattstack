import SwiftUI
import MattstackCore

/// P4: the join is sent and the admin has yet to approve it. A wait on a
/// person, never a failure or progress: no bar, no warning glyph, no red.
/// Hide only closes the window; the checks carry on behind it.
struct WaitingScreenBody: View {
    let team: String
    /// The admin who made the invite; nil from an older rt.
    let admin: String?
    let onHide: () -> Void

    static let subtitle = "Let them know you're waiting. Setup carries on the moment they approve"

    static func title(admin: String?) -> String {
        let who = admin.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 } ?? "your team admin"
        return "Waiting for \(who) to confirm your membership"
    }

    var body: some View {
        FastScreen(insets: EdgeInsets(top: 48, leading: 48, bottom: 32, trailing: 48), spacing: 18, alignment: .center) {
            WaitingTile()
            FastTeamChip(name: team)
            // P4's heading is the mock's one 24-point heading, on 30-point lines.
            Text(Self.title(admin: admin))
                .font(.system(size: 24, weight: .bold)).tracking(-0.7).foregroundColor(FastTheme.textPrimary)
                .lineSpacing(1.5).frame(minHeight: 30)
                .fixedSize(horizontal: false, vertical: true)
            FastTheme.sub(Self.subtitle)
                .lineSpacing(3).frame(minHeight: 20)
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .top, spacing: 20) {
                hint("checklist", "Next: a few questions, then it runs by itself")
                hint("bell", "We'll let you know when you're in")
            }
        } footer: {
            FastFooter(screen: FastSetupScreen.waiting.rawValue, note: nil, secondary: nil,
                       primary: ("Hide", true, onHide), quietPrimary: true)
        }
        .multilineTextAlignment(.center)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.waiting.rawValue))
    }

    private func hint(_ symbol: String, _ text: String) -> some View {
        HStack(spacing: 6) {
            FastLucideGlyph(symbol: symbol, box: 13, lineWidth: 13 / 12)?
                .foregroundColor(FastTheme.textTertiary)
            Text(text).font(.system(size: 12)).foregroundColor(FastTheme.textSecondary).lineLimit(1)
        }
        .fixedSize()
    }
}

private struct WaitingTile: View {
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        FastLucideGlyph(symbol: "ticket", box: 26, lineWidth: 26 / 12)
            .foregroundColor(FastTheme.accent)
            .frame(width: 56, height: 56)
            .background(shape.fill(FastTheme.card))
            .overlay(shape.strokeBorder(FastTheme.outline, lineWidth: 1))
            .accessibilityHidden(true)
    }
}
