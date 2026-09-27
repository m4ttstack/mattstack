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
    /// The window's tab list settles on one deck catalog and stops polling,
    /// so it only learns of a flip through this.
    public var onAppsChanged: (@MainActor () -> Void)?
    private let rt: RtRunning
    public init(rt: RtRunning) { self.rt = rt }

    public func load() async {
        if let r = await runJSON(["apps", "list", "--json"], verb: "apps list", as: AppsListResult.self) { apps = r.apps }
    }

    public func setEnabled(_ name: String, _ on: Bool) async {
        struct Flip: Codable { var name: String; var enabled: Bool }
        guard await runJSON(["apps", on ? "enable" : "disable", name, "--json"], verb: "apps \(on ? "enable" : "disable")", as: Flip.self) != nil else { return }
        onAppsChanged?()
        await load()
    }

    /// Same failure shape as `TeamSettingsModel.runJSON`.
    private func runJSON<T: Decodable>(_ args: [String], verb: String, as type: T.Type) async -> T? {
        error = nil
        do {
            let r = try await rt.run(args, stdin: nil)
            if let e = r.userError { error = e.message; return nil }
            guard r.exitCode == 0, let decoded = try? r.decode(T.self) else {
                error = r.failureCopy(verb: verb)
                return nil
            }
            return decoded
        } catch {
            self.error = (error as? RtClientError)?.copy ?? "rt \(verb) failed to start."
            return nil
        }
    }
}
