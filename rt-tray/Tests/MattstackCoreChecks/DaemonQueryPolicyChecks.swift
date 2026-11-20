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
    Check("daemon http fallback: a 401 retries over the socket, other replies never do") { c in
        c.expect(DaemonHTTPFallback.socketMayRetry(afterStatus: 401))
        c.expect(!DaemonHTTPFallback.socketMayRetry(afterStatus: 500))
        c.expect(!DaemonHTTPFallback.socketMayRetry(afterStatus: 503))
        c.expect(!DaemonHTTPFallback.socketMayRetry(afterStatus: 404))
    },
]
