import AppKit
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

    static func title(admin: String?) -> String {
        let who = admin.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } ?? "your team admin"
        return "Waiting for \(who) to confirm your membership"
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 18) {
                WaitingTile()
                FastScreenHeader(label: team, title: Self.title(admin: admin),
                                 subtitle: "Let them know you're waiting. Setup carries on the moment they approve")
                VStack(alignment: .leading, spacing: 10) {
                    line("arrow.right", "Next: a few questions, then it runs by itself")
                    line("bell", "We'll let you know when you're in")
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            Spacer(minLength: 0)
            FastFooter(screen: FastSetupScreen.waiting.rawValue, note: nil, secondary: nil, primary: ("Hide", true, onHide))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.waiting.rawValue))
    }

    private func line(_ symbol: String, _ text: String) -> some View {
        Label {
            Text(text).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: symbol).foregroundStyle(Color(nsColor: .tertiaryLabelColor)).frame(width: 18)
        }
        .font(.callout)
        .foregroundStyle(Color(nsColor: .secondaryLabelColor))
    }
}

private struct WaitingTile: View {
    private static func isDark(_ appearance: NSAppearance) -> Bool {
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    }
    private static let tile = NSColor(name: nil) { appearance in
        NSColor.labelColor.withAlphaComponent(isDark(appearance) ? 0.12 : 0.06)
    }

    var body: some View {
        Image(systemName: "ticket")
            .font(.system(size: 22))
            .foregroundStyle(Color(nsColor: .secondaryLabelColor))
            .frame(width: 44, height: 44)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: Self.tile)))
            .accessibilityHidden(true)
    }
}
