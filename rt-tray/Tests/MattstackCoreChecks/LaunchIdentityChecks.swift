import Foundation
@testable import MattstackCore

private let built = Date(timeIntervalSince1970: 1_795_000_000.75)
private let rebuilt = Date(timeIntervalSince1970: 1_795_003_600)

let launchIdentityChecks: [Check] = [
    Check("launch identity: the same version with a newer executable is a different identity") { c in
        c.expect(LaunchIdentity.current(version: "2.32.0", executableModified: built)
                 != LaunchIdentity.current(version: "2.32.0", executableModified: rebuilt))
    },
    Check("launch identity: the same version and executable date is the same identity") { c in
        c.expectEqual(LaunchIdentity.current(version: "2.32.0", executableModified: built),
                      LaunchIdentity.current(version: "2.32.0", executableModified: built))
        c.expectEqual(LaunchIdentity.current(version: "2.32.0", executableModified: built), "2.32.0@1795000000")
    },
    Check("launch identity: with no executable date it is the version alone") { c in
        c.expectEqual(LaunchIdentity.current(version: "2.32.0", executableModified: nil), "2.32.0")
    },
    Check("launch identity: a rebuilt bundle at the same version reads as changed to the version detector") { c in
        let store = MemoryKeyValueStore()
        let first = LaunchIdentity.current(version: "2.32.0", executableModified: built)
        VersionChangeDetector.record(current: first, store: store)
        c.expectEqual(VersionChangeDetector.evaluate(current: first, store: store), .unchanged)
        let second = LaunchIdentity.current(version: "2.32.0", executableModified: rebuilt)
        c.expectEqual(VersionChangeDetector.evaluate(current: second, store: store),
                      .changed(from: first, to: second))
    },
]
