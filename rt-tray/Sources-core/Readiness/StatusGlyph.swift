import Foundation

public enum GlyphTint: Equatable, Sendable { case green, red, yellow, grey, none }

public enum StatusGlyph {
    /// "progress" is the sentinel the view turns into a small ProgressView.
    public static func symbol(for status: RowStatus) -> String {
        switch status {
        case .ready: return "checkmark.circle.fill"
        case .error, .invalid: return "xmark.circle"
        case .needsYou, .missing: return "exclamationmark.triangle.fill"
        case .skipped: return "circle.dotted"
        case .checking: return "progress"
        }
    }
    public static func tint(for status: RowStatus) -> GlyphTint {
        switch status {
        case .ready: return .green
        case .error, .invalid: return .red
        case .needsYou, .missing: return .yellow
        case .skipped: return .grey
        case .checking: return .none
        }
    }
    /// True for the yellow-tinted statuses: the view then renders the system's
    /// own multicolor warning (yellow fill, dark "!"), the same as System Settings.
    public static func multicolor(for status: RowStatus) -> Bool {
        tint(for: status) == .yellow
    }

    /// Mirrors `checklistStatus` in lib/setup/plan-blocks.ts: on Just me an
    /// account that blocks neither Install nor Finish, left unconnected, is
    /// off, not a warning. A team Mac, or no plan read yet, keeps the warning.
    public static func isOff(_ row: PlanRow, team: TeamInfo?) -> Bool {
        (team?.isSolo ?? false) && row.kind == .account && !row.required && !row.finishGated && row.status == .missing
    }
    public static func symbol(for row: PlanRow, team: TeamInfo?) -> String {
        isOff(row, team: team) ? "circle" : symbol(for: row.status)
    }
    public static func tint(for row: PlanRow, team: TeamInfo?) -> GlyphTint {
        isOff(row, team: team) ? .grey : tint(for: row.status)
    }
    public static func multicolor(for row: PlanRow, team: TeamInfo?) -> Bool {
        tint(for: row, team: team) == .yellow
    }
}
