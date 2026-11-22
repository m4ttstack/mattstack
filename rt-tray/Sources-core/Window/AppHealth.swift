import Foundation

public struct AppHealth: Equatable, Sendable {
    public let answering: Bool
    /// Changes when the app's process does: a mattstack app's bootId, deck's pid.
    public let token: String?
    public let buildId: String?

    public init(answering: Bool, token: String? = nil, buildId: String? = nil) {
        self.answering = answering
        self.token = token
        self.buildId = buildId
    }
}

public enum AppHealthParse {
    /// A mattstack health answer, or nil when the response is not one
    /// (not JSON with a boolean `ok`), which sends the caller to the fallback.
    public static func mattstack(status: Int, body: Data) -> AppHealth? {
        guard let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let okValue = object["ok"] as? NSNumber,
              CFGetTypeID(okValue) == CFBooleanGetTypeID() else { return nil }
        return AppHealth(answering: okValue.boolValue && status == 200,
                         token: object["bootId"] as? String,
                         buildId: object["buildId"] as? String)
    }

    public static func deck(status: Int, pid: String?) -> AppHealth {
        guard case .healthy(let pid) = DeckHealth.classify(status: status, deckPid: pid) else {
            return AppHealth(answering: false)
        }
        return AppHealth(answering: true, token: pid)
    }

    /// A 5xx is what the local proxy answers for an app that is not listening.
    public static func fallback(status: Int?) -> AppHealth {
        guard let status else { return AppHealth(answering: false) }
        return AppHealth(answering: (100...499).contains(status))
    }
}
