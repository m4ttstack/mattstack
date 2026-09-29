import Foundation
import Combine

public struct DevLoginRow: Codable, Equatable, Sendable, Identifiable {
    public struct Fields: Codable, Equatable, Sendable { public var email: String; public var password: String }
    public var origin: String
    public var email: String
    public var fields: Fields
    public var id: String { origin }
}

@MainActor
public final class DevLoginsModel: ObservableObject {
    @Published public private(set) var rows: [DevLoginRow] = []
    @Published public private(set) var loaded = false
    @Published public private(set) var error: String?
    /// Set by the mattstack://dev-logins/add route; the pane opens the add sheet for it.
    @Published public var addRequest: String?
    private let rt: RtRunning
    public init(rt: RtRunning) { self.rt = rt }

    public func isSaved(_ origin: String) -> Bool { rows.contains { $0.origin == origin } }

    public func load() async {
        switch await rt.runJSON(["logins", "list", "--json"], verb: "logins list", as: [DevLoginRow].self) {
        case .success(let decoded):
            rows = decoded
            loaded = true
            error = nil
        case .failure(let failure):
            error = failure.copy
        }
    }

    /// Values go on stdin only, and a failure's stderr is never shown, since it could echo them.
    public func save(origin: String, email: String, password: String) async -> String? {
        guard let body = try? JSONSerialization.data(withJSONObject: ["email": email, "password": password]) else {
            return "Couldn't encode the login."
        }
        return await mutate(["logins", "add", origin, "--json"], stdin: body, verb: "logins add")
    }

    public func remove(origin: String) async -> String? {
        await mutate(["logins", "remove", origin, "--json"], stdin: nil, verb: "logins remove")
    }

    private func mutate(_ args: [String], stdin: Data?, verb: String) async -> String? {
        do {
            let r = try await rt.run(args, stdin: stdin)
            guard r.exitCode == 0 else {
                return r.userError(redactStderr: true)?.message ?? r.failureCopy(verb: verb, redactStderr: true)
            }
            await load()
            return nil
        } catch {
            return (error as? RtClientError)?.copy ?? "rt \(verb) failed to start."
        }
    }
}

public enum DevLoginConfirm {
    /// `host` is the lowercased `encodedHost` from `DevLoginOrigin.validate`, so an
    /// internationalised name must be typed in its xn-- form.
    public static func canSave(host: String, typedHost: String, isFirstTime: Bool, email: String, password: String) -> Bool {
        guard !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !password.isEmpty else { return false }
        return !isFirstTime || typedHost.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == host.lowercased()
    }

    public static func warnings(origin: String) -> [String] {
        let comps = URLComponents(string: origin)
        let host = comps?.encodedHost?.lowercased() ?? origin.lowercased()
        var out: [String] = []
        if host.split(separator: ".").contains(where: { $0.hasPrefix("xn--") }) {
            out.append("This site's name uses international characters. Check it is the site you expect, not a lookalike.")
        }
        if comps?.scheme?.lowercased() == "http" {
            out.append("This login is sent without https. Save it only for an app on this Mac that hosts its own login.")
        }
        return out
    }
}

public enum DevLoginSheetCopy {
    public static let replaceCaption = "Saving replaces the email and password saved for this site."

    /// A typed Add of a saved site replaces it too, so this keys on the
    /// validated origin alone, never on how the sheet was opened.
    public static func replacing(fixedOrigin: String?, typedOrigin: String, isSaved: (String) -> Bool) -> Bool {
        guard case .valid(let origin, _) = DevLoginOrigin.validate(fixedOrigin ?? typedOrigin) else { return false }
        return isSaved(origin)
    }

    public static func title(replacing: Bool) -> String { replacing ? "Replace dev login" : "Save a dev login" }
}

/// A link must never swap out an open sheet: SwiftUI would drop it mid-save,
/// past its disabled Cancel. The newest held origin opens once the sheet closes.
public struct DevLoginLinkQueue: Equatable {
    public private(set) var pending: String?
    public init() {}

    /// The origin to open now, or nil when it is held behind an open sheet.
    public mutating func arrive(_ origin: String, sheetPresented: Bool) -> String? {
        guard sheetPresented else { return origin }
        pending = origin
        return nil
    }

    public mutating func sheetDismissed() -> String? {
        defer { pending = nil }
        return pending
    }
}

public enum DevLoginSaveOutcome: Equatable, Sendable { case saved, failed(String), timedOut }

/// `rt` runs have no timeout of their own, and the sheet cannot be dismissed
/// while it waits, so the wait is bounded here. A result that lands after the
/// timeout is dropped: the sheet has already moved on.
@MainActor
public enum DevLoginSaveRace {
    public static let timeoutMessage = "Still saving. Close this and check the list."

    public static func run(timeout: Duration = .seconds(30), _ save: @escaping () async -> String?) async -> DevLoginSaveOutcome {
        await withCheckedContinuation { (continuation: CheckedContinuation<DevLoginSaveOutcome, Never>) in
            var finished = false
            let finish: (DevLoginSaveOutcome) -> Void = { outcome in
                guard !finished else { return }
                finished = true
                continuation.resume(returning: outcome)
            }
            let timer = Task { @MainActor in
                try? await Task.sleep(for: timeout)
                if !Task.isCancelled { finish(.timedOut) }
            }
            Task { @MainActor in
                let error = await save()
                timer.cancel()
                finish(error.map { .failed($0) } ?? .saved)
            }
        }
    }
}
