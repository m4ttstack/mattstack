import SwiftUI
import MattstackCore

/// P7: setup finished. A green check, two lines, and rt's button for the app
/// to open; no summary of what was done.
struct ReadyScreenBody: View {
    let home: FormHome
    let onOpen: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            VStack(spacing: 14) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 72))
                    .foregroundStyle(Color(nsColor: .systemGreen))
                    .accessibilityHidden(true)
                Text("This Mac is ready").font(.title.weight(.semibold))
                Text("Go make something cool").font(.title3).foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)
            .padding(.horizontal, 24)
            .padding(.bottom, 56)
            Spacer(minLength: 0)
            FastFooter(screen: FastSetupScreen.ready.rawValue, note: nil, secondary: nil, primary: (home.label, true, onOpen))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AXID.fastScreen(FastSetupScreen.ready.rawValue))
    }
}
