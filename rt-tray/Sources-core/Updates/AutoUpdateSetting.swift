import Foundation

/// The org's `mattstack.autoUpdate` switch, read through rt.
public struct AutoUpdateSetting: Sendable {
    public static let key = "mattstack.autoUpdate"

    /// nil when rt cannot answer (not set up, older than the key, an error):
    /// the caller applies the setting's default, on, but never records it as
    /// the org's answer.
    public static func read(_ rt: RtRunning) async -> Bool? {
        struct Reading: Decodable { var value: Bool }
        switch await rt.runJSON(["settings", "get", key, "--json"], verb: "settings get", as: Reading.self) {
        case .success(let reading): return reading.value
        case .failure: return nil
        }
    }
}
