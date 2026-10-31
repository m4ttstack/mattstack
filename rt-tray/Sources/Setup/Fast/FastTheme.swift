import AppKit
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
    static let card = Color(hex: 0x21212B)
    static let fieldFill = Color(hex: 0x14141B)

    static let textPrimary = Color(hex: 0xF4F4F5)
    static let textSecondary = Color(hex: 0x9D9DA6)
    static let textTertiary = Color(hex: 0x7A7A85)
    static let accent = Color(hex: 0xE64980)
    static let success = Color(hex: 0x4ADE80)
    static let warning = Color(hex: 0xF5A524)

    static let accentTile = Color(hex: 0xE64980, alpha: 0x24)
    static let successTile = Color(hex: 0x4ADE80, alpha: 0x1F)
    static let primaryGlow = Color(hex: 0xE64980, alpha: 0x66)

    // MARK: Type

    static let heading = Font.system(size: 26, weight: .bold)
    static let headingTracking: CGFloat = -0.8
    static let sub = Font.system(size: 14)
    static let cardTitle = Font.system(size: 12, weight: weight(css: .semibold))
    static let note = Font.system(size: 12)

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
        Text(text).font(sub).foregroundColor(textSecondary)
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

    func makeBody(configuration: Configuration) -> some View {
        Styled(configuration: configuration, size: size, glow: glow, metrics: shape ?? .standard(size, primary: true))
    }

    private struct Styled: View {
        let configuration: Configuration
        let size: FastButtonSize
        let glow: Bool
        let metrics: FastButtonShape
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            let large = size == .large
            let shape = RoundedRectangle(cornerRadius: metrics.radius, style: .continuous)
            configuration.label
                .font(.system(size: large ? 14 : 13, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)
                .padding(.vertical, metrics.vertical).padding(.horizontal, metrics.horizontal)
                .background(shape.fill(FastTheme.accent).overlay(shape.fill(Color.black.opacity(configuration.isPressed ? 0.15 : 0))))
                .shadow(color: large && glow && isEnabled ? FastTheme.primaryGlow : .clear, radius: 12, y: 8)
                .opacity(isEnabled ? 1 : 0.4)
                .contentShape(shape)
        }
    }
}

/// Transparent with an accent edge, accent text and an optional leading icon
/// (P5's Connect Slack, Sign in to Claude, Add to Chrome).
struct FastOutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Styled(configuration: configuration)
    }

    private struct Styled: View {
        let configuration: Configuration
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
            configuration.label
                .labelStyle(FastIconLabelStyle(iconSize: 12, spacing: 6))
                .font(.system(size: 12, weight: FastTheme.weight(css: .semibold)))
                .foregroundColor(FastTheme.accent)
                .lineLimit(1)
                .padding(.vertical, 7).padding(.horizontal, 12)
                .background(shape.fill(FastTheme.accent.opacity(configuration.isPressed ? 0.14 : 0)))
                .overlay(shape.strokeBorder(FastTheme.accent, lineWidth: 1))
                .opacity(isEnabled ? 1 : 0.4)
                .contentShape(shape)
        }
    }
}

/// A quiet outlined button in primary text: small in a row (Create token,
/// Change, Locate…), large in a footer (Hide, Show log, Back). `shape`
/// takes a screen's own padding and corner (`FastButtonShape.slim` and so on).
struct FastSecondaryButtonStyle: ButtonStyle {
    var size: FastButtonSize = .small
    var shape: FastButtonShape? = nil

    func makeBody(configuration: Configuration) -> some View {
        Styled(configuration: configuration, size: size, metrics: shape ?? .standard(size, primary: false))
    }

