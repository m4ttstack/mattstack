import Foundation
import MattstackCore

let latestOnlyChecks: [Check] = [
    Check("LatestOnly: only the most recent start may apply its answer") { c in
        var gate = LatestOnly()
        let older = gate.start()
        let newer = gate.start()
        c.expectEqual(gate.isLatest(older), false, "an older refresh landing late is dropped")
        c.expectEqual(gate.isLatest(newer), true)
    },
]
