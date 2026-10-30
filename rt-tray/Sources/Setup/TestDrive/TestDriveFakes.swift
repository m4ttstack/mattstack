import Foundation
import MattstackCore

/// What a test drive shows in place of each native effect it fakes. The latest line stays on the banner a few seconds.
@MainActor
final class TestDriveToasts: ObservableObject {
    @Published private(set) var latest: String?
    private var shown = 0

    /// A line given here stays until the next one: snapshots render it without racing the clear.
    init(latest: String? = nil) { self.latest = latest }

    func show(_ line: String) {
        TrayLog.info("test drive", ["would": line])
        latest = line
        shown += 1
        let mine = shown
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            guard let self, self.shown == mine else { return }
            self.latest = nil
        }
    }
}

private func pause(_ seconds: TimeInterval) async {
    try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
}

/// A row's native side: a line on the banner, then the stub told what the pretend person did out there.
struct TestDriveEffects: FormEffects {
    let rt: RtRunning
    let toasts: TestDriveToasts
    let delay: TimeInterval
    let reload: @MainActor @Sendable () async -> Void

    @MainActor func openURL(_ url: URL) {
        toasts.show(TestDriveCopy.wouldOpen(url))
        let rt = self.rt
        Task { _ = try? await rt.run(["stub", "opened", url.absoluteString, "--json"], stdin: nil) }
    }

    /// The person switches it on and comes back, which real setup hears as the app becoming active again.
    @MainActor func openSettings(_ target: String) {
        toasts.show(TestDriveCopy.wouldOpenSettings(target))
        let rt = self.rt, delay = self.delay, reload = self.reload
        Task { @MainActor in
            await pause(delay)
            _ = try? await rt.run(["stub", "grant", target, "--json"], stdin: nil)
            await reload()
        }
    }

    func requestPermission(_ which: String) async -> Bool {
        await toasts.show(TestDriveCopy.wouldAsk(which))
        await pause(delay)
        _ = try? await rt.run(["stub", "grant", which, "--json"], stdin: nil)
        return true
    }
}

struct TestDriveServices: ServicesProviding {
    let toasts: TestDriveToasts

    func statuses() async -> [ServiceStatusEntry] { [] }
    func register(plists: [String]) async -> [ServiceRegisterResult] {
        await toasts.show(TestDriveCopy.wouldAddLoginItems)
        return plists.map { ServiceRegisterResult(plist: $0, ok: true, status: "test drive") }
    }
    func unregister(plists: [String]) async -> [ServiceRegisterResult] {
        plists.map { ServiceRegisterResult(plist: $0, ok: true, status: "test drive") }
    }
    func restart(label: String) async -> Bool { true }
    func start(label: String) async -> Bool { true }
    func waitForJobToLeave(label: String) async -> AgentDrainOutcome { .drained }
}

/// The admin password dialog, answered after the person's usual pause.
struct TestDrivePrivileged: PrivilegedInstalling {
    let toasts: TestDriveToasts
    let delay: TimeInterval

    func proxyInstall(homebrew: Bool) async -> NeedResult { await askAdmin() }
    func proxyRemove() async -> NeedResult { await askAdmin() }
    func proxyTrust(homebrew: Bool) async -> NeedResult { await askAdmin() }
    func homebrew() async -> NeedResult { await askAdmin() }

    private func askAdmin() async -> NeedResult {
        await toasts.show(TestDriveCopy.wouldAskAdmin)
        await pause(delay)
        return NeedResult(ok: true, detail: "test drive")
    }
}

/// The stub's macOS rows are the drive's only permission state, so this one never changes and never asks for a relaunch.
struct TestDrivePermissionProbe: PermissionProbing {
    var fdaNeedsRelaunch: Bool { false }
    func snapshot() async -> PermissionSnapshot {
        PermissionSnapshot(fda: .init(status: "granted", detail: "test drive"), notifications: .init(status: "authorized"),
                           loginItems: .init(status: "enabled"))
    }
}

/// Paste on the invite screen fills a code the stub accepts, and the real clipboard is never read.
struct TestDrivePasteboard: PasteboardReading {
    func inviteText() -> String? { TestDrive.sampleInvite }
}
