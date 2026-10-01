import Foundation
import MattstackCore

private final class FailThenPlan: PlanSource, @unchecked Sendable {
    private let lock = NSLock()
    private var calls = 0
    func fetchPlan() async throws -> Plan {
        if next() == 1 { throw RtJSONFailure(copy: "rt setup status failed (exit 1): daemon not running") }
        return makePlan()
    }
    private func next() -> Int { lock.lock(); defer { lock.unlock() }; calls += 1; return calls }
}

let checklistLoadStateChecks: [Check] = [
    Check("ChecklistLoadState.resolve: nothing loaded and nothing failed reads loading, even before the first fetch starts") { c in
        c.expectEqual(ChecklistLoadState.resolve(hasLoadedPlan: false, isLoading: false, lastError: nil), .loading)
        c.expectEqual(ChecklistLoadState.resolve(hasLoadedPlan: false, isLoading: true, lastError: nil), .loading)
    },
    Check("ChecklistLoadState.resolve: a failure with no plan is failed, until a retry is in flight") { c in
        c.expectEqual(ChecklistLoadState.resolve(hasLoadedPlan: false, isLoading: false, lastError: "boom"), .failed("boom"))
        c.expectEqual(ChecklistLoadState.resolve(hasLoadedPlan: false, isLoading: true, lastError: "boom"), .loading)
    },
    Check("ChecklistLoadState.resolve: once a plan loaded, refreshes and their failures never hide the rows") { c in
        c.expectEqual(ChecklistLoadState.resolve(hasLoadedPlan: true, isLoading: true, lastError: nil), .loaded)
        c.expectEqual(ChecklistLoadState.resolve(hasLoadedPlan: true, isLoading: false, lastError: "boom"), .loaded)
    },
    Check("ReadinessModel.loadState: loading, then failed with rt's copy, then loaded after a retry") { c in
        let m = await MainActor.run { ReadinessModel(plans: FailThenPlan(), permissions: FakePermissions(), ticker: FakeTicker()) }
        await MainActor.run { c.expectEqual(m.loadState, .loading, "a fresh model paints the loading state, never a blank list") }
        await m.load()
        await MainActor.run {
            c.expectEqual(m.loadState, .failed("rt setup status failed (exit 1): daemon not running"),
                          "the failed state carries the plain copy, not a Swift type dump")
        }
        await m.recheckAll()
        await MainActor.run {
            c.expectEqual(m.loadState, .loaded)
            c.expect(m.hasLoadedPlan)
        }
    },
]
