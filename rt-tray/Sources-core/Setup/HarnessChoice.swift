import Foundation

/// The harness picker's state: which of rt's options are turned on and
/// which one is the default. It only records clicks; the argv it builds is
/// `rt setup harnesses`, which validates the choice and decides a default
/// the person left out.
public struct HarnessChoiceDraft: Equatable, Sendable {
    public let verb: [String]
    public let options: [ChooseOption]
    private var on: Set<String>
    public private(set) var defaultHarness: String?

    /// nil for a row with no verb: the app never runs `rt <ids> --json`.
    public init?(action: RowAction) {
        guard let verb = action.verb, !verb.isEmpty else { return nil }
        self.verb = verb
        self.options = action.options ?? []
        let ids = Set(options.map(\.id))
        self.on = Set(action.enabled ?? []).intersection(ids)
        self.defaultHarness = action.defaultHarness.flatMap { on.contains($0) ? $0 : nil }
    }

    /// The turned-on ids in rt's option order.
    public var enabled: [String] { options.map(\.id).filter(on.contains) }

    public func isOn(_ id: String) -> Bool { on.contains(id) }

    public mutating func toggle(_ id: String) {
        guard options.contains(where: { $0.id == id }) else { return }
        if on.remove(id) == nil { on.insert(id) }
        if let d = defaultHarness, !on.contains(d) { defaultHarness = nil }
    }

    public mutating func setDefault(_ id: String?) {
        guard let id else { defaultHarness = nil; return }
        if on.contains(id) { defaultHarness = id }
    }

    public var args: [String] {
        let ids = enabled
        if ids.isEmpty { return verb + ["--none", "--json"] }
        return verb + ids + (defaultHarness.map { ["--default", $0] } ?? []) + ["--json"]
    }
}
