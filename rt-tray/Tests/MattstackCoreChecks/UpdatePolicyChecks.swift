import Foundation
import MattstackCore

let updatePolicyChecks: [Check] = [
    Check("Sparkle starts only for prod builds with a real key and feed") { c in
        c.expectEqual(UpdatePolicy.shouldStartUpdater(isDevBuild: true, publicEDKey: "abc", feedURL: "https://x/appcast.xml", feedOverride: nil), false)
        c.expectEqual(UpdatePolicy.shouldStartUpdater(isDevBuild: false, publicEDKey: UpdatePolicy.placeholderKey, feedURL: "https://x/appcast.xml", feedOverride: nil), false)
        c.expectEqual(UpdatePolicy.shouldStartUpdater(isDevBuild: false, publicEDKey: "", feedURL: "https://x/appcast.xml", feedOverride: nil), false)
        c.expectEqual(UpdatePolicy.shouldStartUpdater(isDevBuild: false, publicEDKey: "abc", feedURL: nil, feedOverride: nil), false)
        c.expectEqual(UpdatePolicy.shouldStartUpdater(isDevBuild: false, publicEDKey: "abc", feedURL: "https://x/appcast.xml", feedOverride: nil), true)
    },
    Check("appcast override: env honoured only in dev flavor or with --allow-appcast-override; starts the updater but never without a real key") { c in
        let env = [UpdatePolicy.overrideEnv: "http://127.0.0.1:8000/appcast.xml"]
        c.expectEqual(UpdatePolicy.feedOverride(environment: env, arguments: ["mattstack"], isDevBuild: false), nil)
        c.expectEqual(UpdatePolicy.feedOverride(environment: env, arguments: ["mattstack"], isDevBuild: true), "http://127.0.0.1:8000/appcast.xml")
        c.expectEqual(UpdatePolicy.feedOverride(environment: env, arguments: ["mattstack", UpdatePolicy.overrideFlag], isDevBuild: false), "http://127.0.0.1:8000/appcast.xml")
        c.expectEqual(UpdatePolicy.feedOverride(environment: [:], arguments: [UpdatePolicy.overrideFlag], isDevBuild: true), nil)
        c.expectEqual(UpdatePolicy.shouldStartUpdater(isDevBuild: true, publicEDKey: "abc", feedURL: nil, feedOverride: "http://127.0.0.1:8000/appcast.xml"), true)
        c.expectEqual(UpdatePolicy.shouldStartUpdater(isDevBuild: true, publicEDKey: UpdatePolicy.placeholderKey, feedURL: nil, feedOverride: "http://127.0.0.1:8000/appcast.xml"), false)
    },
    Check("UpdatePolicy.hold names what keeps an update from installing, setup first") { c in
        c.expectEqual(UpdatePolicy.hold(setupRunning: false, windowsOpen: 0), nil)
        c.expectEqual(UpdatePolicy.hold(setupRunning: false, windowsOpen: 2), .windowsOpen)
        c.expectEqual(UpdatePolicy.hold(setupRunning: true, windowsOpen: 0), .setupRunning)
        c.expectEqual(UpdatePolicy.hold(setupRunning: true, windowsOpen: 1), .setupRunning)
    },
    Check("UpdatePolicy.windowHoldsUpdate: a minimized window still holds the install; the status bar does not") { c in
        c.expectEqual(UpdatePolicy.windowHoldsUpdate(isVisible: true, isMiniaturized: false, canBecomeKey: true), true)
        c.expectEqual(UpdatePolicy.windowHoldsUpdate(isVisible: false, isMiniaturized: true, canBecomeKey: true), true)
        c.expectEqual(UpdatePolicy.windowHoldsUpdate(isVisible: false, isMiniaturized: false, canBecomeKey: true), false)
        c.expectEqual(UpdatePolicy.windowHoldsUpdate(isVisible: true, isMiniaturized: false, canBecomeKey: false), false)
    },
    Check("HeldUpdateInstaller installs an offered update at once when the app is idle") { c in
        let installer = HeldUpdateInstaller(setupRunning: { false }, windowsOpen: { 0 })
        var installs = 0
        c.expectEqual(installer.offer(version: "2.28.0") { installs += 1 }, nil)
        c.expectEqual(installs, 1)
        c.expectEqual(installer.heldVersion, nil)
    },
    Check("HeldUpdateInstaller holds an update while a window is open and installs once it closes") { c in
        var windows = 1
        let installer = HeldUpdateInstaller(setupRunning: { false }, windowsOpen: { windows })
        var installs = 0
        c.expectEqual(installer.offer(version: "2.28.0") { installs += 1 }, .windowsOpen)
        c.expectEqual(installs, 0)
        c.expectEqual(installer.heldVersion, "2.28.0")
        c.expectEqual(installer.retry(), false, "a window is still open")
        c.expectEqual(installs, 0)
        windows = 0
        c.expectEqual(installer.retry(), true)
        c.expectEqual(installs, 1)
        c.expectEqual(installer.retry(), false, "an install already started is not started again")
        c.expectEqual(installs, 1)
    },
    Check("HeldUpdateInstaller holds an update while setup runs, even with no window") { c in
        var setup = true
        let installer = HeldUpdateInstaller(setupRunning: { setup }, windowsOpen: { 0 })
        var installs = 0
        c.expectEqual(installer.offer(version: "2.28.0") { installs += 1 }, .setupRunning)
        c.expectEqual(installer.retry(), false)
        setup = false
        c.expectEqual(installer.retry(), true)
        c.expectEqual(installs, 1)
    },
    Check("HeldUpdateInstaller.installNow ignores open windows but never interrupts setup") { c in
        var setup = false
        let installer = HeldUpdateInstaller(setupRunning: { setup }, windowsOpen: { 1 })
        c.expectEqual(installer.installNow(), false, "nothing held yet")
        var installs = 0
        _ = installer.offer(version: "2.28.0") { installs += 1 }
        setup = true
        c.expectEqual(installer.installNow(), false)
        c.expectEqual(installs, 0)
        setup = false
        c.expectEqual(installer.installNow(), true)
        c.expectEqual(installs, 1)
    },
    Check("UpdateNotice at launch: the pending version running now means the install finished") { c in
        c.expectEqual(UpdateNotice.launch(pendingVersion: nil, runningVersion: "2.28.0"), .none)
        c.expectEqual(UpdateNotice.launch(pendingVersion: "2.28.0", runningVersion: "2.28.0"), .installed("2.28.0"))
        c.expectEqual(UpdateNotice.launch(pendingVersion: "2.28.0", runningVersion: "2.27.0"), .stillPending)
    },
    Check("UpdateNotice copy names the version and what the install waits on") { c in
        c.expectEqual(UpdateNotice.installed(version: "2.28.0"),
                      UpdateNotice.Copy(title: "mattstack updated to 2.28.0", body: "Restarted on the new version"))
        c.expectEqual(UpdateNotice.waiting(version: "2.28.0", hold: .windowsOpen),
                      UpdateNotice.Copy(title: "mattstack 2.28.0 is ready", body: "Installs when you close mattstack's windows"))
        c.expectEqual(UpdateNotice.waiting(version: "2.28.0", hold: .setupRunning),
                      UpdateNotice.Copy(title: "mattstack 2.28.0 is ready", body: "Installs once setup finishes and mattstack's windows close"))
    },
    Check("UpdatePolicy: a run in flight holds updates with no window open") { c in
        c.expectEqual(UpdatePolicy.setupBusy(windowRunning: false, runInFlight: true), true)
        c.expectEqual(UpdatePolicy.setupBusy(windowRunning: true, runInFlight: false), true)
        c.expectEqual(UpdatePolicy.setupBusy(windowRunning: false, runInFlight: false), false)
    },
]
