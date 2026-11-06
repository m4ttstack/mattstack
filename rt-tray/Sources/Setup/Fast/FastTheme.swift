import AppKit
import MattstackCore
import SwiftUI

/// The fast setup mocks' one dark palette, type and metrics. Views name these
/// tokens and never a raw colour. Inter in the mocks stands in for SF, so every
/// font here is the system font at the mock's size and weight.
enum FastTheme {
    // MARK: Colours

    /// AppKit's copy, for the window behind the SwiftUI content.
    static let windowFill = NSColor(srgbRed: 0x0E / 255, green: 0x0E / 255, blue: 0x14 / 255, alpha: 1)
    static let windowBackground = Color(hex: 0x0E0E14)
    static let glow = Color(hex: 0xE64980, alpha: 0x26)
    static let titleBar = Color(hex: 0x14141B)
    /// Hairlines: the title bar's foot, card row dividers, the segmented track's edge, the progress track.
    static let divider = Color(hex: 0x26262F)
    /// Outlines on the window, cards, fields and quiet buttons; the selected segment; the title bar dots.
    static let outline = Color(hex: 0x383846)
    static let outlineHover = Color(hex: 0x4A4A5A)
    static let card = Color(hex: 0x21212B)
    static let fieldFill = Color(hex: 0x14141B)

    static let textPrimary = Color(hex: 0xF4F4F5)
    static let textSecondary = Color(hex: 0x9D9DA6)
    static let textTertiary = Color(hex: 0x7A7A85)
    static let accent = Color(hex: 0xE64980)
    static let success = Color(hex: 0x4ADE80)
    static let warning = Color(hex: 0xF5A524)
    static let failure = Color(hex: 0xF87171)
    /// P6's bar fill runs from this lilac at its left end to the accent at its right.
    static let barStart = Color(hex: 0xBE96F0)

    static let accentTile = Color(hex: 0xE64980, alpha: 0x24)
    static let successTile = Color(hex: 0x4ADE80, alpha: 0x1F)
    /// P2's card under the pointer or keyboard focus.
    static let accentWash = Color(hex: 0xE64980, alpha: 0x1A)
    static let primaryGlow = Color(hex: 0xE64980, alpha: 0x66)
    /// P6's moving band of light across the bar fill.
    static let barSheen = Color.white.opacity(0.28)
    /// Under the choose sheet's suggestion list, which floats over the sheet's cards.
    static let popoverShadow = Color.black.opacity(0.4)

    // MARK: Type

    static let heading = Font.system(size: 26, weight: .bold)
    static let headingTracking = tracking(css: -0.8)
    static let sub = Font.system(size: 14)
    static let cardTitle = Font.system(size: 12, weight: weight(css: .semibold))
    static let note = Font.system(size: 12)
    /// One heading for every fast setup sheet: choose, log and steps.
    static let sheetHeading = Font.system(size: 18, weight: .bold)
    static let sheetHeadingTracking = tracking(css: -0.5)

    /// The weight to draw for a CSS weight. SF at Inter's 500 or 600 reads a
    /// step heavier than the mocks' picture, and the picture wins: semibold
    /// draws medium and medium draws regular. Use it for row labels, tile
    /// titles, outline and secondary buttons, segment text and chips. Headings
    /// and the white primary buttons keep the CSS weight, which already reads
    /// like the mock.
    static func weight(css: Font.Weight) -> Font.Weight {
        switch css {
        case .semibold: return .medium
        case .medium: return .regular
        default: return css
        }
    }

    /// The tracking to draw for a bold heading's CSS letter-spacing. SF Bold
    /// at Inter's tracking sets about 6% narrower than the mocks' picture and
    /// crowds its letters, and the picture wins: 0.7 looser lands each
    /// heading within 1% of the mock's width (P1, P4, P5).
    static func tracking(css: CGFloat) -> CGFloat {
        css + 0.7
    }

    /// The sub's tracking for its CSS 0: SF at 14 sets 2 to 3% narrower than
    /// Inter, and the picture wins. Smaller text already lands within 1%.
    static let subTracking: CGFloat = 0.2

    // MARK: Metrics

    static let windowWidth: CGFloat = 720
    static let windowRadius: CGFloat = 12
    /// The bar's fill; its 1-point foot sits below it.
    static let titleBarHeight: CGFloat = 36
    /// P1's body; a screen whose CSS gives other numbers passes its own.
    static let bodyInsets = EdgeInsets(top: 40, leading: 48, bottom: 32, trailing: 48)
    static let bodyGap: CGFloat = 22
    /// P3c, P4, P6's footer; P5's screens start 14 down.
    static let footerInsets = EdgeInsets(top: 8, leading: 48, bottom: 22, trailing: 48)
    static let footerGap: CGFloat = 12
    static let cardRadius: CGFloat = 12
    static let rowInsets = EdgeInsets(top: 16, leading: 18, bottom: 16, trailing: 18)

    /// The heading line in the mock's ink and tracking.
    static func heading(_ text: String) -> Text {
        Text(text).font(heading).tracking(headingTracking).foregroundColor(textPrimary)
    }

    /// The one line under a heading.
    static func sub(_ text: String) -> Text {
        Text(text).font(sub).tracking(subTracking).foregroundColor(textSecondary)
    }
}

extension Color {
    fileprivate init(hex: UInt32, alpha: UInt8 = 0xFF) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: Double(alpha) / 255)
    }
}

// MARK: - Buttons

/// Large is a footer button (P5's Continue); small sits in a row (P1's Allow).
enum FastButtonSize {
    case large, small
}

/// A screen's own padding and corner where its CSS differs from a button size's.
struct FastButtonShape {
    var vertical: CGFloat
    var horizontal: CGFloat
    var radius: CGFloat

