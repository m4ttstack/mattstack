import Foundation
import Combine

private func helpFirstName(_ name: String) -> String { name.split(separator: " ").first.map(String.init) ?? name }

/// The daemon's `support:availability` answer.
public struct HelpAvailability: Decodable, Equatable, Sendable {
    /// "hidden", "disabled" or "ready". A String, so a newer rt's state hides rather than fails.
    public var state: String
    public var host: String?
    public var reason: String?
    public var away: Bool?
    public var persona: String?
    public init(state: String, host: String? = nil, reason: String? = nil, away: Bool? = nil, persona: String? = nil) {
        self.state = state; self.host = host; self.reason = reason; self.away = away; self.persona = persona
    }
    public static let hidden = HelpAvailability(state: "hidden")
    public var isOffered: Bool { state == "ready" || state == "disabled" }
    public var isReady: Bool { state == "ready" }
    public var bot: String { persona ?? "Maude" }
    public var hostFirstName: String { host.map(helpFirstName) ?? "" }
}

public struct HelpPart: Codable, Equatable, Sendable, Identifiable {
    public var key: String
    public var label: String
    public var value: String
    public var id: String { key }
    public init(key: String, label: String, value: String) { self.key = key; self.label = label; self.value = value }
    public var shownLabel: String { key == "setup" ? "Setup" : label }
}

public struct HelpRequest: Decodable, Equatable, Sendable, Identifiable {
    public var id: String
    public var text: String
    public var state: String
    public var reason: String?
    public var persona: String?
    public var dmLink: String?
    public var sentAt: Double
    public var away: Bool?
    /// The name of the person it went to, who may not be the host now.
    public var host: String?
    public init(id: String, text: String, state: String, reason: String? = nil, persona: String? = nil,
                dmLink: String? = nil, sentAt: Double = 0, away: Bool? = nil, host: String? = nil) {
        self.id = id; self.text = text; self.state = state; self.reason = reason; self.persona = persona
        self.dmLink = dmLink; self.sentAt = sentAt; self.away = away; self.host = host
    }
    public var hostFirstName: String? { host.map(helpFirstName) }
    public var isOpen: Bool { ["sent", "received", "opening", "waiting"].contains(state) }
}

/// What a request's window says; the board's card says the same (`support-model.ts`).
public struct HelpCard: Equatable, Sendable {
    public enum Mark: Equatable, Sendable { case working, done, clock, moon, failed }
    public enum Action: Equatable, Sendable { case openSlack(URL), askAgain, tryAgain, showIt, edit }
    public var mark: Mark
    public var title: String
    public var detail: String?
    public var action: Action?
    public init(mark: Mark, title: String, detail: String? = nil, action: Action? = nil) {
        self.mark = mark; self.title = title; self.detail = detail; self.action = action
    }
}

public enum HelpCards {
    /// A host's link is followed only into Slack.
    public static func slackLink(_ link: String?) -> URL? {
        guard let link, let url = URL(string: link), let scheme = url.scheme?.lowercased() else { return nil }
        if scheme == "slack" { return url }
        guard scheme == "https", let host = url.host?.lowercased(), host == "slack.com" || host.hasSuffix(".slack.com") else { return nil }
        return url
    }

    public static func request(_ r: HelpRequest, host: String, bot defaultBot: String, othersOpen: Bool = false) -> HelpCard {
        let bot = r.persona ?? defaultBot
        let direct = "Message \(host) directly"
        let slack = slackLink(r.dmLink).map(HelpCard.Action.openSlack)
        switch r.state {
        case "received", "opening": return HelpCard(mark: .working, title: "\(bot) is starting", detail: "\(host)'s Mac has it")
        case "waiting": return HelpCard(mark: .clock, title: "\(host) needs to OK this one", detail: "It will wait")
        case "already-waiting": return HelpCard(mark: .clock, title: "You already have a request waiting", action: othersOpen ? .showIt : nil)
        case "opened": return HelpCard(mark: .done, title: "\(bot) messaged you in Slack", action: slack)
        case "already-open": return HelpCard(mark: .done, title: "You already have a chat open", action: slack)
        case "declined": return HelpCard(mark: .failed, title: "\(host) declined this one", detail: direct)
        case "not-accepting": return HelpCard(mark: .failed, title: "\(host) isn't taking requests", detail: direct)
        case "failed": return HelpCard(mark: .failed, title: "Your request didn't open", detail: r.reason ?? direct)
        case "expired": return HelpCard(mark: .failed, title: "It was never picked up after 7 days", detail: "Ask again, or message \(host)", action: .askAgain)
        default:
            return r.away == true
                ? HelpCard(mark: .moon, title: "\(host)'s Mac is away", detail: "Your request will wait up to 7 days")
                : HelpCard(mark: .working, title: "Asked \(host)'s agent")
        }
    }

