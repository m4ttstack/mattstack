import Foundation

/// One rehearsal of setup, run by the stub rt's scenario of the same shape.
public enum TestDriveScenario: String, CaseIterable, Identifiable, Sendable {
    case join, create, solo, restore, paused, slow

    public var id: String { rawValue }

    /// `RT_STUB_SCENARIO` in rt-tray/Tests/stub-rt/stub.ts.
    public var stubScenario: String {
        switch self {
        case .join: return "join-happy"
        case .create: return "create-happy"
        case .solo: return "solo"
        case .restore: return "restore"
        case .paused: return "apply-fail-retry"
        case .slow: return "slow"
        }
    }

    public var title: String {
        switch self {
        case .join: return "Join a team"
        case .create: return "Create a team"
        case .solo: return "Just me"
        case .restore: return "Move from another Mac"
        case .paused: return "A run that pauses"
        case .slow: return "Slow installs"
        }
    }

    public var detail: String {
        switch self {
        case .join: return "The admin approves after a short wait"
        case .create: return "Make a new team and own it"
        case .solo: return "No team, just this Mac"
        case .restore: return "Restore settings from a backup repo"
        case .paused: return "One step fails, then Retry works"
        case .slow: return "Installs and the run take longer"
        }
    }
}

public enum TestDriveSpeed: String, CaseIterable, Identifiable, Sendable {
    case instant, realistic

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .instant: return "Instant"
        case .realistic: return "Realistic"
        }
    }

    public var detail: String {
        switch self {
        case .instant: return "Waits take a second or two, the run a few seconds"
        case .realistic: return "Waits take a few seconds, the run about a minute"
        }
    }

    /// How long the pretend person takes over a System Settings pane, a macOS prompt or an admin password.
    public var answerDelay: TimeInterval {
        switch self {
        case .instant: return 0.75
        case .realistic: return 3
        }
    }

    /// The real join page checks every 15 s, which would hold an instant drive on P4 for nothing.
    public var joinPollInterval: TimeInterval {
        switch self {
        case .instant: return 1
        case .realistic: return 5
        }
    }
}

/// The setup window on the stub rt, for a person to rehearse setup on their own Mac without it changing anything.
public enum TestDrive {
    /// The prod bundle never offers it: the stub runs from a checkout under bun, which only a dev Mac has.
    public static func isAvailable(isDevBuild: Bool, isDebugBuild: Bool) -> Bool { isDevBuild || isDebugBuild }

    public static let stubInCheckout = "rt-tray/Tests/stub-rt/stub.ts"

    /// bun running the first checkout that has the stub, or nil when no checkout or no bun is there.
    public static func stubLocation(checkouts: [String], buns: [String], fileExists: (String) -> Bool) -> RtLocation? {
        guard let stub = checkouts.lazy.map({ "\($0)/\(stubInCheckout)" }).first(where: fileExists),
              let bun = buns.first(where: fileExists) else { return nil }
        return RtLocation(executable: URL(fileURLWithPath: bun), argumentPrefix: [stub], source: .stub)
    }

    /// Laid over the app's own environment for every stub call. HOME is the drive's own, so a verb that
    /// writes under it (`setup finish`) writes there; the app socket points nowhere, so nothing reaches this app's server.
    public static func environment(scenario: TestDriveScenario, speed: TestDriveSpeed, stateDir: String, home: String) -> [String: String] {
        [
            "RT_STUB_SCENARIO": scenario.stubScenario,
            "RT_STUB_SPEED": speed.rawValue,
            "RT_STUB_STATE_DIR": stateDir,
            "RT_STUB_REAL_WRITING_STYLE": "",
            "HOME": home,
            "RT_APP_SOCKET": "\(home)/no-app.sock",
        ]
    }

    /// What Paste fills on the invite screen: a code `JoinLink` reads, which the stub accepts.
    public static let sampleInvite = "01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567-89ABC-DEFGH-JKMNP-QRSTV-WXYZ0-12345-6789A-BC"