    private struct Styled: View {
        let configuration: Configuration
        let size: FastButtonSize
        let metrics: FastButtonShape
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            let large = size == .large
            let shape = RoundedRectangle(cornerRadius: metrics.radius, style: .continuous)
            configuration.label
                .labelStyle(FastIconLabelStyle(iconSize: large ? 14 : 12, spacing: 6))
                .font(.system(size: large ? 14 : 12, weight: FastTheme.weight(css: .medium)))
                .foregroundColor(FastTheme.textPrimary)
                .lineLimit(1)
                .padding(.vertical, metrics.vertical).padding(.horizontal, metrics.horizontal)
                .background(shape.fill(Color.white.opacity(configuration.isPressed ? 0.06 : 0)))
                .overlay(shape.strokeBorder(FastTheme.outline, lineWidth: 1))
                .opacity(isEnabled ? 1 : 0.4)
                .contentShape(shape)
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

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.125)) { context in
            let head = Int(context.date.timeIntervalSinceReferenceDate * 8) % 8
            ZStack {
                ForEach(0..<8, id: \.self) { ray in
                    let age = (head - ray + 8) % 8
                    Capsule()
                        .fill(FastTheme.textSecondary)
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
    /// The accent edge the mock gives a pasted value (P3's invite code).
    var highlighted = false
    /// The accessibility id, on the text field itself so scripts can type into it.
    var id: String? = nil
    @FocusState private var focused: Bool

    init(_ placeholder: String, text: Binding<String>, size: Size = .compact, monospaced: Bool = false,
         secure: Bool = false, highlighted: Bool = false, id: String? = nil) {
        self.placeholder = placeholder
        self._text = text
        self.size = size
        self.monospaced = monospaced
        self.secure = secure
        self.highlighted = highlighted
        self.id = id
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size.radius, style: .continuous)
        ZStack(alignment: .leading) {
            if text.isEmpty {
                Text(placeholder).font(.system(size: size.points)).foregroundColor(FastTheme.textTertiary)
                    .lineLimit(1).allowsHitTesting(false)
            }
            // The real field stays opaque, hit-testable and in the AX tree; at rest only its echo goes clear under the dots.
            input.font(font).foregroundColor(masked ? .clear : FastTheme.textPrimary).textFieldStyle(.plain).focused($focused)
            if masked { bullets }
        }
        .frame(minHeight: monospaced && !text.isEmpty ? size.monoLine : nil)
        .padding(.vertical, size.vertical).padding(.horizontal, size.horizontal)
        .background(shape.fill(FastTheme.fieldFill))
        .overlay(shape.strokeBorder(focused || highlighted ? FastTheme.accent : FastTheme.outline, lineWidth: 1))
    }

    /// AppKit's secure echo is a large circle; at rest the field shows the mock's small dots instead.
    private var masked: Bool { secure && !focused && !text.isEmpty }

    /// P5's small dots, one per character at the mono advance.
    private var bullets: some View {
        let advance = size.points * 0.6
        return HStack(spacing: 0) {
            ForEach(0..<min(text.count, 64), id: \.self) { _ in
                Circle().fill(FastTheme.textPrimary).frame(width: 2.5, height: 2.5).frame(width: advance)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .clipped()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// Light, because the mock's JetBrains Mono reads thinner than SF Mono at the same size.
    private var font: Font {
        monospaced ? .system(size: size.points, weight: .light, design: .monospaced) : .system(size: size.points)
    }

    @ViewBuilder private var input: some View {
        Group {
            if secure {
                SecureField("", text: $text)
            } else {
                TextField("", text: $text)
            }
        }
        .accessibilityLabel(placeholder)
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
    var size: CGFloat = 11
    var symbol = "info.circle"
    var tint = FastTheme.textTertiary
    var textWidth: CGFloat? = nil

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
            Text(text).font(.system(size: size)).lineSpacing(2).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: textWidth, alignment: .leading)
        }
        .foregroundColor(tint)
    }
}

/// A finished line: checkmark and text in the success green (P5's "Connected as janedoe").
/// P5's done row spaces the two 10 apart; P5b's note and P1's "On" use 6.
struct FastDoneLine: View {
    let text: String
    var size: CGFloat = 11
    var weight: Font.Weight = .regular
    var spacing: CGFloat = 6
    var iconSize: CGFloat? = nil
    var textWidth: CGFloat? = nil

    init(_ text: String, size: CGFloat = 11, weight: Font.Weight = .regular, spacing: CGFloat = 6, iconSize: CGFloat? = nil,
         textWidth: CGFloat? = nil) {
        self.text = text
        self.size = size
        self.weight = weight
        self.spacing = spacing
        self.iconSize = iconSize
        self.textWidth = textWidth
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: spacing) {
            // Lucide's check fills about 80% of its box: the 13-point box of P5 draws as an 11-point glyph.
            Image(systemName: "checkmark").font(.system(size: iconSize ?? size, weight: .regular))
            Text(text).font(.system(size: size, weight: weight)).lineSpacing(2).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: textWidth, alignment: .leading)
        }
        .foregroundColor(FastTheme.success)
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
        if symbol == "globe" {
            FastGlobeGlyph()
        } else {
            // The CSS's 18 is Lucide's icon box; an SF glyph fills more of its box, so 16 matches the drawn size.
            Image(systemName: symbol).font(.system(size: 16, weight: .light))
        }
    }
}

/// Lucide's globe in its 18-point box: a ring, the lens of one meridian and
/// the equator. SF's globe draws three of each, a dense mesh at tile size.
private struct FastGlobeGlyph: View {
    var body: some View {
        let ring: CGFloat = 15
        let stroke: CGFloat = 1.2
        ZStack {
            Circle().strokeBorder(lineWidth: stroke).frame(width: ring, height: ring)
            Ellipse().strokeBorder(lineWidth: stroke).frame(width: 6.5, height: ring)
            Rectangle().frame(width: ring - stroke, height: stroke)
        }
        .frame(width: 18, height: 18)
    }
}

/// P4's pill naming the team: people icon and the name in spaced capitals.
struct FastTeamChip: View {
    let name: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "person.2").font(.system(size: 11))
            Text(name.uppercased()).font(.system(size: 11, weight: .semibold)).tracking(1.2).lineLimit(1)
        }
        .foregroundColor(FastTheme.textSecondary)
        .padding(.vertical, 5).padding(.horizontal, 12)
        .background(Capsule().fill(FastTheme.card))
        .overlay(Capsule().strokeBorder(FastTheme.outline, lineWidth: 1))
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
