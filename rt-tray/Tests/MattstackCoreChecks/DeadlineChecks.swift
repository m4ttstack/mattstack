import Foundation
import MattstackCore

let deadlineChecks: [Check] = [
    Check("firstAnswer: an answer before the deadline wins") { c in
        let v = await firstAnswer(within: 2, otherwise: false) { true }
        c.expectEqual(v, true)
    },
    Check("firstAnswer: an operation that never answers gives the fallback at the deadline") { c in
        let started = Date()
        let v = await firstAnswer(within: 0.2, otherwise: true) { () async -> Bool in
            await withCheckedContinuation { (_: CheckedContinuation<Void, Never>) in }
            return false
        }
        c.expectEqual(v, true)
        c.expect(Date().timeIntervalSince(started) < 1.5, "returned at the deadline, not after")
    },
]