    /// P3c's Create token, the height of the large field beside it.
    static let besideLargeField = FastButtonShape(vertical: 11, horizontal: 12, radius: 10)
    /// P5b's Change, beside the slim path field.
    static let slim = FastButtonShape(vertical: 6, horizontal: 12, radius: 8)
    /// P6b's Show log.
    static let log = FastButtonShape(vertical: 10, horizontal: 18, radius: 11)
    /// P6b's Retry.
    static let retry = FastButtonShape(vertical: 10, horizontal: 20, radius: 11)

    static func standard(_ size: FastButtonSize, primary: Bool) -> FastButtonShape {
        switch (size, primary) {
        case (.large, true): return FastButtonShape(vertical: 11, horizontal: 22, radius: 11)
        case (.small, true): return FastButtonShape(vertical: 7, horizontal: 14, radius: 8)
        case (.large, false): return FastButtonShape(vertical: 10, horizontal: 20, radius: 11)
        case (.small, false): return FastButtonShape(vertical: 7, horizontal: 12, radius: 8)
        }
    }
}

/// The accent fill with white text. Large carries the mock's glow unless
/// `glow` is off (P6b's Retry); disabled drops to 40% and loses it, so it
/// never reads as the system's grey bezel.
struct FastPrimaryButtonStyle: ButtonStyle {
    var size: FastButtonSize = .large
    var glow = true
    var shape: FastButtonShape? = nil
    /// A loading FastButton: the fill drains to a faint accent wash and the glow goes out, so it no longer reads as pressable.
    var loading = false

    func makeBody(configuration: Configuration) -> some View {
        Styled(configuration: configuration, size: size, glow: glow, metrics: shape ?? .standard(size, primary: true), loading: loading)
    }

    private struct Styled: View {
        let configuration: Configuration
        let size: FastButtonSize
        let glow: Bool
        let metrics: FastButtonShape
        let loading: Bool
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.fastFlipsShadows) private var flipsShadows
        @State private var hovered = false

        var body: some View {
            let large = size == .large
            let shape = RoundedRectangle(cornerRadius: metrics.radius, style: .continuous)
            configuration.label
                .font(.system(size: large ? 14 : 13, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)
                .padding(.vertical, metrics.vertical).padding(.horizontal, metrics.horizontal)
                .background(
                    ZStack {
                        shape.fill(FastTheme.accent.opacity(0.12))
                        shape.fill(LinearGradient(colors: [FastTheme.accent.opacity(1), FastTheme.accent.opacity(0.86)],
                                                  startPoint: .top, endPoint: .bottom))
                            .opacity(loading ? 0 : 1)
                        shape.fill(Color.white.opacity(hovered && isEnabled && !loading && !configuration.isPressed ? 0.08 : 0))
                        shape.fill(Color.black.opacity(configuration.isPressed ? 0.12 : 0))
                        shape.strokeBorder(loading ? FastTheme.accent.opacity(0.25) : Color.white.opacity(0.18), lineWidth: loading ? 1 : 0.5)
                    })
                .shadow(color: large && glow && isEnabled && !loading ? FastTheme.primaryGlow : .clear, radius: 12, y: flipsShadows ? -8 : 8)
                .scaleEffect(configuration.isPressed ? 0.97 : 1)
                .opacity(isEnabled ? 1 : 0.4)
                .contentShape(shape)
                .animation(.easeOut(duration: 0.3), value: loading)
            .onHover { hovered = $0 }
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
            .animation(.easeOut(duration: 0.15), value: hovered)
        }
    }
}

private struct FastFlipsShadowsKey: EnvironmentKey {
    static let defaultValue = false
}

private struct FastHidesScrollersKey: EnvironmentKey {
    static let defaultValue = false
}

private struct FastSheetKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// True only in snapshots: `cacheDisplay` renders a layer's shadow offset upside down, while a live window draws it as given.
    var fastFlipsShadows: Bool {
        get { self[FastFlipsShadowsKey.self] }
        set { self[FastFlipsShadowsKey.self] = newValue }
    }

    /// True only in snapshots: offscreen, AppKit draws the legacy scroller, which insets the body, while a
    /// live window follows the Mac's "Show scroll bars" setting (overlay unless the person chose always).
    var fastHidesScrollers: Bool {
        get { self[FastHidesScrollersKey.self] }
        set { self[FastHidesScrollersKey.self] = newValue }
    }

    /// True for a sheet fast setup opens: the shared steps, choose and log sheets draw the fast theme there and keep
    /// the system look in Settings.
    var fastSheet: Bool {
        get { self[FastSheetKey.self] }
        set { self[FastSheetKey.self] = newValue }
    }
}

/// Borderless secondary text that brightens under the pointer: a way back
/// the mocks don't draw, kept quiet beside the screen's real action.
struct FastQuietButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Styled(configuration: configuration)
    }

    private struct Styled: View {
        let configuration: Configuration
        @Environment(\.isEnabled) private var isEnabled
        @State private var hovered = false

        var body: some View {
            configuration.label
                .font(.system(size: 13))
                .foregroundColor(hovered || configuration.isPressed ? FastTheme.textPrimary : FastTheme.textSecondary)
                .lineLimit(1)
                .contentShape(Rectangle())
                .onHover { hovered = $0 }
                .opacity(isEnabled ? 1 : 0.4)
        }
    }
}

/// Transparent with an accent edge, accent text and an optional leading icon
/// (P5's Connect Slack, Sign in to Claude, Add to Chrome).
struct FastOutlineButtonStyle: ButtonStyle {
    var size: FastButtonSize = .small
    var shape: FastButtonShape? = nil
    /// A loading FastButton: the same busy wash as a loading primary, with the edge dimmed so the light trail reads over it.
    var loading = false

    func makeBody(configuration: Configuration) -> some View {
        Styled(configuration: configuration, size: size, metrics: shape ?? .standard(size, primary: false), loading: loading)
    }

