#if DEBUG
import SwiftUI
import MattstackCore

extension FastSetupSnapshot {
    @MainActor
    static func testDrivePages() -> [(String, AnyView)] {
        typealias C = ConnectRows
        func picker(notice: String? = nil, _ build: (TestDrivePickerModel) -> Void = { _ in }) -> AnyView {
            let model = TestDrivePickerModel()
            build(model)
            return AnyView(TestDrivePickerView(model: model, toasts: TestDriveToasts(notice: notice), actions: .inert).padding(.vertical, 20))
        }
        func window(_ run: TestDriveRun, toast: String? = nil, failed: Bool = false, notice: String? = nil, _ content: AnyView) -> AnyView {
            AnyView(TestDriveFrame(toasts: TestDriveToasts(latest: toast, failed: failed, notice: notice), run: run,
                                   onShow: {}, onScenarios: {}, onReset: {}, content: content))
        }
        let join = TestDriveRun(scenario: .join, speed: .instant)
        let store = URL(string: "https://chromewebstore.google.com/detail/fnfikoifhimpdedpdepehibjjkcfbacm")!
        return [
            ("test-drive-picker", picker()),
            ("test-drive-picker-checking", picker { $0.checking = true }),
            ("test-drive-picker-live", picker { m in
                m.scenario = .paused
                m.speed = .realistic
                m.live = TestDriveRun(scenario: .join, speed: .realistic)
                m.note = "Finished. \(TestDriveCopy.wouldOpen(URL(string: "https://board.mattstack")!))"
            }),
            ("test-drive-picker-notice", picker(notice: TestDriveCopy.wouldNotify(FastSetupLaunch.approvedNotice)) { m in
                m.live = TestDriveRun(scenario: .join, speed: .realistic)
            }),
            ("test-drive-picker-unavailable", picker { $0.problem = TestDriveCopy.noStub }),
            ("test-drive-picker-old-stub", picker { $0.problem = TestDriveCopy.stubTooOld }),
            ("test-drive-window-macos", window(join, Container().landed(.macos, Container.whole(.macos, sections: FormSections(
                macos: [Rows.fda, Rows.notificationsAsk, Rows.fancyUrls]))).page())),
            ("test-drive-window-toast", window(TestDriveRun(scenario: .slow, speed: .realistic), toast: TestDriveCopy.wouldOpen(store),
                                               Container().landed(.connect, Container.whole(.connect, sections: FormSections(
                                                   connect: [C.forge, C.slackDone, C.claudePasteCode, C.dopplerCode, C.linear, C.fastBrowser]))).page())),
            ("test-drive-window-refused", window(join, toast: TestDriveCopy.stubRefused("stub grant fda", "stub has no answer for: stub grant fda"), failed: true,
                                                 Container().landed(.macos, Container.whole(.macos, sections: FormSections(
                                                     macos: [Rows.fda, Rows.notificationsAsk, Rows.fancyUrls]))).page())),
            ("test-drive-window-notice", window(join, notice: TestDriveCopy.wouldNotify(FastSetupLaunch.approvedNotice),
                                                Container().landed(.connect, Container.whole(.connect, sections: FormSections(
                                                    connect: [C.forge, C.slack, C.claudeSignIn, C.dopplerSignIn, C.linear, C.fastBrowser]))).page())),
            ("test-drive-window-running", window(TestDriveRun(scenario: .paused, speed: .instant), toast: TestDriveCopy.wouldAddLoginItems,
                                                 Container().landed(.running, Container.whole(.running)).running(Container.cloning, startedAgo: 120).page())),
        ]
    }
}
#endif
