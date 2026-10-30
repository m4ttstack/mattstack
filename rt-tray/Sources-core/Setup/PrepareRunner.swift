import Foundation

/// Runs rt's background installs, `rt setup prepare <stage> --json`, one per
/// stage. Stages run side by side: rt itself makes `accounts` wait for
/// `macos` and refuses a duplicate prepare from another process, so this only
/// keeps the app from spawning a second one. Progress is read through rt,
/// never from prepare's record file.
@MainActor
public final class PrepareRunner: ObservableObject {
    @Published public private(set) var running: Set<String> = []
    public var onFinished: ((String) -> Void)?
    private let rt: RtRunning

    public init(rt: RtRunning) { self.rt = rt }

    public func start(_ stage: String) {
        guard !running.contains(stage) else { return }
        running.insert(stage)
        let rt = self.rt
        Task { [weak self] in
            _ = try? await rt.run(["setup", "prepare", stage, "--json"], stdin: nil)
            guard let self else { return }
            self.running.remove(stage)
            self.onFinished?(stage)
        }
    }
}