    /// A tonal accent button: a faint wash and a soft edge that firm up under the pointer.
    private struct Styled: View {
        let configuration: Configuration
        let size: FastButtonSize
        let metrics: FastButtonShape
        let loading: Bool
        @Environment(\.isEnabled) private var isEnabled
        @State private var hovered = false

        var body: some View {
            let large = size == .large
            let shape = RoundedRectangle(cornerRadius: metrics.radius, style: .continuous)
            let active = hovered && isEnabled && !loading
            let wash = configuration.isPressed ? 0.18 : loading ? 0.12 : active ? 0.14 : 0.07
            let edge = loading ? 0.22 : active ? 0.75 : 0.45
            configuration.label
                .labelStyle(FastIconLabelStyle(iconSize: large ? 14 : 12, spacing: 6))
                .font(.system(size: large ? 14 : 13, weight: FastTheme.weight(css: .semibold)))
                .foregroundColor(FastTheme.accent)
                .lineLimit(1)
                .padding(.vertical, metrics.vertical).padding(.horizontal, metrics.horizontal)
                .background(shape.fill(FastTheme.accent.opacity(wash)))
                .overlay(shape.strokeBorder(FastTheme.accent.opacity(edge), lineWidth: 1))
                .animation(.easeOut(duration: 0.3), value: loading)
                .scaleEffect(configuration.isPressed ? 0.97 : 1)
                .opacity(isEnabled ? 1 : 0.4)
                .contentShape(shape)
                .onHover { hovered = $0 }
                .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
                .animation(.easeOut(duration: 0.15), value: hovered)
        }
    }
}

/// A quiet outlined button in primary text: small in a row (Create token,
/// Change, Locate…), large in a footer (Hide, Show log, Back). `shape`
/// takes a screen's own padding and corner (`FastButtonShape.slim` and so on).
struct FastSecondaryButtonStyle: ButtonStyle {
    var size: FastButtonSize = .small
    var shape: FastButtonShape? = nil
    var muted = false

    func makeBody(configuration: Configuration) -> some View {
        Styled(configuration: configuration, size: size, metrics: shape ?? .standard(size, primary: false), muted: muted)
    }

    private struct Styled: View {
        let configuration: Configuration
        let size: FastButtonSize
        let metrics: FastButtonShape
        let muted: Bool
        @Environment(\.isEnabled) private var isEnabled
        @State private var hovered = false

        var body: some View {
            let large = size == .large
            let shape = RoundedRectangle(cornerRadius: metrics.radius, style: .continuous)
            configuration.label
                .labelStyle(FastIconLabelStyle(iconSize: large ? 14 : 12, spacing: 6))
                .font(.system(size: large ? 14 : 12, weight: FastTheme.weight(css: .medium)))
                .foregroundColor(muted ? FastTheme.textSecondary : FastTheme.textPrimary)
                .lineLimit(1)
                .padding(.vertical, metrics.vertical).padding(.horizontal, metrics.horizontal)
                .background(shape.fill(Color.white.opacity(configuration.isPressed ? 0.06 : hovered && isEnabled ? 0.04 : 0)))
                .overlay(shape.strokeBorder(hovered && isEnabled ? FastTheme.textSecondary.opacity(0.6) : FastTheme.outline, lineWidth: 1))
                .scaleEffect(configuration.isPressed ? 0.97 : 1)
                .opacity(isEnabled ? 1 : 0.4)
                .contentShape(shape)
                .onHover { hovered = $0 }
                .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
                .animation(.easeOut(duration: 0.15), value: hovered)
        }
    }
}

/// P5's "Installing…": a spinner and grey text in a quiet outlined chip,
/// where the row's button sits once the install is done. Offered less width
/// than the line needs, the text wraps inside the chip.
struct FastBusyChip: View {
    let text: String

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        HStack(spacing: 6) {
            FastSpinner()
            Text(text).font(.system(size: 12, weight: FastTheme.weight(css: .semibold))).foregroundColor(FastTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 7).padding(.horizontal, 12)
        .overlay(shape.strokeBorder(FastTheme.outline, lineWidth: 1))
    }
}

/// P5's Lucide loader: eight rays round a centre, their brightness stepping
/// round each eighth of a second as macOS's own spinner does. The system
/// spinner draws its own faint grey and ignores the mock's colour.
struct FastSpinner: View {
    var size: CGFloat = 13
    var color: Color = FastTheme.textSecondary

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.125)) { context in
            let head = Int(context.date.timeIntervalSinceReferenceDate * 8) % 8
            ZStack {
                ForEach(0..<8, id: \.self) { ray in
                    let age = (head - ray + 8) % 8
                    Capsule()
                        .fill(color)
                        .frame(width: size * 0.14, height: size * 0.3)
                        .padding(.top, size * 0.03)
                        .frame(width: size, height: size, alignment: .top)
                        .rotationEffect(.degrees(Double(ray) * 45))
                        .opacity(1 - Double(age) * 0.09)
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel("In progress")
    }
}

/// A Lucide-sized SF Symbol before the title, at the mock's gap.
struct FastIconLabelStyle: LabelStyle {
    var iconSize: CGFloat = 13
    var spacing: CGFloat = 6

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: spacing) {
            configuration.icon.font(.system(size: iconSize, weight: .regular))
            configuration.title
        }
    }
}

// MARK: - Field

/// A text field drawn by hand, as offscreen snapshots skip the system bezel.
/// Each size is one mock's field: compact in a row (P5's token, 8x10), slim
/// (P5b's path, 7x10), large in a form (P3c, P3r, 11x12) and invite (P3's code, 12x14).
struct FastField: View {
    enum Size {
        case compact, slim, large, invite

        var vertical: CGFloat {
            switch self { case .compact: 8; case .slim: 7; case .large: 11; case .invite: 12 }
        }
        var horizontal: CGFloat {
            switch self { case .compact, .slim: 10; case .large: 12; case .invite: 14 }
        }
        var radius: CGFloat {
            switch self { case .compact, .slim: 8; case .large, .invite: 10 }
        }
        var points: CGFloat {
            switch self { case .compact, .slim: 12; case .large: 13; case .invite: 14 }
        }
        /// JetBrains Mono's line is 1.32 em, taller than SF Mono's, so a field holding a mono value keeps the mock's height.
        var monoLine: CGFloat { (points * 1.32).rounded() }
    }

