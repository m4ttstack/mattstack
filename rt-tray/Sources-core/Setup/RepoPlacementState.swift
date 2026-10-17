import Foundation

/// The pure part of a "Your repos" row: rt decides the placement, this only picks the copy and colour for what rt sent.
public enum RepoPlacementState {
    public enum NoteStyle: Equatable, Sendable { case ok, secondary, problem }

    public static let checkout = "checkout"
    public static let clone = "clone"

    /// `lastError` is the refused pick (or rt's `problem`): the button then offers to try again.
    public static func buttonLabel(mode: String, lastError: String?) -> String {
        let again = lastError != nil
        if mode == clone { return again ? "Choose another location…" : "Choose location…" }
        return again ? "Locate again…" : "Locate…"
    }

    public static func noteStyle(action: RowAction, lastError: String?) -> NoteStyle {
        if lastError != nil || action.problem != nil { return .problem }
        return action.mode == checkout ? .ok : .secondary
    }

    /// The path the shown segment stands for; nil is a Current checkout segment with no checkout yet.
    public static func path(mode: String, action: RowAction) -> String? {
        mode == clone ? action.clonePath : action.checkoutPath
    }
}
