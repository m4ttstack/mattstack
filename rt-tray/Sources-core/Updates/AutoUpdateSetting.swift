import Foundation

/// The org's `mattstack.autoUpdate` switch, read through rt.
public struct AutoUpdateSetting: Sendable {
    public static let key = "mattstack.autoUpdate"

    /// An rt that cannot answer (not set up, older than the key) leaves updates
    /// on, the setting's own default.
    public static func read(_ rt: RtRunning) async -> Bool {
        struct Reading: Decodable { var value: Bool }
        switch await rt.runJSON(["settings", "get", key, "--json"], verb: "settings get", as: Reading.self) {
        case .success(let reading): return reading.value
        case .failure: return true
        }
    }
}
