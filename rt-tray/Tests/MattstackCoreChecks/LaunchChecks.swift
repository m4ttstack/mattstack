import Foundation
import MattstackCore

let launchChecks: [Check] = [
    Check("LaunchGuard flags translocated and volume paths") { c in
        c.expect(LaunchGuard.isTranslocatedOrOnRemovableVolume(bundlePath: "/private/var/folders/zz/T/AppTranslocation/ABC/d/mattstack.app"))
        c.expect(LaunchGuard.isTranslocatedOrOnRemovableVolume(bundlePath: "/Volumes/mattstack-2.8.0/mattstack.app"))
        c.expect(!LaunchGuard.isTranslocatedOrOnRemovableVolume(bundlePath: "/Applications/mattstack.app"))
        c.expect(!LaunchGuard.isTranslocatedOrOnRemovableVolume(bundlePath: "/Users/u/Applications/mattstack-dev.app"))
    },
    // Parity with parseSetupState/isSetupFinished in lib/setup/state.ts, which
    // reads the same fixture. The daemon starts during setup, so daemon.json
    // alone is no evidence of Finish.
    Check("SetupCompletion: finished agrees with lib/setup/fixtures/setup-finished.json") { c in
        let repo = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let url = repo.appendingPathComponent("lib/setup/fixtures/setup-finished.json")
        struct Case: Decodable { let why: String; let state: String?; let daemonInstalled: Bool; let intent: Bool; let finished: Bool }
        let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: url))
        c.expect(cases.count >= 10)
        for k in cases {
            let finished = SetupCompletion.isFinished(stateJSON: k.state.map { Data($0.utf8) }, daemonInstalled: k.daemonInstalled, intentExists: k.intent)
            c.expectEqual(finished, k.finished, k.why)
        }
        c.expectEqual(SetupCompletion.statePath(home: "/Users/u"), "/Users/u/.mattstack/rt/setup-state.json")
    },
    Check("SetupCompletion.finishReport keeps only what finish said, and caps it") { c in
        c.expectEqual(SetupCompletion.finishReport(stderr: Data()), nil)
        c.expectEqual(SetupCompletion.finishReport(stderr: Data("rt: saved \"rt.sync\" in the team store on this machine only\n".utf8)), nil)
        let mixed = "rt: a settings tip\nrt setup finish: the update run after Finish did not complete: boom\n"
        c.expectEqual(SetupCompletion.finishReport(stderr: Data(mixed.utf8)), "rt setup finish: the update run after Finish did not complete: boom")
        let long = "rt setup finish: " + String(repeating: "x", count: 3000)
        c.expectEqual(SetupCompletion.finishReport(stderr: Data(long.utf8))?.count, 2000)
    },
    Check("SetupCompletion: reads the three files under the home it is given") { c in
        let files: [String: String] = ["/Users/u/.mattstack/rt/daemon.json": "{}"]
        c.expect(SetupCompletion.isFinished(home: "/Users/u", readFile: { files[$0].map { Data($0.utf8) } }, fileExists: { files[$0] != nil }))
        c.expect(!SetupCompletion.isFinished(home: "/Users/v", readFile: { files[$0].map { Data($0.utf8) } }, fileExists: { files[$0] != nil }))
    },
    // rt's whole read decides the screen; the launch only decides whether setup opens.
    Check("Launch: an unfinished Mac still opens setup at launch") { c in
        c.expect(SetupCompletion.onLaunch(relaunched: false, finished: false))
        c.expect(!SetupCompletion.onLaunch(relaunched: false, finished: true), "a finished Mac opens nothing")
        c.expect(SetupCompletion.onLaunch(relaunched: true, finished: true), "a relaunch from setup reopens it whatever the state reads")
        c.expect(SetupCompletion.onLaunch(relaunched: true, finished: false))
        let args = SetupResume.relaunchArguments(passthrough: ["--allow-appcast-override", "--resume-setup", "checklist"], resumeScreen: .macos)
        c.expectEqual(args, ["--allow-appcast-override", "--resume-setup", "macos"])
        c.expectEqual(SetupResume.screen(from: ["mattstack"] + args), .macos)
        c.expectEqual(SetupResume.screen(from: ["mattstack"]), nil)
        c.expectEqual(SetupResume.screen(from: ["mattstack", "--resume-setup"]), nil)
        c.expectEqual(SetupResume.screen(from: ["mattstack", "--resume-setup", "bogus"]), nil)
        c.expectEqual(SetupResume.relaunchArguments(passthrough: ["--resume-setup", "macos", "--x"], resumeScreen: nil), ["--x"])
    },
    Check("SetupCompletion: the tray menu offers Resume setup only while unfinished, Setup status always") { c in
        c.expectEqual(SetupCompletion.menuEntries(finished: false), [.status, .resume])
        c.expectEqual(SetupCompletion.menuEntries(finished: true), [.status])
    },
    Check("SetupCompletion: Finish runs rt setup finish") { c in
        c.expectEqual(SetupCompletion.finishArguments, ["setup", "finish", "--json"])
    },
    Check("JoinLink parses mattstack://join/<code> only") { c in
        c.expectEqual(JoinLink.code(from: URL(string: "mattstack://join/ABCD-EFGH-IJKL")!), "ABCD-EFGH-IJKL")
        c.expectEqual(JoinLink.code(from: URL(string: "mattstack://join/ABCD-EFGH-IJKL/")!), "ABCD-EFGH-IJKL")
        c.expectEqual(JoinLink.code(from: URL(string: "mattstack://join/")!), nil)
        c.expectEqual(JoinLink.code(from: URL(string: "mattstack://settings/team")!), nil)
        c.expectEqual(JoinLink.code(from: URL(string: "https://mattstack.dev/join#ABCD")!), nil)
    },
    Check("AppPathSetting writes a JSON string through rt settings set --scope machine") { c in
        c.expectEqual(AppPathSetting.arguments(bundlePath: "/Applications/mattstack.app"),
                      ["settings", "set", "mattstack.appPath", "\"/Applications/mattstack.app\"", "--scope", "machine"])
        let args = AppPathSetting.arguments(bundlePath: "/Users/u/My \"Apps\"/mattstack.app")
        try c.requireEqual(args.count, 6)
        c.expectEqual(args[3], "\"/Users/u/My \\\"Apps\\\"/mattstack.app\"")
    },
    Check("JoinLink.code(fromText:) matches the shared fixture") { c in
        let repo = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let url = repo.appendingPathComponent("lib/team/fixtures/invite-code-inputs.json")
        struct Case: Decodable { let why: String; let input: String; let expect: String? }
        let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: url))
        c.expect(cases.count >= 10)
        for k in cases {
            c.expectEqual(JoinLink.code(fromText: k.input), k.expect, k.why)
        }
    },
    Check("SetupUpdateOutcome reads the done line of rt setup update --json") { c in
        let ran = Data("{\"event\":\"plan\",\"steps\":[]}\n{\"event\":\"step\",\"id\":\"path.link\",\"state\":\"failed\",\"detail\":\"x\"}\n{\"event\":\"done\",\"ok\":false,\"failedStep\":\"path.link\",\"failedSteps\":[\"path.link\",\"verify\"]}\n".utf8)
        let r = SetupUpdateOutcome.parse(stdout: ran)
        c.expectEqual(r.ok, false)
        c.expectEqual(r.skipped, nil)
        c.expectEqual(r.failedSteps, ["path.link", "verify"])
        let skipped = SetupUpdateOutcome.parse(stdout: Data("{\"event\":\"done\",\"ok\":true,\"skipped\":\"current\"}\n".utf8))
        c.expectEqual(skipped.ok, true)
        c.expectEqual(skipped.skipped, "current")
        c.expectEqual(r.needsYou, false)
        let needsYou = SetupUpdateOutcome.parse(stdout: Data("{\"event\":\"done\",\"ok\":true,\"needsYou\":true}\n".utf8))
        c.expect(needsYou.needsYou, "a done line with needsYou opens Setup status")
        c.expect(!skipped.needsYou)
        let garbage = SetupUpdateOutcome.parse(stdout: Data("not json\n".utf8))
        c.expectEqual(garbage.ok, false)
        c.expectEqual(garbage.failedSteps, [])
    },
    Check("Launch: an unfinished Mac is asked nothing before P1") { c in
        c.expect(!LaunchPrompts.asksAtLaunch(setupFinished: false))
        c.expect(LaunchPrompts.asksAtLaunch(setupFinished: true))
        // A member who hides the window during the run never reaches P7's finish path.
        c.expect(LaunchPrompts.registersLoginItem(afterRunOn: .ready))
        c.expect(LaunchPrompts.registersLoginItem(afterRunOn: .tools), "rt recorded Finish before tools, and Later never reaches P7")
        for stage in [FormStage.running, .paused, .macos, .connect, .thisMac] {
            c.expect(!LaunchPrompts.registersLoginItem(afterRunOn: stage), stage.rawValue)
        }
    },
]