    /// The one call made before a drive starts. It writes nothing, and a stub without the drive's verbs refuses it.
    public static let probeArguments = ["stub", "grant", "--probe", "--json"]

    /// Why no drive can start on this stub, or nil when it answered the probe. A nil result is a stub bun could not run.
    public static func stubProblem(probe: RtResult?) -> String? {
        guard let probe else { return TestDriveCopy.stubWontRun }
        struct Reply: Decodable { let probe: Bool? }
        guard probe.exitCode == 0, (try? probe.decode(Reply.self))?.probe == true else { return TestDriveCopy.stubTooOld }
        return nil
    }
}

/// One drive's rt. Once retired it refuses every call and cancels the pretend person's answers still
/// pending, so nothing a reset drive started reaches the stub or brings back its deleted folder.
public final class TestDriveRt: RtRunning, @unchecked Sendable {
    public static let ended = "The test drive ended"
    private let inner: RtRunning
    private let lock = NSLock()
    private var retired = false
    private var pending: [UUID: Task<Void, Never>] = [:]

    public init(_ inner: RtRunning) { self.inner = inner }

    public var isRetired: Bool { lock.withLock { retired } }

    public func retire() {
        let tasks: [Task<Void, Never>] = lock.withLock {
            retired = true
            defer { pending = [:] }
            return Array(pending.values)
        }
        tasks.forEach { $0.cancel() }
    }

    public func run(_ args: [String], stdin: Data?) async throws -> RtResult {
        guard !isRetired else { throw RtClientError.spawnFailed(Self.ended) }
        return try await inner.run(args, stdin: stdin)
    }

    public func stream(_ args: [String], stdin: Data?) -> AsyncThrowingStream<String, Error> {
        guard !isRetired else { return AsyncThrowingStream { $0.finish(throwing: RtClientError.spawnFailed(Self.ended)) } }
        return inner.stream(args, stdin: stdin)
    }

    /// Something the pretend person finishes a while later; retiring the drive cancels it.
    public func later(_ work: @escaping @Sendable () async -> Void) {
        let id = UUID()
        lock.withLock {
            guard !retired else { return }
            pending[id] = Task { [weak self] in
                await work()
                self?.forget(id)
            }
        }
    }

    private func forget(_ id: UUID) { lock.withLock { pending[id] = nil } }
}

/// The line a test drive shows in place of each native effect it fakes.
public enum TestDriveCopy {
    public static func wouldOpen(_ url: URL) -> String {
        let place = (url.host ?? "") + url.path
        return "Would open \(place.isEmpty ? url.absoluteString : place)"
    }

    public static func wouldOpenSettings(_ target: String) -> String {
        let panes = ["fda": "Full Disk Access", "notifications": "Notifications", "login-items": "Login Items",
                     "keyboard-shortcuts": "Keyboard Shortcuts", "keyboard": "Keyboard"]
        return "Would open \(panes[target] ?? target) in System Settings"
    }

    public static func wouldAsk(_ which: String) -> String { "Would ask macOS to allow \(which)" }

    public static let wouldAskAdmin = "Would ask for your admin password"
    public static let wouldAddLoginItems = "Would add mattstack's login items"
    public static let wouldStartAtLogin = "Would turn on Start at Login"

    public static func wouldNotify(_ notice: SetupNotice) -> String { "Would notify: \(notice.title)" }

    /// The stub would not take what the pretend person did, so the row it feeds would wait for good.
    public static func stubRefused(_ verb: String, _ why: String) -> String { "The stub rt refused \(verb): \(why)" }

    public static let noStub = "Needs the mattstack checkout and bun on this Mac"
    public static let stubWontRun = "Bun couldn't run the checkout's stub rt"
    public static let stubTooOld = "The checkout's stub rt is too old for a test drive"
    public static let checking = "Checking the stub rt…"
}
