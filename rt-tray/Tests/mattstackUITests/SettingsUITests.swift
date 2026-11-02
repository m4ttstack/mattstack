import XCTest

final class SettingsUITests: XCTestCase {
    private var app: XCUIApplication!
    private var stateDir: URL!
    private var home: URL!
    /// Every dir `prepare` made, since a test can call it more than once.
    private var createdDirs: [URL] = []

    /// A short random hex string, not a UUID: `home`'s tray.sock path
    /// (`<home>/.mattstack/rt/tray.sock`) has to fit in `sockaddr_un.sun_path`
    /// (104 bytes on Darwin), and `$TMPDIR/home-<uuid>/.mattstack/rt/tray.sock`
    /// alone runs well past that — TrayServer.start() fails to bind, silently,
    /// under the full temporaryDirectory() path. /tmp/ms-<8 hex> stays short
    /// regardless of how deep $TMPDIR is on the machine running the suite.
    private func shortHex() -> String { String(format: "%08x", UInt32.random(in: .min ... .max)) }

    /// The UI test runner is itself sandboxed (com.apple.security.app-sandbox),
    /// so NSHomeDirectory() here returns the runner's OWN container, not the
    /// real account's home -- "<that>/.bun/bin/bun" is never where bun lives.
    /// The sandbox does grant read-only access to the whole filesystem, so
    /// this finds the real one instead of guessing from a home-directory API.
    private func findBun() -> String {
        for candidate in ["/opt/homebrew/bin/bun", "/usr/local/bin/bun"]
        where FileManager.default.isExecutableFile(atPath: candidate) { return candidate }
        let users = (try? FileManager.default.contentsOfDirectory(atPath: "/Users")) ?? []
        for user in users {
            let path = "/Users/\(user)/.bun/bin/bun"
            if FileManager.default.isExecutableFile(atPath: path) { return path }
        }
        return "/opt/homebrew/bin/bun"
    }

    override func tearDown() {
        app?.terminate()
        for dir in createdDirs { try? FileManager.default.removeItem(at: dir) }
        createdDirs = []
        super.tearDown()
    }

    private func launch(_ scenario: String) {
        prepare(scenario)
        app.launch()
    }

    private func prepare(_ scenario: String) {
        app = XCUIApplication()
        stateDir = URL(fileURLWithPath: "/tmp/ms-state-\(shortHex())")
        home = URL(fileURLWithPath: "/tmp/ms-\(shortHex())")
        createdDirs += [stateDir, home]
        try? FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        let stub = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("stub-rt/stub.ts").path
        app.launchEnvironment["RT_STUB_SCENARIO"] = scenario
        app.launchEnvironment["RT_STUB_PATH"] = stub
        app.launchEnvironment["RT_STUB_STATE_DIR"] = stateDir.path
        app.launchEnvironment["HOME"] = home.path
        // RtBinaryLocator's stub path defaults RT_STUB_BUN to "<HOME>/.bun/bin/bun"
        // -- against the throwaway HOME above that's nowhere real, so the stub
        // process never spawns. Resolve the real one explicitly instead of
        // leaving the app to guess against a HOME that was never real either.
        app.launchEnvironment["RT_STUB_BUN"] = findBun()
    }

    private func el(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id] }
    /// 20s, not 10: a screen waits on an actual `rt` round trip (spawn bun,
    /// run the stub script, drain both pipes to EOF), and a debug build under
    /// a loaded machine can visibly take several seconds just to get there.
    private func waitFor(_ id: String, _ timeout: TimeInterval = 20) {
        XCTAssertTrue(el(id).waitForExistence(timeout: timeout), "missing \(id)")
    }

    /// By title: a toolbar tab's `settings.tab.<pane>` identifier does not reach the accessibility tree.
    private func selectSettingsTab(_ title: String, file: StaticString = #filePath, line: UInt = #line) {
        let tab = app.toolbars.buttons[title]
        XCTAssertTrue(tab.waitForExistence(timeout: 20), "missing the \(title) tab", file: file, line: line)
        tab.click()
    }

    func testUninstallFromSettingsShowsDryRunList() {
        launch("uninstall")
        // Settings is reachable with ⌘, once a window is key; the setup window is.
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 20), "the setup window opened")
        app.typeKey(",", modifierFlags: .command)
        // Settings opens on whichever tab was last selected (persisted in
        // UserDefaults) and defaults to General on a clean run, so the
        // Uninstall tab has to be selected explicitly before its button exists.
        selectSettingsTab("Uninstall")
        waitFor("settings.uninstall.button")
        el("settings.uninstall.button").click()
        waitFor("settings.uninstall.confirm")
        XCTAssertTrue(app.staticTexts["Stop and remove the rt daemon and deck services"].exists)
    }
}
