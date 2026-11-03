import Foundation
import UserNotifications
@testable import MattstackCore

private let res = URL(fileURLWithPath: "/App/Contents/Resources")
private let custom = URL(fileURLWithPath: "/Users/u/.mattstack/rt/sounds")
private let loc = SoundLocations(resources: res, customSounds: custom)
private func on(_ paths: String...) -> (URL) -> Bool { { paths.contains($0.path) } }

let notificationSoundChecks: [Check] = [
    Check("a tone plays only when the app may notify and its sound toggle is on") { c in
        c.expect(NotificationSound.shouldPlay(authorization: .authorized, sound: .enabled), "authorized with sound on")
        c.expect(NotificationSound.shouldPlay(authorization: .provisional, sound: .enabled), "provisional with sound on")
    },
    Check("turning off Play sound for notifications in System Settings silences the tone") { c in
        c.expect(!NotificationSound.shouldPlay(authorization: .authorized, sound: .disabled), "sound toggled off")
        c.expect(!NotificationSound.shouldPlay(authorization: .authorized, sound: .notSupported), "sound not supported")
    },
    Check("notifications turned off or never granted play no tone either") { c in
        c.expect(!NotificationSound.shouldPlay(authorization: .denied, sound: .enabled), "denied")
        c.expect(!NotificationSound.shouldPlay(authorization: .notDetermined, sound: .enabled), "not determined")
    },
    Check("events map to the same tiers as before") { c in
        c.expectEqual(SoundTier(category: "pipeline_passed", readyHeldCategory: "ready_held"), .positive)
        c.expectEqual(SoundTier(category: "merge_conflicts", readyHeldCategory: "ready_held"), .warning)
        c.expectEqual(SoundTier(category: "ready_held", readyHeldCategory: "ready_held"), .warning)
        c.expectEqual(SoundTier(category: "new_comment", readyHeldCategory: "ready_held"), .neutral)
        c.expect(SoundTier.warning > SoundTier.positive && SoundTier.positive > SoundTier.neutral, "warning outranks positive outranks neutral")
    },
    Check("Calm is the default: Sober 2, Sober 3 and Sosumi") { c in
        c.expectEqual(SoundPicks.defaults, SoundPicks(neutral: "sober/102", positive: "sober/103", warning: "macos/Sosumi"))
        c.expectEqual(SoundPreset.calm.picks, SoundPicks.defaults)
    },
    Check("Lively plays every tier's Original") { c in
        c.expectEqual(SoundPreset.lively.picks, SoundPicks(neutral: "original", positive: "original", warning: "original"))
    },
    Check("an unset or partial setting keeps each missing tier on Calm's pick") { c in
        let partial = try? JSONDecoder().decode(SoundPicks.self, from: Data(#"{"warning":"macos/Glass"}"#.utf8))
        c.expectEqual(partial, SoundPicks(neutral: "sober/102", positive: "sober/103", warning: "macos/Glass"))
    },
    Check("picks that match a preset name it; any other mix is custom") { c in
        c.expectEqual(SoundPreset.matching(SoundPreset.calm.picks), .calm)
        c.expectEqual(SoundPreset.matching(SoundPreset.lively.picks), .lively)
        c.expectEqual(SoundPreset.matching(SoundPicks(neutral: "sober/102", positive: "sober/103", warning: "macos/Glass")), nil)
        c.expectEqual(SoundPreset.calm.title, "Calm")
        c.expectEqual(SoundPreset.lively.title, "Lively")
    },
    Check("each kind of pick resolves to its file") { c in
        c.expectEqual(SoundCatalog.resolve("original", tier: .warning, in: loc, exists: on("/App/Contents/Resources/warning.caf")),
                      .file(res.appendingPathComponent("warning.caf")))
        c.expectEqual(SoundCatalog.resolve("sober/102", tier: .neutral, in: loc, exists: on("/App/Contents/Resources/sober-102.caf")),
                      .file(res.appendingPathComponent("sober-102.caf")))
        c.expectEqual(SoundCatalog.resolve("macos/Glass", tier: .neutral, in: loc, exists: on("/System/Library/Sounds/Glass.aiff")),
                      .file(URL(fileURLWithPath: "/System/Library/Sounds/Glass.aiff")))
        c.expectEqual(SoundCatalog.resolve("custom/Doorbell.m4a", tier: .neutral, in: loc, exists: on(custom.appendingPathComponent("Doorbell.m4a").path)),
                      .file(custom.appendingPathComponent("Doorbell.m4a")))
        c.expectEqual(SoundCatalog.resolve("none", tier: .warning, in: loc, exists: on()), .silent)
    },
    Check("a pick that can't be found falls back to the tier's Original") { c in
        let original = on("/App/Contents/Resources/positive.caf")
        c.expectEqual(SoundCatalog.resolve("custom/Gone.m4a", tier: .positive, in: loc, exists: original),
                      .fallback(res.appendingPathComponent("positive.caf"), missing: "custom/Gone.m4a"))
        c.expectEqual(SoundCatalog.resolve("sober/999", tier: .positive, in: loc, exists: { _ in true }),
                      .fallback(res.appendingPathComponent("positive.caf"), missing: "sober/999"))
        c.expectEqual(SoundCatalog.resolve("custom/../../etc/x", tier: .positive, in: loc, exists: { _ in true }),
                      .fallback(res.appendingPathComponent("positive.caf"), missing: "custom/../../etc/x"))
        c.expectEqual(SoundCatalog.resolve("original", tier: .positive, in: loc, exists: on()),
                      .fallback(nil, missing: "original"))
    },
    Check("picks show plain names") { c in
        c.expectEqual(SoundID.displayName("original", tier: .neutral), "Lively Neutral")
        c.expectEqual(SoundID.displayName("original", tier: .warning), "Lively Warning")
        c.expectEqual(SoundID.displayName("none", tier: .neutral), "None")
        c.expectEqual(SoundID.displayName("sober/101", tier: .neutral), "Sober 1")
        c.expectEqual(SoundID.displayName("sober/104", tier: .neutral), "Sober 4")
        c.expectEqual(SoundID.displayName("macos/Submarine", tier: .neutral), "Submarine")
        c.expectEqual(SoundID.displayName("custom/Doorbell 2.m4a", tier: .neutral), "Doorbell 2")
    },
    Check("an added file never overwrites one already there") { c in
        c.expectEqual(SoundCatalog.uniqueFileName("Doorbell.m4a", taken: []), "Doorbell.m4a")
        c.expectEqual(SoundCatalog.uniqueFileName("Doorbell.m4a", taken: ["Doorbell.m4a"]), "Doorbell 2.m4a")
        c.expectEqual(SoundCatalog.uniqueFileName("Doorbell.m4a", taken: ["Doorbell.m4a", "Doorbell 2.m4a"]), "Doorbell 3.m4a")
        c.expectEqual(SoundCatalog.uniqueFileName("beep", taken: ["beep"]), "beep 2")
        c.expectEqual(SoundCatalog.uniqueFileName("doorbell.m4a", taken: ["Doorbell.m4a"]), "doorbell 2.m4a", "a case-only match is taken")
    },
]
