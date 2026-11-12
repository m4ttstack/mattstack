import Foundation

/// What the updater last did, written to `~/.mattstack/rt/app-update.json`
/// for the daemon's version ping (`readAppUpdate` in `lib/telemetry/ping.ts`
/// reads the same keys).
public struct UpdateStatus: Codable, Equatable, Sendable {
    public var lastCheckAt: Date?
    public var offeredVersion: String?
    public var heldVersion: String?
    public var hold: String?

    public init(lastCheckAt: Date? = nil, offeredVersion: String? = nil, heldVersion: String? = nil, hold: String? = nil) {
        self.lastCheckAt = lastCheckAt
        self.offeredVersion = offeredVersion
        self.heldVersion = heldVersion
        self.hold = hold
    }

    public static let fileName = "app-update.json"

    public static func holdName(_ hold: UpdateHold?) -> String? {
        switch hold {
        case .windowsOpen: return "windowsOpen"
        case .setupRunning: return "setupRunning"
        case nil: return nil
        }
    }

    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }
}
