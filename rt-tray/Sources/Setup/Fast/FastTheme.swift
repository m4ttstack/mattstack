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
    static let cardTitle = Font.system(size: 12, weight: .semibold)
    static let note = Font.system(size: 12)

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

/// The accent fill with white text. Large carries the mock's glow; disabled
/// drops to 40% and loses it, so it never reads as the system's grey bezel.
struct FastPrimaryButtonStyle: ButtonStyle {
    var size: FastButtonSize = .large

    func makeBody(configuration: Configuration) -> some View {
        Styled(configuration: configuration, size: size)
    }

    private struct Styled: View {
        let configuration: Configuration
        let size: FastButtonSize
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            let large = size == .large
            let shape = RoundedRectangle(cornerRadius: large ? 11 : 8, style: .continuous)
            configuration.label
                .font(.system(size: large ? 14 : 13, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)
                .padding(.vertical, large ? 11 : 7).padding(.horizontal, large ? 22 : 14)
                .background(shape.fill(FastTheme.accent))
                .overlay(shape.fill(Color.black.opacity(configuration.isPressed ? 0.15 : 0)))
                .shadow(color: large && isEnabled ? FastTheme.primaryGlow : .clear, radius: 12, y: 8)
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
                .labelStyle(FastIconLabelStyle(iconSize: 13, spacing: 6))
                .font(.system(size: 12, weight: .semibold))
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
/// Change, Locate…), large in a footer (Hide, Show log, Back).
struct FastSecondaryButtonStyle: ButtonStyle {
    var size: FastButtonSize = .small
    /// P3c's Create token sits on the field fill; most draw on whatever is behind them.
    var filled = false

    func makeBody(configuration: Configuration) -> some View {
        Styled(configuration: configuration, size: size, filled: filled)
    }

    private struct Styled: View {
        let configuration: Configuration
        let size: FastButtonSize
        let filled: Bool
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            let large = size == .large
            let shape = RoundedRectangle(cornerRadius: large ? 11 : 8, style: .continuous)
            configuration.label
                .labelStyle(FastIconLabelStyle(iconSize: large ? 14 : 13, spacing: 6))
                .font(.system(size: large ? 14 : 12, weight: .medium))
                .foregroundColor(FastTheme.textPrimary)
                .lineLimit(1)
                .padding(.vertical, large ? 10 : 7).padding(.horizontal, large ? 20 : 12)
                .background(shape.fill(filled ? FastTheme.fieldFill : Color.clear))
                .overlay(shape.fill(Color.white.opacity(configuration.isPressed ? 0.06 : 0)))
                .overlay(shape.strokeBorder(FastTheme.outline, lineWidth: 1))
                .opacity(isEnabled ? 1 : 0.4)
                .contentShape(shape)
        }
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
/// Compact sits in a row (P5's token field); large is a form field (P3c, P3r).
struct FastField: View {
    enum Size { case compact, large }

    let placeholder: String
    @Binding var text: String
    var size: Size = .compact
    var monospaced = false
    var secure = false
    /// The accent edge the mock gives a pasted value (P3's invite code).
    var highlighted = false
    @FocusState private var focused: Bool

    init(_ placeholder: String, text: Binding<String>, size: Size = .compact, monospaced: Bool = false,
         secure: Bool = false, highlighted: Bool = false) {
        self.placeholder = placeholder
        self._text = text
        self.size = size
        self.monospaced = monospaced
        self.secure = secure
        self.highlighted = highlighted
    }

    var body: some View {
        let large = size == .large
        let shape = RoundedRectangle(cornerRadius: large ? 10 : 8, style: .continuous)
        ZStack(alignment: .leading) {
            if text.isEmpty {
                Text(placeholder).font(font).foregroundColor(FastTheme.textTertiary).lineLimit(1).allowsHitTesting(false)
            }
            input.font(font).foregroundColor(FastTheme.textPrimary).textFieldStyle(.plain).focused($focused)
        }
        .padding(.vertical, large ? 11 : 8).padding(.horizontal, large ? 12 : 10)
        .background(shape.fill(FastTheme.fieldFill))
        .overlay(shape.strokeBorder(focused || highlighted ? FastTheme.accent : FastTheme.outline, lineWidth: 1))
    }

    private var font: Font {
        let points: CGFloat = size == .large ? 13 : 12
        return .system(size: points, design: monospaced ? .monospaced : .default)
    }

    @ViewBuilder private var input: some View {
        if secure {
            SecureField("", text: $text)
        } else {
            TextField("", text: $text)
        }
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
                        .font(.system(size: small ? 11 : 12, weight: selected ? .semibold : .medium))
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
struct FastHint: View {
    let text: String
    var size: CGFloat = 11

    init(_ text: String, size: CGFloat = 11) {
        self.text = text
        self.size = size
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "info.circle").font(.system(size: size + 2))
            Text(text).font(.system(size: size)).fixedSize(horizontal: false, vertical: true)
        }
        .foregroundColor(FastTheme.textTertiary)
    }
}

/// A finished line: checkmark and text in the success green (P5's "Connected as janedoe").
struct FastDoneLine: View {
    let text: String
    var size: CGFloat = 11
    var weight: Font.Weight = .regular

    init(_ text: String, size: CGFloat = 11, weight: Font.Weight = .regular) {
        self.text = text
        self.size = size
        self.weight = weight
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "checkmark").font(.system(size: size + 2, weight: .medium))
            Text(text).font(.system(size: size, weight: weight)).fixedSize(horizontal: false, vertical: true)
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
        Image(systemName: symbol)
            .font(.system(size: 16, weight: .regular))
            .foregroundColor(done ? FastTheme.success : FastTheme.accent)
            .frame(width: 36, height: 36)
            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(done ? FastTheme.successTile : FastTheme.accentTile))
            .accessibilityHidden(true)
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
