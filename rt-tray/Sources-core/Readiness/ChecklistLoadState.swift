import Foundation

/// What the checklist area shows before, while and after the first plan
/// arrives. Once any plan has loaded the rows stay on screen for good: a
/// later refresh, failed or in flight, is reported around them, never by
/// swapping them out for a spinner or an error page.
public enum ChecklistLoadState: Equatable, Sendable {
    case loading
    case failed(String)
    case loaded

    /// No plan, no error and no fetch in flight is still `.loading`: a window
    /// paints before its first fetch starts, and that frame must not be blank.
    public static func resolve(hasLoadedPlan: Bool, isLoading: Bool, lastError: String?) -> ChecklistLoadState {
        if hasLoadedPlan { return .loaded }
        if let lastError, !isLoading { return .failed(lastError) }
        return .loading
    }
}
