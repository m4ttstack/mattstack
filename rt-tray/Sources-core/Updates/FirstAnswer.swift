import Foundation

private final class ClaimOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if done { return false }
        done = true
        return true
    }
}

/// The operation's answer, or `fallback` once `seconds` pass, whichever comes
/// first. An operation that cannot be cancelled (a child process RtClient
/// waits on) keeps running after the deadline; only its answer is dropped.
public func firstAnswer<T: Sendable>(within seconds: TimeInterval, otherwise fallback: T,
                                     _ operation: @escaping @Sendable () async -> T) async -> T {
    let once = ClaimOnce()
    return await withCheckedContinuation { (cont: CheckedContinuation<T, Never>) in
        Task {
            let value = await operation()
            if once.claim() { cont.resume(returning: value) }
        }
        Task {
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            if once.claim() { cont.resume(returning: fallback) }
        }
    }
}
