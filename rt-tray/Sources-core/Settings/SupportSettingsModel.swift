import Foundation
import Combine

public struct SupportPerson: Decodable, Equatable, Sendable {
    public var username: String
    public var name: String?
    public init(username: String, name: String? = nil) { self.username = username; self.name = name }
    public var shownName: String { name ?? username }
}

public struct SupportNeed: Decodable, Equatable, Sendable, Identifiable {
    public var text: String
    public var label: String
    /// "accounts", "chat-name", "repo" or nil. A String, so an rt with a new kind still loads.
    public var fix: String?
    public var command: String?
    public var id: String { text }
    public init(text: String, label: String, fix: String?, command: String? = nil) {
        self.text = text; self.label = label; self.fix = fix; self.command = command
    }
}

public struct SupportOrg: Decodable, Equatable, Sendable {
    public var host: String?
    public var hasKey: Bool
    public var people: [SupportPerson]
    public var answering: Bool?
    public init(host: String?, hasKey: Bool, people: [SupportPerson], answering: Bool?) {
        self.host = host; self.hasKey = hasKey; self.people = people; self.answering = answering
    }
}

/// The daemon's `support:host` answer.
public struct SupportHostView: Decodable, Equatable, Sendable {
    public var isHost: Bool
    public var enabled: Bool
    public var accepting: Bool
    public var needs: [SupportNeed]
    public var otherMac: Bool
    public var open: Int
    public var cap: Int
    public var waiting: Int
    public var persona: String
    public var repos: [String]
    public var org: SupportOrg?
    public init(isHost: Bool, enabled: Bool, accepting: Bool = false, needs: [SupportNeed] = [], otherMac: Bool = false,
                open: Int = 0, cap: Int = 2, waiting: Int = 0, persona: String = "Maude", repos: [String] = [], org: SupportOrg? = nil) {
        self.isHost = isHost; self.enabled = enabled; self.accepting = accepting; self.needs = needs; self.otherMac = otherMac
        self.open = open; self.cap = cap; self.waiting = waiting; self.persona = persona; self.repos = repos; self.org = org
    }
}

public extension SupportHostView {
    /// A host whose org has support off has nothing to turn on here.
    var showsHostRows: Bool { isHost && enabled }
    var isShown: Bool { org != nil || showsHostRows }
    func person(_ username: String?) -> SupportPerson? {
        guard let username else { return nil }
        return org?.people.first { $0.username.lowercased() == username.lowercased() }
    }
}

public enum SupportReply<T: Sendable>: Sendable {
    case value(T)
    /// rt said no, in words a person can read.
    case refused(String)
    case noAnswer
}

/// The daemon's support verbs. No CLI verb runs these two, so they go over the socket.
public protocol SupportCommanding: Sendable {
    func host() async -> SupportReply<SupportHostView>
    func enable(on: Bool, host: String?) async -> SupportReply<Void>
    func accept(on: Bool) async -> SupportReply<Void>
}

@MainActor
public final class SupportSettingsModel: ObservableObject {
    public enum Busy: Equatable, Sendable { case turningOn, turningOff, changingHost, makingKey, accepting, choosingRepo }

    @Published public private(set) var view: SupportHostView?
    /// Picked while support is off, so nothing is saved until it is turned on.
    @Published public private(set) var pickedHost: String?
    @Published public private(set) var busy: Busy?
    @Published public private(set) var orgError: String?
    @Published public private(set) var hostError: String?
    private let daemon: SupportCommanding
    private let rt: RtRunning

    public init(daemon: SupportCommanding, rt: RtRunning) { self.daemon = daemon; self.rt = rt }

    /// Who the menu shows: the pick, else the saved host while still on the roster.
    public var shownHost: String? { pickedHost ?? view?.person(view?.org?.host)?.username }

    public func load() async {
        guard busy == nil else { return }
        await read()
    }

    private func read() async {
        // An older rt, or none, shows no section rather than an error: the rest of the pane still works.
        if case .value(let v) = await daemon.host() { view = v }
    }

    public func pickHost(_ username: String) async {
        guard busy == nil, username != shownHost else { return }
        orgError = nil
        guard view?.enabled == true else { pickedHost = username; return }
        await change(.changingHost) { await self.daemon.enable(on: true, host: username) }
    }

    public func setEnabled(_ on: Bool) async {
        guard busy == nil, !on || shownHost != nil else { return }
        await change(on ? .turningOn : .turningOff) { await self.daemon.enable(on: on, host: on ? self.shownHost : nil) }
    }

    /// Support on with no key refuses every request; turning it on again makes one.
    public func makeKey() async {
        guard busy == nil, view?.enabled == true else { return }
        await change(.makingKey) { await self.daemon.enable(on: true, host: nil) }
    }

    private func change(_ kind: Busy, _ run: () async -> SupportReply<Void>) async {
        busy = kind
        orgError = nil
        let reply = await run()
        orgError = Self.said(reply)
        if orgError == nil { pickedHost = nil }
        await read()
        busy = nil
    }

    public func setAccepting(_ on: Bool) async {
        guard busy == nil else { return }
        busy = .accepting
        hostError = Self.said(await daemon.accept(on: on))
        await read()
        busy = nil
    }

    public func chooseRepo(_ repo: String) async {
        guard busy == nil else { return }
        busy = .choosingRepo
        hostError = nil
        do {
            let r = try await rt.run(["settings", "set", "chat.slackSupport.defaultRepo", repo, "--scope", "user"], stdin: nil)
            if r.exitCode != 0 { hostError = r.userError?.message ?? r.failureCopy(verb: "settings set") }
        } catch {
            hostError = (error as? RtClientError)?.copy ?? "rt settings set failed to start."
        }
        await read()
        busy = nil
    }

    private static func said(_ reply: SupportReply<Void>) -> String? {
        switch reply {
        case .value: return nil
        case .refused(let message): return message
        case .noAnswer: return "rt did not answer"
        }
    }
}
