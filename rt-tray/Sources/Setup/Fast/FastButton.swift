import SwiftUI

/// The setup kit's button. Every button that starts work takes `isLoading`, so a
/// press always shows a spinner and a working label in the button's own colors
/// instead of only greying out. While loading it ignores taps and Return, keeps
/// its width, and stays at full opacity: disabled still means "not yet", loading
/// means "on it".
struct FastButton: View {
    enum Kind {
        case primary(glow: Bool = true)
        case secondary(muted: Bool = false)
        case outline
        case quiet
    }

    let title: String
    var icon: String? = nil
    var kind: Kind = .primary()
    var size: FastButtonSize = .large
    var shape: FastButtonShape? = nil
    var isLoading = false
    /// What the button says while loading ("Installing…"); the title when left out.
    var loadingTitle: String? = nil
    let action: () -> Void

    var body: some View {
        Button {
            if !isLoading { action() }
        } label: {
            label
        }
        .modifier(KindStyle(kind: kind, size: size, shape: shape))
        .allowsHitTesting(!isLoading)
        .accessibilityValue(isLoading ? Text(loadingTitle ?? "In progress") : Text(""))
    }

    /// The idle label sets the width; the loading label never draws narrower than it, so a press never shrinks the button.
    @State private var idleWidth: CGFloat = 0

    @ViewBuilder private var label: some View {
        if isLoading {
            HStack(spacing: 6) {
                FastSpinner(size: size == .large ? 13 : 11, color: spinnerColor)
                Text(loadingTitle ?? title)
            }
            .frame(minWidth: idleWidth)
        } else {
            idleLabel.background(GeometryReader { proxy in
                Color.clear.onAppear { idleWidth = proxy.size.width }
                    .onChange(of: proxy.size.width) { _, width in idleWidth = width }
            })
        }
    }

    @ViewBuilder private var idleLabel: some View {
        if let icon {
            Label(title, systemImage: icon)
        } else {
            Text(title)
        }
    }

    private var spinnerColor: Color {
        switch kind {
        case .primary: return .white
        case .outline: return FastTheme.accent
        case .secondary(let muted): return muted ? FastTheme.textSecondary : FastTheme.textPrimary
        case .quiet: return FastTheme.textSecondary
        }
    }

    private struct KindStyle: ViewModifier {
        let kind: Kind
        let size: FastButtonSize
        let shape: FastButtonShape?

        func body(content: Content) -> some View {
            switch kind {
            case .primary(let glow): content.buttonStyle(FastPrimaryButtonStyle(size: size, glow: glow, shape: shape))
            case .secondary(let muted): content.buttonStyle(FastSecondaryButtonStyle(size: size, shape: shape, muted: muted))
            case .outline: content.buttonStyle(FastOutlineButtonStyle())
            case .quiet: content.buttonStyle(FastQuietButtonStyle())
            }
        }
    }
}
