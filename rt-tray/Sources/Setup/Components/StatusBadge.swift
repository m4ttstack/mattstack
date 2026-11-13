import SwiftUI
import MattstackCore

struct StatusBadge: View {
    let row: PlanRow
    let isChecking: Bool
    let team: TeamInfo?
    var id: String? = nil
    private var status: RowStatus { isChecking ? .checking : row.status }
    private var spoken: String { !isChecking && StatusGlyph.isOff(row, team: team) ? "off" : status.rawValue }
    var body: some View {
        let symbol = isChecking ? StatusGlyph.symbol(for: .checking) : StatusGlyph.symbol(for: row, team: team)
        let badge = Group {
            if symbol == "progress" {
                ProgressView().controlSize(.small)
            } else if StatusGlyph.multicolor(for: row, team: team) {
                Image(systemName: symbol).symbolRenderingMode(.multicolor)
            } else {
                Image(systemName: symbol).foregroundStyle(color)
            }
        }
        .frame(width: 20, height: 20)
        .accessibilityLabel(Text(spoken))
        .accessibilityValue(Text(spoken))
        if let id {
            badge.accessibilityIdentifier(id)
        } else {
            badge
        }
    }
    /// Only reached when `!StatusGlyph.multicolor(for: row, team: team)`, which is exactly
    /// the rows whose tint is never `.yellow` -- so that case cannot occur here.
    private var color: Color {
        switch StatusGlyph.tint(for: row, team: team) {
        case .green: return .green
        case .red: return .red
        case .yellow: fatalError("StatusGlyph.multicolor already renders yellow-tinted statuses before color is used")
        case .grey: return .secondary
        case .none: return .primary
        }
    }
}