    public static func refusal(code: String, message: String, host: String, waiting: Bool) -> HelpCard {
        switch code {
        case "support-already-waiting":
            return HelpCard(mark: .clock, title: "You already have a request waiting", action: waiting ? .showIt : nil)
        case "support-not-accepting":
            return HelpCard(mark: .failed, title: "\(host) isn't taking requests", detail: "Message \(host) directly")
        case "support-unreachable": return HelpCard(mark: .failed, title: "Nothing was sent", detail: "The relay did not answer", action: .tryAgain)
        case "support-slack": return HelpCard(mark: .failed, title: "Nothing was sent", detail: "Slack did not answer", action: .tryAgain)
        case "support-text", "support-too-long":
            return HelpCard(mark: .failed, title: "Nothing was sent", detail: plain(message), action: .edit)
        case "support-changed":
            return HelpCard(mark: .failed, title: "Your first version was already sent", detail: "That is the one they will read")
        case "no-answer":
            return HelpCard(mark: .failed, title: "rt did not answer", detail: "Trying again never sends it twice", action: .tryAgain)
        default:
            return HelpCard(mark: .failed, title: "Nothing was sent", detail: plain(message), action: .tryAgain)
        }
    }

    private static func plain(_ message: String) -> String { message.hasSuffix(".") ? String(message.dropLast()) : message }
}

public protocol HelpCommanding: Sendable {
    func availability() async -> SupportReply<HelpAvailability>
    func parts() async -> SupportReply<[HelpPart]>
    /// A refusal carries its code as well as its words.
    func send(id: String, text: String, parts: [HelpPart]) async -> HelpSend
    func mine() async -> SupportReply<[HelpRequest]>
}

public enum HelpSend: Equatable, Sendable {
    case sent(HelpRequest)
    case refused(code: String, message: String)
    case noAnswer
}

@MainActor
public final class HelpRequestModel: ObservableObject {
    @Published public private(set) var availability = HelpAvailability.hidden
    @Published public private(set) var parts: [HelpPart]?
    @Published public private(set) var partsFailed = false
    /// The parts unticked, by key.
    @Published public private(set) var left: Set<String> = []
    /// rt's SUPPORT_TEXT_MAX, counted as rt counts it.
    public static let textMax = 8000
    @Published public var text = "" {
        didSet { if text.utf16.count > Self.textMax { text = Self.cut(text) } }
    }
    /// The host's first name, kept after they stop answering.
    @Published public private(set) var host = ""
    @Published public private(set) var isSending = false
    @Published public private(set) var shown: HelpRequest?
    @Published public private(set) var refused: (code: String, message: String)?
    private var requests: [HelpRequest] = []
    private struct Attempt { let id: String; let text: String; let parts: [HelpPart] }
    private var attempt: Attempt?
    private let daemon: HelpCommanding
    private let newId: () -> String

    public init(daemon: HelpCommanding, newId: @escaping () -> String = { UUID().uuidString.lowercased() }) {
        self.daemon = daemon
        self.newId = newId
    }

    public var sentParts: [HelpPart] { (parts ?? []).filter { !left.contains($0.key) } }
    private var words: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    public var canSend: Bool { !isSending && parts != nil && !words.isEmpty }

    private static func cut(_ text: String) -> String {
        var end = text.utf16.index(text.startIndex, offsetBy: textMax)
        end = text.rangeOfComposedCharacterSequence(at: end).lowerBound
        return String(text[..<end])
    }

    public var card: HelpCard? {
        if let refused {
            return HelpCards.refusal(code: refused.code, message: refused.message, host: host, waiting: requests.contains(where: \.isOpen))
        }
        guard let shown else { return nil }
        return HelpCards.request(shown, host: shown.hostFirstName ?? host, bot: availability.bot,
                                 othersOpen: requests.contains { $0.isOpen && $0.id != shown.id })
    }
    public var cardText: String { refused == nil ? (shown?.text ?? "") : words }

    public func refreshAvailability() async {
        guard case .value(let a) = await daemon.availability() else { return }
        availability = a
        if !a.hostFirstName.isEmpty { host = a.hostFirstName }
    }

    /// The window opened: a request still going is what it shows.
    public func opened() async {
        shown = nil
        refused = nil
        async let loaded: Void = loadParts()
        await refreshRequests()
        if shown == nil { shown = requests.first(where: \.isOpen) }
        await loaded
    }

    public func loadParts() async {
        partsFailed = false
        if case .value(let p) = await daemon.parts() { parts = p } else { parts = nil; partsFailed = true }
    }

    public func toggle(_ part: HelpPart) {
        if left.contains(part.key) { left.remove(part.key) } else { left.insert(part.key) }
    }

    public func refreshRequests() async {
        guard case .value(let mine) = await daemon.mine() else { return }
        requests = mine.sorted { $0.sentAt > $1.sentAt }
        if let id = shown?.id, let now = requests.first(where: { $0.id == id }) { shown = now }
    }

    public func send() async {
        guard canSend else { return }
        // rt takes a retry under the same id, and changed words as a new request.
        var mine = Attempt(id: newId(), text: words, parts: sentParts)
        if let last = attempt, last.text == mine.text, last.parts == mine.parts { mine = last }
        attempt = mine
        isSending = true
        refused = nil
        switch await self.daemon.send(id: mine.id, text: mine.text, parts: mine.parts) {
        case .sent(let request):
            attempt = nil
            text = ""
            left = []
            shown = request
        case .refused(let code, let message): refused = (code, message)
        case .noAnswer: refused = ("no-answer", "rt did not answer")
        }
        await refreshRequests()
        isSending = false
    }

    public func showIt() {
        refused = nil
        shown = requests.first(where: \.isOpen)
    }

    public func edit() { refused = nil }

    public func askAgain() {
        text = shown?.text ?? text
        shown = nil
        refused = nil
    }
}
