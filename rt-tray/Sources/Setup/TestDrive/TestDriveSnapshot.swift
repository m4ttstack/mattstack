#if DEBUG
import SwiftUI
import MattstackCore

extension FastSetupSnapshot {
    @MainActor
    static func testDrivePages() -> [(String, AnyView)] {
        typealias C = ConnectRows
        func picker(_ build: (TestDrivePickerModel) -> Void = { _ in }) -> AnyView {
            let model = TestDrivePickerModel()
            build(model)
            return AnyView(TestDrivePickerView(model: model, actions: .inert).padding(.vertical, 20))
        }
        func window(_ run: TestDriveRun, toast: String? = nil, _ content: AnyView) -> AnyView {
            AnyView(TestDriveFrame(toasts: TestDriveToasts(latest: toast), run: run, onScenarios: {}, onReset: {}, content: content))
        }
        let join = TestDriveRun(scenario: .join, speed: .instant)
        let store = URL(string: "https://chromewebstore.google.com/detail/fnfikoifhimpdedpdepehibjjkcfbacm")!
        return [
            ("test-drive-picker", picker()),
            ("test-drive-picker-live", picker { m in
                m.scenario = .paused
                m.speed = .realistic
                m.live = TestDriveRun(scenario: .join, speed: .realistic)
                m.note = "Finished. \(TestDriveCopy.wouldOpen(URL(string: "https://board.mattstack")!))"
            }),
            ("test-drive-picker-unavailable", picker { $0.problem = "Needs the mattstack checkout and bun on this Mac" }),
            ("test-drive-window-macos", window(join, Container().landed(.macos, Container.whole(.macos, sections: FormSections(
                macos: [Rows.fda, Rows.notificationsAsk, Rows.fancyUrls]))).page())),
            ("test-drive-window-toast", window(TestDriveRun(scenario: .slow, speed: .realistic), toast: TestDriveCopy.wouldOpen(store),
                                               Container().landed(.connect, Container.whole(.connect, sections: FormSections(
                                                   connect: [C.forge, C.slackDone, C.claudePasteCode, C.dopplerCode, C.linear, C.fastBrowser]))).page())),
            ("test-drive-window-running", window(TestDriveRun(scenario: .paused, speed: .instant), toast: TestDriveCopy.wouldAddLoginItems,
                                                 Container().landed(.running, Container.whole(.running)).running(Container.cloning, startedAgo: 120).page())),
        ]
    }
}
#endif