    let placeholder: String
    @Binding var text: String
    var size: Size = .compact
    var monospaced = false
    var secure = false
    /// A secret's known public prefix (`lin_api_`), drawn in place of its first dots per `SecretPrefix.shown`.
    var maskPrefix: String? = nil
    /// The accessibility id, on the text field itself so scripts can type into it.
    var id: String? = nil
    /// What VoiceOver names the field, where the placeholder is an example value rather than its name.
    var label: String? = nil
    /// The invite field's quiet Paste, inside the trailing edge while the field is empty.
    var pasteable = false
    @FocusState private var focused: Bool

    init(_ placeholder: String, text: Binding<String>, size: Size = .compact, monospaced: Bool = false,
         secure: Bool = false, maskPrefix: String? = nil, id: String? = nil, label: String? = nil, pasteable: Bool = false) {
        self.placeholder = placeholder
        self._text = text
        self.size = size
        self.monospaced = monospaced
        self.secure = secure
        self.maskPrefix = maskPrefix
        self.id = id
        self.label = label
        self.pasteable = pasteable
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size.radius, style: .continuous)
        let showsPaste = pasteable && text.isEmpty
        HStack(spacing: 8) {
            ZStack(alignment: .leading) {
                if text.isEmpty {
                    Text(placeholder).font(.system(size: size.points)).foregroundColor(FastTheme.textTertiary)
                        .lineLimit(1).allowsHitTesting(false)
                }
                // The real field stays opaque, hit-testable and in the AX tree; at rest only its echo goes clear under the dots.
                input.font(font).foregroundColor(masked ? .clear : FastTheme.textPrimary).textFieldStyle(.plain).focused($focused)
                if masked { bullets }
            }
            if showsPaste {
                // Laid out at the text's line height, so the field keeps its height while Paste draws its full size.
                Button("Paste") { paste() }
                    .buttonStyle(FastSecondaryButtonStyle(shape: FastButtonShape(vertical: 4, horizontal: 9, radius: 6)))
                    .fixedSize()
                    .frame(height: (size.points * 1.25).rounded())
                    .transition(.opacity)
                    .modifier(FastAXID(id: id.map { $0 + ".paste" }))
            }
        }
        .frame(minHeight: monospaced && !text.isEmpty ? size.monoLine : nil)
        .padding(.vertical, size.vertical).padding(.leading, size.horizontal)
        .padding(.trailing, showsPaste ? 6 : size.horizontal)
        .animation(.easeOut(duration: 0.15), value: showsPaste)
        .background(shape.fill(FastTheme.fieldFill))
        .overlay(shape.strokeBorder(focused ? FastTheme.accent : FastTheme.outline, lineWidth: 1))
    }

    /// AppKit's secure echo is a large circle; at rest the field shows the mock's small dots instead.
    private var masked: Bool { secure && !focused && !text.isEmpty }

    private func paste() {
        guard let value = NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else { return }
        text = value
    }

    /// The known prefix in the value's own mono, then the mocks' dots, one per
    /// remaining character at the mono advance.
    private var bullets: some View {
        let advance = size.points * 0.6
        // Whole points: layout snaps each edge to the pixel grid (whole points on a 1x backing), so a fractional dot drew 2pt or 3pt by where it landed.
        let dot = (size.points * 0.24).rounded()
        let shown = SecretPrefix.shown(of: text, prefix: maskPrefix)
        return HStack(spacing: 0) {
            if !shown.isEmpty {
                Text(shown).font(font).foregroundColor(FastTheme.textPrimary).lineLimit(1).fixedSize()
            }
            ForEach(0..<min(text.count - shown.count, 64), id: \.self) { _ in
                Circle().fill(FastTheme.textPrimary).frame(width: dot, height: dot).frame(width: advance)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .clipped()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// Light, because AppKit draws a field's value a step heavier than SwiftUI text, and the mock's JetBrains Mono reads thinner still.
    private var font: Font {
        .system(size: size.points, weight: .light, design: monospaced ? .monospaced : .default)
    }

    @ViewBuilder private var input: some View {
        Group {
            if secure {
                SecureField("", text: $text)
            } else {
                TextField("", text: $text)
            }
        }
        .accessibilityLabel(label ?? placeholder)
        .modifier(FastAXID(id: id))
    }
}

/// An accessibility id only when there is one: an empty id would still name the element.
struct FastAXID: ViewModifier {
    let id: String?
    func body(content: Content) -> some View {
        if let id { content.accessibilityIdentifier(id) } else { content }
    }
}

/// A field's look around a value the person picks rather than types (P5b's
/// path, P5s's Repos go in): the value in light mono, or the placeholder.
struct FastValueField: View {
    let value: String?
    var placeholder = ""
    var size: FastField.Size = .compact

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size.radius, style: .continuous)
        Group {
            if let value, !value.isEmpty {
                Text(value).font(.system(size: size.points, weight: .light, design: .monospaced)).foregroundColor(FastTheme.textPrimary)
                    .lineLimit(1).truncationMode(.middle).textSelection(.enabled)
            } else {
                Text(placeholder).font(.system(size: size.points)).foregroundColor(FastTheme.textTertiary).lineLimit(1)
            }
        }
        .frame(minHeight: size.monoLine)
        .padding(.vertical, size.vertical).padding(.horizontal, size.horizontal)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(shape.fill(FastTheme.fieldFill))
        .overlay(shape.strokeBorder(FastTheme.outline, lineWidth: 1))
    }
}

// MARK: - Segmented control

