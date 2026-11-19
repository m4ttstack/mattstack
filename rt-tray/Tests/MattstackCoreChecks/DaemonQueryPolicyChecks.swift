import Foundation
@testable import MattstackCore

let daemonQueryPolicyChecks: [Check] = [
    Check("daemon http fallback: a refused connection retries over the socket") { c in
        c.expect(DaemonHTTPFallback.socketMayRetry(after: URLError(.cannotConnectToHost)))
        c.expect(DaemonHTTPFallback.socketMayRetry(after: URLError(.cannotFindHost)))
    },
    Check("daemon http fallback: a timeout never retries, the daemon is already handling the request") { c in
        c.expect(!DaemonHTTPFallback.socketMayRetry(after: URLError(.timedOut)))
    },
    Check("daemon http fallback: a dropped connection or a non-URL error never retries") { c in
        c.expect(!DaemonHTTPFallback.socketMayRetry(after: URLError(.networkConnectionLost)))
        c.expect(!DaemonHTTPFallback.socketMayRetry(after: CocoaError(.fileReadUnknown)))
    },
    Check("throttled probe: due on first use, then not again until the interval passes") { c in
        var probe = ThrottledProbe(interval: 55)
        let start = Date(timeIntervalSince1970: 1_000)
        c.expect(probe.isDue(now: start))
        probe.markRun(at: start)
        let dueAt = stride(from: 10.0, through: 60, by: 10).map { probe.isDue(now: start.addingTimeInterval($0)) }
        c.expectEqual(dueAt, [false, false, false, false, false, true])
    },
]
