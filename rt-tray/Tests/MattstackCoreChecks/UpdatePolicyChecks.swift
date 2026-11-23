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
    Check("UpdateStatus encodes the keys the daemon's ping reads") { c in
        let status = UpdateStatus(lastCheckAt: Date(timeIntervalSince1970: 0), offeredVersion: "2.31.1", heldVersion: "2.31.1", hold: UpdateStatus.holdName(.windowsOpen))
        let text = String(decoding: (try? status.encoded()) ?? Data(), as: UTF8.self)
        c.expectEqual(text, #"{"heldVersion":"2.31.1","hold":"windowsOpen","lastCheckAt":"1970-01-01T00:00:00Z","offeredVersion":"2.31.1"}"#)
        c.expectEqual(UpdateStatus.holdName(.setupRunning), "setupRunning")
        c.expectEqual(UpdateStatus.holdName(nil), nil)
    },
    Check("UpdatePolicy.opensUpdateWindow: a scheduled update opens Sparkle's window unless setup runs") { c in
        c.expectEqual(UpdatePolicy.opensUpdateWindow(handledBySparkle: false, userInitiated: false, setupRunning: false), true)
        c.expectEqual(UpdatePolicy.opensUpdateWindow(handledBySparkle: false, userInitiated: false, setupRunning: true), false)
        c.expectEqual(UpdatePolicy.opensUpdateWindow(handledBySparkle: true, userInitiated: true, setupRunning: false), false, "the window it opened must not reopen itself")
        c.expectEqual(UpdatePolicy.opensUpdateWindow(handledBySparkle: true, userInitiated: false, setupRunning: false), false)
    },
    Check("a scheduled update that reaches the app opens the window, silent or not") { c in
        // Silent, Sparkle only shows an update it could not install by itself
        // (one that needs an admin password), and then the window is the way in.
        c.expectEqual(UpdatePolicy.opensUpdateWindow(handledBySparkle: false, userInitiated: false, setupRunning: false), true)
    },
    Check("not silent: setup holds first, then open windows") { c in
        c.expectEqual(UpdatePolicy.hold(silent: false, setupRunning: false, windowsOpen: 0, daemonBusy: false), nil)
        c.expectEqual(UpdatePolicy.hold(silent: false, setupRunning: false, windowsOpen: 2, daemonBusy: false), .windowsOpen)
        c.expectEqual(UpdatePolicy.hold(silent: false, setupRunning: true, windowsOpen: 1, daemonBusy: false), .setupRunning)
    },
    Check("silent: open windows do not hold") { c in
        c.expectEqual(UpdatePolicy.hold(silent: true, setupRunning: false, windowsOpen: 3, daemonBusy: false), nil)
    },
    Check("silent: setup holds before a busy daemon") { c in
        c.expectEqual(UpdatePolicy.hold(silent: true, setupRunning: true, windowsOpen: 0, daemonBusy: true), .setupRunning)
    },
    Check("silent: a busy daemon holds") { c in
        c.expectEqual(UpdatePolicy.hold(silent: true, setupRunning: false, windowsOpen: 0, daemonBusy: true), .daemonBusy)
    },
    Check("not silent: windows hold and a busy daemon does not") { c in
        c.expectEqual(UpdatePolicy.hold(silent: false, setupRunning: false, windowsOpen: 1, daemonBusy: true), .windowsOpen)
        c.expectEqual(UpdatePolicy.hold(silent: false, setupRunning: false, windowsOpen: 0, daemonBusy: true), nil)
    },
    Check("check interval is one hour") { c in
        c.expectEqual(UpdatePolicy.checkInterval, 3600)
    },
    Check("installer, not silent: installs an offered update at once when the app is idle") { c in
        let installer = HeldUpdateInstaller(silent: { false }, setupRunning: { false }, windowsOpen: { 0 }, daemonBusy: { false })
        var installs = 0
        c.expectEqual(installer.offer(version: "2.28.0") { installs += 1 }, nil)
        c.expectEqual(installs, 1)
        c.expectEqual(installer.heldVersion, nil)
    },
    Check("installer, not silent: holds while a window is open and installs once it closes") { c in
        var windows = 1
        let installer = HeldUpdateInstaller(silent: { false }, setupRunning: { false }, windowsOpen: { windows }, daemonBusy: { false })
        var installs = 0
        c.expectEqual(installer.offer(version: "2.28.0") { installs += 1 }, .windowsOpen)
        c.expectEqual(installs, 0)
        c.expectEqual(installer.heldVersion, "2.28.0")
        c.expectEqual(installer.retry(), false, "a window is still open")
        windows = 0
        c.expectEqual(installer.retry(), true)
        c.expectEqual(installs, 1)
        c.expectEqual(installer.retry(), false, "an install already started is not started again")
        c.expectEqual(installs, 1)
    },
    Check("installer: holds while setup runs, even with no window") { c in
        var setup = true
        let installer = HeldUpdateInstaller(silent: { true }, setupRunning: { setup }, windowsOpen: { 0 }, daemonBusy: { false })
        var installs = 0
        c.expectEqual(installer.offer(version: "2.28.0") { installs += 1 }, .setupRunning)
        c.expectEqual(installer.retry(), false)
        setup = false
        c.expectEqual(installer.retry(), true)
        c.expectEqual(installs, 1)
    },
    Check("installer: a held update installs on the first retry after the daemon stops being busy") { c in
        var busy = true
        let installer = HeldUpdateInstaller(silent: { true }, setupRunning: { false }, windowsOpen: { 0 }, daemonBusy: { busy })
        var installs = 0
        c.expectEqual(installer.offer(version: "2.37.0") { installs += 1 }, .daemonBusy)
        c.expectEqual(installer.heldVersion, "2.37.0")
        c.expectEqual(installer.retry(), false)
        c.expectEqual(installs, 0)
        busy = false
        c.expectEqual(installer.retry(), true)
        c.expectEqual(installs, 1)
        c.expectEqual(installer.retry(), false)
        c.expectEqual(installs, 1)
    },
    Check("installer: pendingHold names what still holds a held update, and nothing once it installs") { c in
        var busy = true
        let installer = HeldUpdateInstaller(silent: { true }, setupRunning: { false }, windowsOpen: { 0 }, daemonBusy: { busy })
        c.expectEqual(installer.pendingHold(), nil, "nothing offered yet")
        _ = installer.offer(version: "2.37.0") {}
        c.expectEqual(installer.pendingHold(), .daemonBusy)
        busy = false
        c.expectEqual(installer.retry(), true)
        c.expectEqual(installer.pendingHold(), nil)
    },
    Check("installer: silent with windows open installs at the offer") { c in
        let installer = HeldUpdateInstaller(silent: { true }, setupRunning: { false }, windowsOpen: { 2 }, daemonBusy: { false })
        var installs = 0
        c.expectEqual(installer.offer(version: "2.37.0") { installs += 1 }, nil)
        c.expectEqual(installs, 1)
    },
    Check("installer: installNow ignores open windows but never interrupts setup") { c in
        var setup = false
        let installer = HeldUpdateInstaller(silent: { false }, setupRunning: { setup }, windowsOpen: { 1 }, daemonBusy: { false })
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
    Check("installer: installNow does not install while the daemon is busy") { c in
        var busy = true
        let installer = HeldUpdateInstaller(silent: { true }, setupRunning: { false }, windowsOpen: { 0 }, daemonBusy: { busy })
        var installs = 0
        _ = installer.offer(version: "2.37.0") { installs += 1 }
        c.expectEqual(installer.installNow(), false)
        c.expectEqual(installs, 0)
        busy = false
        c.expectEqual(installer.installNow(), true)
        c.expectEqual(installs, 1)
    },
    Check("status: holdName covers daemonBusy, and orgOff is its own name") { c in
        c.expectEqual(UpdateStatus.holdName(.daemonBusy), "daemonBusy")
        c.expectEqual(UpdateStatus.orgOff, "orgOff")
    },
    Check("UpdateNotice copy for a busy daemon") { c in
        c.expectEqual(UpdateNotice.waiting(version: "2.37.0", hold: .daemonBusy),
                      UpdateNotice.Copy(title: "mattstack 2.37.0 is ready", body: "Installs when the daemon finishes what it is doing"))
    },
    Check("UpdatePolicy.windowHoldsUpdate: a minimized window still holds the install; the status bar does not") { c in
        c.expectEqual(UpdatePolicy.windowHoldsUpdate(isVisible: true, isMiniaturized: false, canBecomeKey: true), true)
        c.expectEqual(UpdatePolicy.windowHoldsUpdate(isVisible: false, isMiniaturized: true, canBecomeKey: true), true)
        c.expectEqual(UpdatePolicy.windowHoldsUpdate(isVisible: false, isMiniaturized: false, canBecomeKey: true), false)
        c.expectEqual(UpdatePolicy.windowHoldsUpdate(isVisible: true, isMiniaturized: false, canBecomeKey: false), false)
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
