/// Overlapping refreshes can finish out of order; only the most recent one
/// started may apply what it read.
public struct LatestOnly: Sendable {
    private var current = 0

    public init() {}

    public mutating func start() -> Int {
        current += 1
        return current
    }

    public func isLatest(_ ticket: Int) -> Bool {
        ticket == current
    }
}
