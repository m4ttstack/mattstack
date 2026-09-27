import Foundation
import Combine

public struct AppToggleRow: Codable, Equatable, Sendable, Identifiable {
    public var id: String { name }
    public var name: String
    public var displayName: String
    public var description: String?
    public var enabled: Bool
    public var requiresTeam: Bool
}

struct AppsListResult: Codable { var apps: [AppToggleRow] }

@MainActor
public final class AppsSettingsModel: ObservableObject {
    @Published public private(set) var apps: [AppToggleRow] = []
    @Published public private(set) var error: String?
    @Published public private(set) var inFlight: Set<String> = []
    /// The window's tab list settles on one deck catalog and stops polling,
    /// so it only learns of a flip through this.
    public var onAppsChanged: (@MainActor () -> Void)?
    private let rt: RtRunning
    public init(rt: RtRunning) { self.rt = rt }

    /// True once `apps list` has answered, so an empty list reads as "none"
    /// rather than "not asked yet".
    @Published public private(set) var loaded = false

    public func load() async {
        if let r = await runJSON(["apps", "list", "--json"], verb: "apps list", as: AppsListResult.self) {
            apps = r.apps
            loaded = true
        }
    }

    public func setEnabled(_ name: String, _ on: Bool) async {
        struct Flip: Codable { var name: String; var enabled: Bool }
        guard !inFlight.contains(name) else { return }
        inFlight.insert(name)
        defer { inFlight.remove(name) }
        let prior = apps.first { $0.name == name }?.enabled
        setShown(name, on)
        guard await runJSON(["apps", on ? "enable" : "disable", name, "--json"], verb: "apps \(on ? "enable" : "disable")", as: Flip.self) != nil else {
            if let prior { setShown(name, prior) }
            return
        }
        onAppsChanged?()
        await load()
    }

    private func setShown(_ name: String, _ enabled: Bool) {
        if let i = apps.firstIndex(where: { $0.name == name }) { apps[i].enabled = enabled }
    }

    private func runJSON<T: Decodable>(_ args: [String], verb: String, as type: T.Type) async -> T? {
        error = nil
        switch await rt.runJSON(args, verb: verb, as: T.self) {
        case .success(let decoded): return decoded
        case .failure(let failure): error = failure.copy; return nil
        }
    }
}