/// The mocks' segmented pick: a field-fill track, the selected segment lifted
/// in the outline grey. Regular is P3c's forge pick; small is P5b's checkout pick.
struct FastSegmented<ID: Hashable>: View {
    enum Size { case regular, small }

    let options: [(id: ID, label: String)]
    @Binding var selection: ID
    var size: Size = .regular

    var body: some View {
        let small = size == .small
        HStack(spacing: 2) {
            ForEach(options, id: \.id) { option in
                let selected = option.id == selection
                Button { selection = option.id } label: {
                    Text(option.label)
                        .font(.system(size: small ? 11 : 12, weight: FastTheme.weight(css: selected ? .semibold : .medium)))
                        .foregroundColor(selected ? FastTheme.textPrimary : FastTheme.textSecondary)
                        .lineLimit(1)
                        .padding(.vertical, small ? 4 : 5).padding(.horizontal, small ? 10 : 12)
                        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(selected ? FastTheme.outline : Color.clear))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(3)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(FastTheme.fieldFill))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(FastTheme.divider, lineWidth: 1))
        .fixedSize()
    }
}

// MARK: - Lines and tiles

/// A quiet note: info icon and tertiary text (P5's "So mattstack can read and write Linear tickets").
/// `symbol` and `tint` make it a refusal line (warning) or another glyph.
/// `textWidth` caps the words alone, as P5b's CSS gives its note text 440.
struct FastHint: View {
    let text: String
    let size: CGFloat
    let symbol: String
    let tint: Color
    let textWidth: CGFloat?

    init(_ text: String, size: CGFloat = 11, symbol: String = "info.circle", tint: Color = FastTheme.textTertiary,
         textWidth: CGFloat? = nil) {
        self.text = text
        self.size = size
        self.symbol = symbol
        self.tint = tint
        self.textWidth = textWidth
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: symbol).font(.system(size: size + 1, weight: .light))
            Text(text).font(.system(size: size)).lineSpacing(1).fixedSize(horizontal: false, vertical: true)
                .modifier(FastWrapWidth(max: textWidth))
        }
        .foregroundColor(tint)
    }
}

/// Caps a wrapping line's width at `max` (or the space offered), and narrows it
/// when the last line would hold only a word or two, so the lines balance.
/// A last line of a quarter of the width or more stays as the mocks wrap it.
struct FastWrapWidth: ViewModifier {
    let max: CGFloat?
    func body(content: Content) -> some View { FastWrapWidthLayout(max: max) { content } }
}

private struct FastWrapWidthLayout: Layout {
    let max: CGFloat?

    private func width(_ proposal: ProposedViewSize, _ child: LayoutSubview) -> CGFloat? {
        let offered = [proposal.width, max].compactMap { $0 }.min()
        guard let offered, offered > 0 else { return offered }
        let ideal = child.sizeThatFits(.unspecified).width
        guard ideal > offered else { return offered }
        let lines = (ideal / offered).rounded(.up)
        let last = ideal - (lines - 1) * offered
        guard last < offered / 4 else { return offered }
        // Word wrapping loses some of each line; the margin keeps the balanced text on the same number of lines.
        return Swift.min(offered, (ideal / lines * 1.08 + 12).rounded(.up))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let child = subviews.first else { return .zero }
        return child.sizeThatFits(ProposedViewSize(width: width(proposal, child), height: nil))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard let child = subviews.first else { return }
        child.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(width: width(proposal, child), height: nil))
    }
}

/// A finished line where nothing trails it: the done disc, then the words in grey.
struct FastDoneLine: View {
    let text: String
    let size: CGFloat
    let weight: Font.Weight
    let spacing: CGFloat
    let iconSize: CGFloat?
    let textWidth: CGFloat?
    let off: Bool

    /// How far the text's baseline sits below the disc's centre, as a share of the text size: half SF's cap height
    /// (about 0.72), so the disc centres on the capitals.
    private static let baselineBelowCentre: CGFloat = 0.36

    init(_ text: String, size: CGFloat = 12, weight: Font.Weight = .regular, spacing: CGFloat = 8, iconSize: CGFloat? = nil,
         textWidth: CGFloat? = nil, off: Bool = false) {
        self.text = text
        self.size = size
        self.weight = weight
        self.spacing = spacing
        self.iconSize = iconSize
        self.textWidth = textWidth
        self.off = off
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: spacing) {
            FastDoneDisc(off: off, diameter: iconSize ?? size + 3)
                .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + size * Self.baselineBelowCentre }
            if !text.isEmpty {
                Text(text).font(.system(size: size, weight: weight)).lineSpacing(2).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: textWidth, alignment: .leading)
                    .foregroundColor(FastTheme.textSecondary)
            }
        }
    }
}

/// A finished mark: a green disc holding a dark tick, or a grey disc and dash for an answer of no.
struct FastDoneDisc: View {
    var off = false
    var diameter: CGFloat = 16

    var body: some View {
        ZStack {
            Circle().fill(off ? FastTheme.outline : FastTheme.success)
            if off {
                Capsule().fill(FastTheme.textSecondary).frame(width: diameter * 0.44, height: 1.5)
            } else if let tick = FastLucideGlyph(symbol: "checkmark", box: diameter * 0.625, lineWidth: diameter * 0.11) {
                tick.foregroundColor(FastTheme.windowBackground)
            }
        }
        .frame(width: diameter, height: diameter)
    }
}

/// P1's 36-point row tile: the icon in accent on a faint accent square, or in green once the row is done.
struct FastIconTile: View {
    let symbol: String
    var done = false

    init(symbol: String, done: Bool = false) {
        self.symbol = symbol
        self.done = done
    }

    var body: some View {
        glyph
            .foregroundColor(done ? FastTheme.success : FastTheme.accent)
            .frame(width: 36, height: 36)
            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(done ? FastTheme.successTile : FastTheme.accentTile))
            .accessibilityHidden(true)
    }
}

