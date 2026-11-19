import Foundation

/// When an HTTP query to the daemon may be retried over the Unix socket.
/// Only a request the daemon never handled may retry: after a timeout it is
/// already working on it, and a retry doubles the load on a busy daemon.
public enum DaemonHTTPFallback {
    private static let neverConnected: Set<URLError.Code> = [
        .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed, .notConnectedToInternet,
    ]

    public static func socketMayRetry(after error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        return neverConnected.contains(urlError.code)
    }

    /// The tray sends no API token, so a token-gated route
    /// (`/api/notifications`) answers 401 without running; the socket is
    /// the only way it is served.
    public static func socketMayRetry(afterStatus status: Int) -> Bool {
        status == 401
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
