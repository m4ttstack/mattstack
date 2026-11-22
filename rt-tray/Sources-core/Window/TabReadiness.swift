import Foundation

/// What a page posts to the window's `mattstackHost` script message handler
/// (`packages/server/src/host-signal.ts`).
public enum HostSignal: Equatable, Sendable {
    case booting
    case ready(buildId: String?)
    case failed(reason: String)
    case fatal

    /// nil for anything that is not a well-formed signal.
    public static func parse(_ body: Any) -> HostSignal? {
        guard let message = body as? [String: Any], let type = message["type"] as? String else { return nil }
        switch type {
        case "booting":
            return .booting
        case "ready":
            switch message["buildId"] {
            case nil, is NSNull: return .ready(buildId: nil)
            case let buildId as String: return .ready(buildId: buildId)
            default: return nil
            }
        case "failed":
            guard let reason = message["reason"] as? String else { return nil }
            return .failed(reason: reason)
        case "fatal":
            return .fatal
        default:
            return nil
        }
    }
}

public enum TabPhase: Equatable, Sendable {
    case loading
    case ready
    case notReady(reason: String)
    /// The page shows its own boot error and reload button.
    case fatal
}

public struct TabState: Equatable, Sendable {
    public var phase: TabPhase = .loading
    /// The page sent `booting`, so WebKit's "finished" no longer means loaded.
    public var speaksProtocol = false
    public var buildId: String?
    /// One reload owed to a tab that failed by itself, spent once its app answers.
    public var reloadCredit = false
    public var lastHealth: AppHealth?
    /// The app now serves a different build than the page in the tab.
    public var stale = false
    fileprivate var navigationIsRecovery = false
    fileprivate var beforeNavigation: PageState?
    public init() {}
}

/// What a tab said about the page it showed before a navigation began.
fileprivate struct PageState: Equatable, Sendable {
    var phase: TabPhase
    var speaksProtocol: Bool
    var buildId: String?
    var stale: Bool
    var reloadCredit: Bool
    var navigationIsRecovery: Bool
}

public enum TabEvent: Equatable, Sendable {
    case navigationStarted(byRecovery: Bool)
    case navigationFinished
    case navigationFailed(reason: String)
    /// Cancelled, or interrupted by a policy decision such as a download:
    /// the page shown before it is still there.
    case navigationAbandoned(reason: String)
    case signal(HostSignal)
    case backstopElapsed
    case health(AppHealth)
}

public enum TabEffect: Equatable, Sendable { case reload, startBackstop, cancelBackstop }

public enum NavigationFailureKind: Equatable, Sendable { case failed, abandoned, alreadyReported }

public enum NavigationFailure {
    /// WebKitErrorFrameLoadInterruptedByPolicyChange: the window cancelled
    /// the response, as it does for a MIME type WebKit cannot show.
    static let frameLoadInterrupted = 102

    public static func kind(domain: String, code: Int, cancelledServerError: Bool) -> NavigationFailureKind {
        if cancelledServerError { return .alreadyReported }
        if domain == NSURLErrorDomain, code == NSURLErrorCancelled { return .abandoned }
        if domain == "WebKitErrorDomain", code == frameLoadInterrupted { return .abandoned }
        return .failed
    }
}

public enum TabOverlay: Equatable, Sendable { case none, loading, failure }

public enum TabReadinessTuning {
    /// How long a page that sent `booting` may stay silent after WebKit finished it.
    public static let backstop: TimeInterval = 15
    public static let healthInterval: TimeInterval = 2
}