extension FastIconTile {
    @ViewBuilder fileprivate var glyph: some View {
        if let lucide = FastLucideGlyph(symbol: symbol) {
            lucide
        } else {
            // The CSS's 18 is Lucide's icon box; an SF glyph fills more of its box, so 16 matches the drawn size.
            Image(systemName: symbol).font(.system(size: 16, weight: .light))
        }
    }
}

/// Lucide shapes, traced from their 24-unit paths into the mock's icon box,
/// for the symbols whose nearest SF glyph reads as a different icon: SF's
/// person.2 sets two equal heads side by side, its laptop fills the screen,
/// its person closes the body, its plus is thinner, its internaldrive draws
/// a grille, its checkmark stands tall where Lucide's tick is shallow, its
/// ticket tilts, its checklist boxes its ticks, its bell sits heavier, its
/// message bubble is round, its arrow.right.to.line has no bracket, its
/// puzzle piece stands square and its globe draws a dense mesh.
struct FastLucideGlyph: View {
    let path: Path
    let box: CGFloat
    let lineWidth: CGFloat

    /// `lineWidth` defaults to Lucide's 2-unit stroke at `box`.
    init?(symbol: String, box: CGFloat = 18, lineWidth: CGFloat? = nil) {
        switch symbol {
        case "globe": path = Self.globe
        case "message": path = Self.messageSquare
        case "arrow.right.to.line": path = Self.logIn
        case "puzzlepiece.extension": path = Self.puzzle
        case "person.2": path = Self.users
        case "laptopcomputer": path = Self.laptop
        case "person": path = Self.user
        case "plus": path = Self.plus
        case "internaldrive": path = Self.hardDrive
        case "checkmark": path = Self.check
        case "ticket": path = Self.ticket
        case "checklist": path = Self.listChecks
        case "bell": path = Self.bell
        case "arrow.counterclockwise": path = Self.rotateCcw
        default: return nil
        }
        self.box = box
        self.lineWidth = lineWidth ?? box / 12
    }

