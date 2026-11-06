import SwiftUI

private struct FastDrawsLightsKey: EnvironmentKey {
    static let defaultValue = false
}

private struct FastLightsBesideTitleKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    /// Snapshots draw the mock's three title bar dots; the live window leaves that space to macOS's traffic lights.
    var fastDrawsLights: Bool {
        get { self[FastDrawsLightsKey.self] }
        set { self[FastDrawsLightsKey.self] = newValue }
    }

    /// False where macOS's own title bar sits above this one (a test drive), so no traffic lights share it.
    var fastLightsBesideTitle: Bool {
        get { self[FastLightsBesideTitleKey.self] }
        set { self[FastLightsBesideTitleKey.self] = newValue }
    }
}

/// The mock's title bar: "mattstack" after the traffic lights' space, the step counter at the right.
struct FastTitleBar: View {
    let step: String?
    @Environment(\.fastDrawsLights) private var drawsLights
    @Environment(\.fastLightsBesideTitle) private var lightsBesideTitle

    var body: some View {
        HStack(spacing: 0) {
            if lightsBesideTitle || drawsLights {
                HStack(spacing: 8) {
                    ForEach(0..<3, id: \.self) { _ in
                        Circle().fill(drawsLights ? FastTheme.outline : Color.clear).frame(width: 12, height: 12)
                    }
                }
                .padding(.trailing, 16)
                .accessibilityHidden(true)
            }
            Text("mattstack").font(.system(size: 13, weight: .semibold)).foregroundColor(FastTheme.textSecondary)
            Spacer(minLength: 8)
            if let step {
                Text(step).font(.system(size: 11)).foregroundColor(FastTheme.textTertiary)
                    .accessibilityIdentifier(AXID.fastStep)
            }
        }
        .padding(.horizontal, 14)
        .frame(height: FastTheme.titleBarHeight)
        .frame(maxWidth: .infinity)
        .background(FastTheme.titleBar)
        .overlay(alignment: .bottom) { Rectangle().fill(FastTheme.divider).frame(height: 1).offset(y: 1) }
        .padding(.bottom, 1)
    }
}

/// The window's fill with the mock's pink glow over the top: an ellipse 65% of
/// the width across and 45% of the height down, centred on the top edge.
struct FastWindowBackground: View {
    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width, height = geo.size.height
            EllipticalGradient(colors: [FastTheme.glow, FastTheme.glow.opacity(0)], center: .center,
                               startRadiusFraction: 0, endRadiusFraction: 0.5)
                .frame(width: 1.3 * width, height: 0.9 * height)
                .position(x: width / 2, y: 0)
        }
        .background(FastTheme.windowBackground)
        .clipped()
        .allowsHitTesting(false)
    }
}

/// The title bar over a screen, all on the glowing window fill.
struct FastWindowChrome<Content: View>: View {
    let step: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            FastTitleBar(step: step)
            content.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .background(FastWindowBackground())
        .environment(\.colorScheme, .dark)
        .foregroundColor(FastTheme.textPrimary)
    }
}

/// A screen's body over its footer. The body scrolls when the window is
/// shorter than it; the footer stays put.
struct FastScreen<Content: View, Footer: View>: View {
    var insets: EdgeInsets = FastTheme.bodyInsets
    var spacing: CGFloat = FastTheme.bodyGap
    var alignment: HorizontalAlignment = .leading
    @ViewBuilder let content: Content
    @ViewBuilder let footer: Footer

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: alignment, spacing: spacing) { content }
                    .padding(insets)
                    .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .top))
            }
            .scrollBounceBehavior(.basedOnSize)
            // Never drawn: rows and screens animating run the content briefly past the window, which flashed a bar
            // mid-transition. The window sizes to its screen, so a bar would only ever be noise; scrolling still works.
            .scrollIndicators(.never)
            footer
        }
    }
}

extension FastScreen where Footer == EmptyView {
    init(insets: EdgeInsets = FastTheme.bodyInsets, spacing: CGFloat = FastTheme.bodyGap,
         alignment: HorizontalAlignment = .leading, @ViewBuilder content: () -> Content) {
        self.init(insets: insets, spacing: spacing, alignment: alignment, content: content, footer: { EmptyView() })
    }
}

#if DEBUG
/// What only a snapshot draws: the mock's window outline and rounded corners.
struct FastSnapshotWindow<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: FastTheme.windowRadius, style: .continuous)
        content
            .environment(\.fastDrawsLights, true)
            .clipShape(shape)
            .overlay(shape.strokeBorder(FastTheme.outline, lineWidth: 1))
    }
}
#endif