/// A tab reloads by itself only when it is not ready, and only on an observed
/// change: its one credit, its app coming back, or its app's process changing.
public enum TabReadiness {
    public static func reduce(_ state: TabState, _ event: TabEvent) -> (TabState, [TabEffect]) {
        var next = state
        switch event {
        case .navigationStarted(let byRecovery):
            next.beforeNavigation = PageState(phase: state.phase, speaksProtocol: state.speaksProtocol,
                                              buildId: state.buildId, stale: state.stale,
                                              reloadCredit: state.reloadCredit,
                                              navigationIsRecovery: state.navigationIsRecovery)
            next.phase = .loading
            next.speaksProtocol = false
            next.buildId = nil
            next.stale = false
            next.navigationIsRecovery = byRecovery
            if !byRecovery { next.reloadCredit = false }
            return (next, [.cancelBackstop])

        case .signal(.booting):
            next.speaksProtocol = true
            return (next, [])

        case .navigationFinished:
            guard state.phase == .loading else { return (state, []) }
            if state.speaksProtocol { return (state, [.startBackstop]) }
            next.phase = .ready
            return (next, [])

        case .signal(.ready(let buildId)):
            guard state.speaksProtocol else { return (state, []) }
            next.phase = .ready
            next.buildId = buildId
            return (next, [.cancelBackstop])

        case .signal(.failed(let reason)):
            guard state.speaksProtocol, state.phase == .loading else { return (state, []) }
            return (failing(state, into: .notReady(reason: reason)), [.cancelBackstop])

        case .navigationFailed(let reason):
            guard state.phase == .loading else { return (state, []) }
            return (failing(state, into: .notReady(reason: reason)), [.cancelBackstop])

        case .navigationAbandoned(let reason):
            guard state.phase == .loading else { return (state, []) }
            guard let page = state.beforeNavigation, page.phase != .loading, !state.speaksProtocol else {
                return reduce(state, .navigationFailed(reason: reason))
            }
            next.phase = page.phase
            next.speaksProtocol = page.speaksProtocol
            next.buildId = page.buildId
            next.stale = page.stale
            next.reloadCredit = page.reloadCredit
            next.navigationIsRecovery = page.navigationIsRecovery
            next.beforeNavigation = nil
            return (next, [])

        case .backstopElapsed:
            guard state.phase == .loading else { return (state, []) }
            return (failing(state, into: .notReady(reason: "no ready signal")), [.cancelBackstop])

        case .signal(.fatal):
            guard state.speaksProtocol else { return (state, []) }
            return (failing(state, into: .fatal), [.cancelBackstop])

        case .health(let health):
            return onHealth(state, health)
        }
    }

    public static func overlay(_ state: TabState) -> TabOverlay {
        switch state.phase {
        case .loading: return .loading
        case .notReady: return .failure
        case .ready, .fatal: return .none
        }
    }

    /// True while the health loop must run.
    public static func needsHealthLoop(_ states: [TabState]) -> Bool {
        states.contains(where: needsHealth)
    }

    static func needsHealth(_ state: TabState) -> Bool {
        switch state.phase {
        case .notReady, .fatal: return true
        case .loading, .ready: return false
        }
    }

    /// A recovery navigation that fails keeps the health it reloaded on, so
    /// only a later change of that health reloads it again.
    private static func failing(_ state: TabState, into phase: TabPhase) -> TabState {
        var next = state
        next.phase = phase
        if !state.navigationIsRecovery {
            next.lastHealth = nil
            next.reloadCredit = true
        }
        return next
    }

    private static func onHealth(_ state: TabState, _ health: AppHealth) -> (TabState, [TabEffect]) {
        var next = state
        switch state.phase {
        case .notReady, .fatal:
            next.lastHealth = health
            guard health.answering else { return (next, []) }
            let cameBack = state.lastHealth?.answering == false
            let newProcess = state.lastHealth?.token.map { old in health.token.map { $0 != old } ?? false } ?? false
            guard state.reloadCredit || cameBack || newProcess else { return (next, []) }
            next.reloadCredit = false
            return (next, [.reload])
        case .ready:
            if let page = state.buildId, let served = health.buildId { next.stale = page != served }
            return (next, [])
        case .loading:
            return (state, [])
        }
    }
}
