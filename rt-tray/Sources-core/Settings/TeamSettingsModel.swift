import Foundation
import Combine

public struct TeamSettingsInfo: Codable, Equatable, Sendable {
    public struct Member: Codable, Equatable, Sendable { public var username: String }
    public var name: String?
    public var slug: String?
    public var remote: String?
    public var lastPush: String?
    public var members: [Member]?
    public var mode: String?
}

@MainActor
public final class TeamSettingsModel: ObservableObject {
    @Published public private(set) var info: TeamSettingsInfo?
    @Published public private(set) var invite: InviteResult?
    @Published public private(set) var uninstallPlan: UninstallPlan?
    @Published public private(set) var error: String?
    private let rt: RtRunning
    private let needs: NeedBroker
    public init(rt: RtRunning, needs: NeedBroker) { self.rt = rt; self.needs = needs }

    public var maskedRemote: String { info?.remote.map(RemoteMasker.mask) ?? "—" }
    public var isSolo: Bool { info?.mode == "solo" }

    public func load() async {
        if let decoded = await runJSON(["team", "status", "--json"], verb: "team status", as: TeamSettingsInfo.self) { info = decoded }
    }

    public func mintInvite(handle: String) async {
        if let decoded = await runJSON(["team", "invite", "--handle", handle, "--json"], verb: "team invite", as: InviteResult.self) { invite = decoded }
    }

    public func loadUninstallPlan() async {
        // Cleared before the call, not just left alone on failure: an
        // earlier successful load followed by Cancel must not let a later
        // failed reload arm the confirmation sheet on stale actions.
        uninstallPlan = nil
        if let decoded = await runJSON(["uninstall", "--dry-run", "--json"], verb: "uninstall --dry-run", as: UninstallPlan.self) { uninstallPlan = decoded }
    }

    /// `--yes`: the Uninstall pane's sheet is the confirmation; without it
    /// rt exits 2 `confirm-required` for `--delete-data` on a non-TTY.
    ///
    /// The real run is NDJSON like `setup apply`, `need` events included
    /// (`services.unregister` unregisters the agents, `proxy.remove` raises
    /// the admin prompt), so it goes through the same NeedBroker the install
    /// screen uses — rt waits on those outcomes before it can finish.
    public func uninstall(keepData: Bool) -> AsyncThrowingStream<String, Error> {
        NeedPump.performing(rt.stream(["uninstall", keepData ? "--keep-data" : "--delete-data", "--yes", "--json"], stdin: nil),
                            needs: needs)
    }

    /// Clears `error` up front so a retry after a fix doesn't leave stale
    /// text under a result that already succeeded.
    private func runJSON<T: Decodable>(_ args: [String], verb: String, as type: T.Type) async -> T? {
        error = nil
        switch await rt.runJSON(args, verb: verb, as: T.self) {
        case .success(let decoded): return decoded
        case .failure(let failure): error = failure.copy; return nil
        }
    }
}