    var body: some View {
        let scale = CGAffineTransform(scaleX: box / 24, y: box / 24)
        path.applying(scale)
            .stroke(style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
            .frame(width: box, height: box)
    }

    private static let globe = Path { p in
        p.addEllipse(in: CGRect(x: 2, y: 2, width: 20, height: 20))
        p.move(to: CGPoint(x: 12, y: 2))
        p.addArc(center: CGPoint(x: 22.5, y: 12), radius: 14.5, startAngle: .degrees(-136.397), endAngle: .degrees(136.397), clockwise: true)
        p.addArc(center: CGPoint(x: 1.5, y: 12), radius: 14.5, startAngle: .degrees(43.603), endAngle: .degrees(-43.603), clockwise: true)
        p.move(to: CGPoint(x: 2, y: 12))
        p.addLine(to: CGPoint(x: 22, y: 12))
    }

    private static let messageSquare = Path { p in
        p.move(to: CGPoint(x: 22, y: 17))
        p.addArc(center: CGPoint(x: 20, y: 17), radius: 2, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        p.addLine(to: CGPoint(x: 6.828, y: 19))
        p.addArc(center: CGPoint(x: 6.828, y: 21), radius: 2, startAngle: .degrees(-90), endAngle: .degrees(-135), clockwise: true)
        p.addLine(to: CGPoint(x: 3.212, y: 21.788))
        p.addArc(center: CGPoint(x: 2.71, y: 21.286), radius: 0.71, startAngle: .degrees(45), endAngle: .degrees(180), clockwise: false)
        p.addLine(to: CGPoint(x: 2, y: 5))
        p.addArc(center: CGPoint(x: 4, y: 5), radius: 2, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        p.addLine(to: CGPoint(x: 20, y: 3))
        p.addArc(center: CGPoint(x: 20, y: 5), radius: 2, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        p.closeSubpath()
    }

    private static let logIn = Path { p in
        p.move(to: CGPoint(x: 10, y: 17))
        p.addLine(to: CGPoint(x: 15, y: 12))
        p.addLine(to: CGPoint(x: 10, y: 7))
        p.move(to: CGPoint(x: 15, y: 12))
        p.addLine(to: CGPoint(x: 3, y: 12))
        p.move(to: CGPoint(x: 15, y: 3))
        p.addLine(to: CGPoint(x: 19, y: 3))
        p.addArc(center: CGPoint(x: 19, y: 5), radius: 2, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: 21, y: 19))
        p.addArc(center: CGPoint(x: 19, y: 19), radius: 2, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        p.addLine(to: CGPoint(x: 15, y: 21))
    }

    private static let puzzle = Path { p in
        p.move(to: CGPoint(x: 15.39, y: 4.39))
        p.addArc(center: CGPoint(x: 16.097, y: 3.683), radius: 1, startAngle: .degrees(135.029), endAngle: .degrees(13.459), clockwise: true)
        p.addArc(center: CGPoint(x: 19.501, y: 4.5), radius: 2.5, startAngle: .degrees(-166.492), endAngle: .degrees(76.511), clockwise: false)
        p.addArc(center: CGPoint(x: 20.317, y: 7.904), radius: 1, startAngle: .degrees(-103.459), endAngle: .degrees(134.971), clockwise: true)
        p.addLine(to: CGPoint(x: 21.293, y: 10.293))
        p.addArc(center: CGPoint(x: 19.586, y: 12), radius: 2.414, startAngle: .degrees(-45), endAngle: .degrees(45), clockwise: false)
        p.addLine(to: CGPoint(x: 19.61, y: 15.39))
        p.addArc(center: CGPoint(x: 18.903, y: 14.683), radius: 1, startAngle: .degrees(44.971), endAngle: .degrees(166.541), clockwise: false)
        p.addArc(center: CGPoint(x: 15.499, y: 15.5), radius: 2.5, startAngle: .degrees(-13.508), endAngle: .degrees(103.489), clockwise: true)
        p.addArc(center: CGPoint(x: 14.683, y: 18.904), radius: 1, startAngle: .degrees(-76.541), endAngle: .degrees(45.029), clockwise: false)
        p.addLine(to: CGPoint(x: 13.707, y: 21.293))
        p.addArc(center: CGPoint(x: 12, y: 19.586), radius: 2.414, startAngle: .degrees(45), endAngle: .degrees(135), clockwise: false)
        p.addLine(to: CGPoint(x: 8.61, y: 19.61))
        p.addArc(center: CGPoint(x: 7.903, y: 20.317), radius: 1, startAngle: .degrees(-44.971), endAngle: .degrees(-166.541), clockwise: true)
        p.addArc(center: CGPoint(x: 4.499, y: 19.5), radius: 2.5, startAngle: .degrees(13.508), endAngle: .degrees(-103.489), clockwise: false)
        p.addArc(center: CGPoint(x: 3.683, y: 16.096), radius: 1, startAngle: .degrees(76.541), endAngle: .degrees(-45.029), clockwise: true)
        p.addLine(to: CGPoint(x: 2.707, y: 13.707))
        p.addArc(center: CGPoint(x: 4.414, y: 12), radius: 2.414, startAngle: .degrees(135), endAngle: .degrees(-135), clockwise: false)
        p.addLine(to: CGPoint(x: 4.39, y: 8.61))
        p.addArc(center: CGPoint(x: 5.097, y: 9.317), radius: 1, startAngle: .degrees(-135.029), endAngle: .degrees(-13.459), clockwise: false)
        p.addArc(center: CGPoint(x: 8.501, y: 8.5), radius: 2.5, startAngle: .degrees(166.492), endAngle: .degrees(-76.511), clockwise: true)
        p.addArc(center: CGPoint(x: 9.317, y: 5.096), radius: 1, startAngle: .degrees(103.459), endAngle: .degrees(-134.971), clockwise: false)
        p.addLine(to: CGPoint(x: 10.293, y: 2.707))
        p.addArc(center: CGPoint(x: 12, y: 4.414), radius: 2.414, startAngle: .degrees(-135), endAngle: .degrees(-45), clockwise: false)
        p.closeSubpath()
    }

    private static let check = Path { p in
        p.move(to: CGPoint(x: 20, y: 6))
        p.addLine(to: CGPoint(x: 9, y: 17))
        p.addLine(to: CGPoint(x: 4, y: 12))
    }

    private static let ticket = Path { p in
        p.move(to: CGPoint(x: 2, y: 9))
        p.addArc(center: CGPoint(x: 2, y: 12), radius: 3, startAngle: .degrees(-90), endAngle: .degrees(90), clockwise: false)
        p.addLine(to: CGPoint(x: 2, y: 17))
        p.addArc(tangent1End: CGPoint(x: 2, y: 19), tangent2End: CGPoint(x: 4, y: 19), radius: 2)
        p.addArc(tangent1End: CGPoint(x: 22, y: 19), tangent2End: CGPoint(x: 22, y: 17), radius: 2)
        p.addLine(to: CGPoint(x: 22, y: 15))
        p.addArc(center: CGPoint(x: 22, y: 12), radius: 3, startAngle: .degrees(90), endAngle: .degrees(270), clockwise: false)
        p.addLine(to: CGPoint(x: 22, y: 7))
        p.addArc(tangent1End: CGPoint(x: 22, y: 5), tangent2End: CGPoint(x: 20, y: 5), radius: 2)
        p.addArc(tangent1End: CGPoint(x: 2, y: 5), tangent2End: CGPoint(x: 2, y: 7), radius: 2)
        p.closeSubpath()
        for y in [5, 11, 17] as [CGFloat] {
            p.move(to: CGPoint(x: 13, y: y))
            p.addLine(to: CGPoint(x: 13, y: y + 2))
        }
    }

    private static let listChecks = Path { p in
        for y in [7, 17] as [CGFloat] {
            p.move(to: CGPoint(x: 3, y: y))
            p.addLine(to: CGPoint(x: 5, y: y + 2))
            p.addLine(to: CGPoint(x: 9, y: y - 2))
        }
        for y in [6, 12, 18] as [CGFloat] {
            p.move(to: CGPoint(x: 13, y: y))
            p.addLine(to: CGPoint(x: 21, y: y))
        }
    }

    private static let rotateCcw = Path { p in
        p.addArc(center: CGPoint(x: 12, y: 12), radius: 9, startAngle: .degrees(180), endAngle: .degrees(-90), clockwise: true)
        p.addQuadCurve(to: CGPoint(x: 5.26, y: 5.74), control: CGPoint(x: 7.8, y: 3))
        p.addLine(to: CGPoint(x: 3, y: 8))
        p.move(to: CGPoint(x: 3, y: 3))
        p.addLine(to: CGPoint(x: 3, y: 8))
        p.addLine(to: CGPoint(x: 8, y: 8))
    }

    private static let bell = Path { p in
        p.move(to: CGPoint(x: 10.268, y: 21))
        p.addArc(center: CGPoint(x: 12, y: 20), radius: 2, startAngle: .degrees(150), endAngle: .degrees(30), clockwise: true)
        p.move(to: CGPoint(x: 3.262, y: 15.326))
        p.addQuadCurve(to: CGPoint(x: 4, y: 17), control: CGPoint(x: 2.6, y: 17))
        p.addLine(to: CGPoint(x: 20, y: 17))
        p.addQuadCurve(to: CGPoint(x: 20.74, y: 15.327), control: CGPoint(x: 21.4, y: 17))
        p.addCurve(to: CGPoint(x: 18, y: 8), control1: CGPoint(x: 19.41, y: 13.956), control2: CGPoint(x: 18, y: 12.499))
        p.addArc(center: CGPoint(x: 12, y: 8), radius: 6, startAngle: .degrees(0), endAngle: .degrees(180), clockwise: true)
        p.addCurve(to: CGPoint(x: 3.262, y: 15.326), control1: CGPoint(x: 6, y: 12.499), control2: CGPoint(x: 4.589, y: 13.956))
    }

    private static let hardDrive = Path { p in
        p.move(to: CGPoint(x: 2, y: 12))
        p.addArc(tangent1End: CGPoint(x: 6, y: 4), tangent2End: CGPoint(x: 18, y: 4), radius: 2)
        p.addArc(tangent1End: CGPoint(x: 18, y: 4), tangent2End: CGPoint(x: 22, y: 12), radius: 2)
        p.addLine(to: CGPoint(x: 22, y: 12))
        p.addArc(tangent1End: CGPoint(x: 22, y: 20), tangent2End: CGPoint(x: 2, y: 20), radius: 2)
        p.addArc(tangent1End: CGPoint(x: 2, y: 20), tangent2End: CGPoint(x: 2, y: 12), radius: 2)
        p.closeSubpath()
        p.move(to: CGPoint(x: 2, y: 12))
        p.addLine(to: CGPoint(x: 22, y: 12))
        p.move(to: CGPoint(x: 6, y: 16))
        p.addLine(to: CGPoint(x: 6.01, y: 16))
        p.move(to: CGPoint(x: 10, y: 16))
        p.addLine(to: CGPoint(x: 10.01, y: 16))
    }

    private static let users = Path { p in
        p.move(to: CGPoint(x: 16, y: 21))
        p.addArc(tangent1End: CGPoint(x: 16, y: 15), tangent2End: CGPoint(x: 12, y: 15), radius: 4)
        p.addArc(tangent1End: CGPoint(x: 2, y: 15), tangent2End: CGPoint(x: 2, y: 21), radius: 4)
        p.addLine(to: CGPoint(x: 2, y: 21))
        p.addEllipse(in: CGRect(x: 5, y: 3, width: 8, height: 8))
        p.move(to: CGPoint(x: 22, y: 21))
        p.addArc(center: CGPoint(x: 18, y: 19), radius: 4, startAngle: .degrees(0), endAngle: .degrees(-75.5), clockwise: true)
        p.move(to: CGPoint(x: 16, y: 3.13))
        p.addArc(center: CGPoint(x: 15, y: 7), radius: 4, startAngle: .degrees(-75.5), endAngle: .degrees(75.5), clockwise: false)
    }

    private static let user = Path { p in
        p.addEllipse(in: CGRect(x: 8, y: 3, width: 8, height: 8))
        p.move(to: CGPoint(x: 19, y: 21))
        p.addArc(tangent1End: CGPoint(x: 19, y: 15), tangent2End: CGPoint(x: 15, y: 15), radius: 4)
        p.addArc(tangent1End: CGPoint(x: 5, y: 15), tangent2End: CGPoint(x: 5, y: 21), radius: 4)
        p.addLine(to: CGPoint(x: 5, y: 21))
    }

    private static let plus = Path { p in
        p.move(to: CGPoint(x: 5, y: 12))
        p.addLine(to: CGPoint(x: 19, y: 12))
        p.move(to: CGPoint(x: 12, y: 5))
        p.addLine(to: CGPoint(x: 12, y: 19))
    }

    private static let laptop = Path { p in
        p.move(to: CGPoint(x: 4, y: 16))
        p.addArc(tangent1End: CGPoint(x: 4, y: 5), tangent2End: CGPoint(x: 20, y: 5), radius: 2)
        p.addArc(tangent1End: CGPoint(x: 20, y: 5), tangent2End: CGPoint(x: 20, y: 16), radius: 2)
        p.addLine(to: CGPoint(x: 20, y: 16))
        p.addLine(to: CGPoint(x: 21.3, y: 18.6))
        p.addQuadCurve(to: CGPoint(x: 20.4, y: 20), control: CGPoint(x: 21.7, y: 20))
        p.addLine(to: CGPoint(x: 3.6, y: 20))
        p.addQuadCurve(to: CGPoint(x: 2.7, y: 18.6), control: CGPoint(x: 2.3, y: 20))
        p.addLine(to: CGPoint(x: 4, y: 16))
        p.addLine(to: CGPoint(x: 20, y: 16))
    }
}

/// P4 and P7's 56-point tile above a centred heading: a Lucide glyph on the card fill.
struct FastHeroTile: View {
    let symbol: String
    let tint: Color

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        FastLucideGlyph(symbol: symbol, box: 26)
            .foregroundColor(tint)
            .frame(width: 56, height: 56)
            .background(shape.fill(FastTheme.card))
            .overlay(shape.strokeBorder(FastTheme.outline, lineWidth: 1))
            .accessibilityHidden(true)
    }
}

/// P4's pill naming the team: people icon and the name in spaced capitals.
struct FastTeamChip: View {
    let name: String

    var body: some View {
        HStack(spacing: 6) {
            FastLucideGlyph(symbol: "person.2", box: 12)
            Text(name.uppercased()).font(.system(size: 11, weight: .semibold)).tracking(1.2).lineLimit(1)
        }
        .foregroundColor(FastTheme.textSecondary)
        .padding(.vertical, 5).padding(.horizontal, 12)
        .background(Capsule(style: .circular).fill(FastTheme.card))
        .overlay(Capsule(style: .circular).strokeBorder(FastTheme.outline, lineWidth: 1))
        .fixedSize()
    }
}

/// A bordered card in the mock's card fill; content draws its own row dividers.
struct FastCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: FastTheme.cardRadius, style: .continuous)
        VStack(alignment: .leading, spacing: 0) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(shape.fill(FastTheme.card))
            .clipShape(shape)
            .overlay(shape.strokeBorder(FastTheme.outline, lineWidth: 1))
    }
}

/// The 1-point line between card rows, edge to edge.
struct FastRowDivider: View {
    var body: some View {
        Rectangle().fill(FastTheme.divider).frame(height: 1)
    }
}
