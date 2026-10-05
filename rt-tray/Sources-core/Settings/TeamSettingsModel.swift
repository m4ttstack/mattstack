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
    public var role: String?
    public var activeTeam: String?
    public var teams: [String]?
    public var orgTeams: [String]?
}

extension TeamSettingsInfo {
    /// An rt that reports no role predates orgs; the pane keeps what it showed then.
    public var isAdmin: Bool { role == nil || role == "admin" }
    public var myTeams: [String] { teams ?? [] }
    public var canSwitchTeam: Bool { myTeams.count > 1 }
    public var inviteTeamChoices: [String] {
        guard let all = orgTeams, all.count > 1 else { return [] }
        return all
    }
}

@MainActor
public final class TeamSettingsModel: ObservableObject {
    @Published public private(set) var info: TeamSettingsInfo?
    @Published public private(set) var invite: InviteResult?
    @Published public private(set) var uninstallPlan: UninstallPlan?
    @Published public private(set) var error: String?
    @Published public private(set) var isSwitchingTeam = false
    @Published public private(set) var packNotice: String?
    private let rt: RtRunning
    private let needs: NeedBroker
    public init(rt: RtRunning, needs: NeedBroker) { self.rt = rt; self.needs = needs }

    public var maskedRemote: String { info?.remote.map(RemoteMasker.mask) ?? "—" }
    public var isSolo: Bool { info?.mode == "solo" }
    public var isAdmin: Bool { info?.isAdmin ?? true }
    public var canSwitchTeam: Bool { info?.canSwitchTeam ?? false }
    public var inviteTeamChoices: [String] { info?.inviteTeamChoices ?? [] }

    public func load() async {
        if let decoded = await runJSON(["team", "status", "--json"], verb: "team status", as: TeamSettingsInfo.self) { info = decoded }
    }

    public func useTeam(_ team: String) async {
        guard !isSwitchingTeam else { return }
        isSwitchingTeam = true
        defer { isSwitchingTeam = false }
        struct Switched: Decodable {
            struct Pack: Decodable { var enabled: Bool }
            var team: String
            var pack: Pack?
        }
        guard let switched = await runJSON(["team", "use", team, "--json"], verb: "team use", as: Switched.self) else { return }
        packNotice = switched.pack?.enabled == false ? "The team pack is not ready. Finish setting it up." : nil
        await load()
    }

    public func mintInvite(handle: String, team: String?) async {
        let args = ["team", "invite", "--handle", handle] + (team.map { ["--teams", $0] } ?? []) + ["--json"]
        if let decoded = await runJSON(args, verb: "team invite", as: InviteResult.self) { invite = decoded }
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
