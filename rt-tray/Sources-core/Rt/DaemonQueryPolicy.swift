import Foundation

/// When an HTTP query to the daemon may be retried over the Unix socket.
/// Only a failure to connect proves the daemon never saw the request; after a
/// timeout or a reply it is already handling it, and a retry doubles the load
/// on a busy daemon (and drains `notifications` twice).
public enum DaemonHTTPFallback {
    private static let neverConnected: Set<URLError.Code> = [
        .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed, .notConnectedToInternet,
    ]

    public static func socketMayRetry(after error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        return neverConnected.contains(urlError.code)
    }
}

/// Lets a frequent tick run an expensive probe at a slower cadence.
public struct ThrottledProbe {
    public let interval: TimeInterval
    private var lastRunAt: Date?

    public init(interval: TimeInterval) {
        self.interval = interval
    }

    public func isDue(now: Date) -> Bool {
        guard let lastRunAt else { return true }
        return now.timeIntervalSince(lastRunAt) >= interval
    }

    public mutating func markRun(at now: Date) {
        lastRunAt = now
    }
}
