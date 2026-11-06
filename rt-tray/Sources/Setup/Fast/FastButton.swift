import SwiftUI

/// The setup kit's button. Every button that starts work takes `isLoading`, so a
/// press always answers: the label blurs into a shimmering working label, a light
/// trail runs around the edge, and a primary's glow breathes. While loading it
/// ignores taps and Return and never shrinks. Disabled still greys out: disabled
/// means "not yet", loading means "on it".
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

    @State private var idleWidth: CGFloat = 0

    var body: some View {
        Button {
            if !isLoading { action() }
        } label: {
            label
        }
        .modifier(KindStyle(kind: kind, size: size, shape: shape, isLoading: isLoading))
        .overlay { if isLoading, let radius = trailRadius { FastLightTrail(radius: radius, color: trailColor) } }
        .allowsHitTesting(!isLoading)
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: isLoading)
        .accessibilityValue(isLoading ? Text(loadingTitle ?? "In progress") : Text(""))
    }

    @ViewBuilder private var label: some View {
        ZStack {
            if isLoading {
                FastShimmerText(text: loadingTitle ?? title, base: textColor, highlight: shimmerColor)
                    .frame(minWidth: idleWidth)
                    .transition(.blurReplace)
            } else {
                idleLabel
                    .background(GeometryReader { proxy in
                        Color.clear.onAppear { idleWidth = proxy.size.width }
                            .onChange(of: proxy.size.width) { _, width in idleWidth = width }
                    })
                    .transition(.blurReplace)
            }
        }
    }

    @ViewBuilder private var idleLabel: some View {
        if let icon {
            Label(title, systemImage: icon)
        } else {
            Text(title)
        }
    }

    /// The loading label's color; a loading primary has drained to a wash, so its text takes the accent.
    private var textColor: Color {
        switch kind {
        case .primary: return FastTheme.accent
        case .outline: return FastTheme.accent
        case .secondary(let muted): return muted ? FastTheme.textSecondary : FastTheme.textPrimary
        case .quiet: return FastTheme.textSecondary
        }
    }

    /// A gentle lift in the label's own hue, not a white flash.
    private var shimmerColor: Color {
        switch kind {
        case .primary, .outline: return FastTheme.accent
        default: return FastTheme.textPrimary
        }
    }

    private var trailColor: Color { FastTheme.accent }

    /// The corner the trail follows; a quiet button has no edge to trace.
    private var trailRadius: CGFloat? {
        switch kind {
        case .quiet: return nil
        case .primary: return (shape ?? .standard(size, primary: true)).radius
        case .secondary, .outline: return (shape ?? .standard(size, primary: false)).radius
        }
    }

    private struct KindStyle: ViewModifier {
        let kind: Kind
        let size: FastButtonSize
        let shape: FastButtonShape?
        let isLoading: Bool

        func body(content: Content) -> some View {
            switch kind {
            case .primary(let glow): content.buttonStyle(FastPrimaryButtonStyle(size: size, glow: glow, shape: shape, loading: isLoading))
            case .secondary(let muted): content.buttonStyle(FastSecondaryButtonStyle(size: size, shape: shape, muted: muted))
            case .outline: content.buttonStyle(FastOutlineButtonStyle(size: size, shape: shape, loading: isLoading))
            case .quiet: content.buttonStyle(FastQuietButtonStyle())
            }
        }
    }
}

/// A bright comet that runs around a rounded edge, one lap every `lap` seconds.
struct FastLightTrail: View {
    let radius: CGFloat
    let color: Color
    var lap: TimeInterval = 1.9

    var body: some View {
        TimelineView(.animation) { context in
            let turn = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: lap) / lap
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(
                    AngularGradient(
                        stops: [
                            .init(color: color.opacity(0), location: 0),
                            .init(color: color.opacity(0), location: 0.62),
                            .init(color: color.opacity(0.55), location: 0.9),
                            .init(color: color, location: 0.98),
                            .init(color: color.opacity(0), location: 1),
                        ],
                        center: .center, angle: .degrees(turn * 360)),
                    lineWidth: 1.5)
        }
        .allowsHitTesting(false)
    }
}

/// Text with a soft highlight sweeping across it, the way a "thinking" label reads.
struct FastShimmerText: View {
    let text: String
    let base: Color
    let highlight: Color

    var body: some View {
        TimelineView(.animation) { context in
            let phase = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6
            Text(text)
                .foregroundColor(base.opacity(0.8))
                .overlay {
                    GeometryReader { proxy in
                        let width = proxy.size.width
                        LinearGradient(colors: [highlight.opacity(0), highlight.opacity(0.45), highlight.opacity(0)],
                                       startPoint: .leading, endPoint: .trailing)
                            .frame(width: max(width * 0.45, 24))
                            .offset(x: -width * 0.45 + (width * 1.9) * phase)
                    }
                    .mask(Text(text))
                }
        }
    }
}
