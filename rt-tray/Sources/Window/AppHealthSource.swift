import Foundation
import MattstackCore

protocol AppHealthSource: Sendable {
    func check(_ app: DiscoveryApp) async -> AppHealth
}

/// Every tab gets an answer: deck's /healthz, a mattstack app's /api/health,
/// and for anything else (a user's app, an older build, a page answering
/// /api/health with HTML) whether its home URL answers below 500.
struct URLSessionAppHealthSource: AppHealthSource {
    static let timeout: TimeInterval = 3

    private let sessions = HostSessions()

    func check(_ app: DiscoveryApp) async -> AppHealth {
        guard let base = URL(string: app.url) else { return AppHealth(answering: false) }
        if app.name == WindowModel.deckApp.name {
            guard let (_, http) = await get(base.appendingPathComponent("healthz")) else {
                return AppHealth(answering: false)
            }
            return AppHealthParse.deck(status: http.statusCode, pid: http.value(forHTTPHeaderField: "x-deck-pid"))
        }
        if let (body, http) = await get(base.appendingPathComponent("api/health")),
           let health = AppHealthParse.mattstack(status: http.statusCode, body: body) {
            return health
        }
        return AppHealthParse.fallback(status: await get(base)?.1.statusCode)
    }

    private func get(_ url: URL) async -> (Data, HTTPURLResponse)? {
        guard let session = sessions.session(for: url) else { return nil }
        let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: Self.timeout)
        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse else { return nil }
        return (data, http)
    }
}

/// Every *.mattstack host is the same local proxy, so one shared session
/// coalesces requests for different apps onto one HTTP/2 connection and the
/// second host's TLS trust evaluation fails (see BadgePoller).
private final class HostSessions: @unchecked Sendable {
    private let lock = NSLock()
    private var pool = PerHostPool<URLSession>()

    func session(for url: URL) -> URLSession? {
        lock.withLock { pool.value(for: url, make: Self.makeSession) }
    }

    private static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = URLSessionAppHealthSource.timeout
        config.timeoutIntervalForResource = URLSessionAppHealthSource.timeout * 2
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCredentialStorage = nil
        return URLSession(configuration: config)
    }
}
