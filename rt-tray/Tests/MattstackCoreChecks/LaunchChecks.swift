import Foundation
import MattstackCore

let launchChecks: [Check] = [
    Check("LaunchGuard flags translocated and volume paths") { c in
        c.expect(LaunchGuard.isTranslocatedOrOnRemovableVolume(bundlePath: "/private/var/folders/zz/T/AppTranslocation/ABC/d/mattstack.app"))
        c.expect(LaunchGuard.isTranslocatedOrOnRemovableVolume(bundlePath: "/Volumes/mattstack-2.8.0/mattstack.app"))
        c.expect(!LaunchGuard.isTranslocatedOrOnRemovableVolume(bundlePath: "/Applications/mattstack.app"))
        c.expect(!LaunchGuard.isTranslocatedOrOnRemovableVolume(bundlePath: "/Users/u/Applications/mattstack-dev.app"))
    },
    // A relaunch from the checklist (Full Disk Access takes effect on the
    // next launch) must land back on the checklist, not on Welcome.
    Check("SetupResume: relaunch args carry the step and the launch reads it back") { c in
        let args = SetupResume.relaunchArguments(passthrough: ["--allow-appcast-override"], resumeAt: .checklist)
        c.expectEqual(args, ["--allow-appcast-override", "--resume-setup", "checklist"])
        c.expectEqual(SetupResume.step(from: ["mattstack", "--allow-appcast-override", "--resume-setup", "checklist"]), .checklist)
        c.expectEqual(SetupResume.step(from: ["mattstack"]), nil)
        c.expectEqual(SetupResume.step(from: ["mattstack", "--resume-setup"]), nil)
        c.expectEqual(SetupResume.step(from: ["mattstack", "--resume-setup", "bogus"]), nil)
        // A second relaunch replaces the step rather than stacking a stale one.
        let again = SetupResume.relaunchArguments(passthrough: ["--resume-setup", "team", "--x"], resumeAt: .checklist)
        c.expectEqual(again, ["--x", "--resume-setup", "checklist"])
        c.expectEqual(SetupResume.relaunchArguments(passthrough: ["--resume-setup", "team"], resumeAt: nil), [])
    },
    // Parity with parseSetupState/isSetupFinished in lib/setup/state.ts, which
    // reads the same fixture. The daemon starts during setup, so daemon.json
    // alone is no evidence of Finish.
    Check("SetupCompletion: finished and the resume step agree with lib/setup/fixtures/setup-finished.json") { c in
        let repo = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let url = repo.appendingPathComponent("lib/setup/fixtures/setup-finished.json")
        struct Case: Decodable { let why: String; let state: String?; let daemonInstalled: Bool; let intent: Bool; let finished: Bool; let resume: String? }
        let steps: [String: SetupStep] = ["done": .done, "checklist": .checklist]
        let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: url))
        c.expect(cases.count >= 10)
        for k in cases {
            let finished = SetupCompletion.isFinished(stateJSON: k.state.map { Data($0.utf8) }, daemonInstalled: k.daemonInstalled, intentExists: k.intent)
            c.expectEqual(finished, k.finished, k.why)
            let resume = SetupCompletion.resumeStep(stateJSON: k.state.map { Data($0.utf8) }, intentExists: k.intent)
            c.expectEqual(resume, k.resume.flatMap { steps[$0] }, k.why)
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
    // Quitting at Done must never cost a re-Install, and a failed run must
    // never reopen on a Done that could Finish over its broken rows.
    Check("SetupCompletion: an unfinished setup reopens at Done after a run that got through, the checklist otherwise, Welcome when untouched") { c in
        let installed = Data(#"{"v":2,"lastApplyAt":"2026-09-30T00:00:00.000Z","lastApplyOk":true}"#.utf8)
        let failed = Data(#"{"v":2,"lastApplyAt":"2026-09-30T00:00:00.000Z","lastApplyOk":false}"#.utf8)
        let untouched = Data(#"{"v":2,"links":["gh"]}"#.utf8)
        c.expectEqual(SetupCompletion.resumeStep(stateJSON: installed, intentExists: false), .done)
        c.expectEqual(SetupCompletion.resumeStep(stateJSON: failed, intentExists: false), .checklist)
        c.expectEqual(SetupCompletion.resumeStep(stateJSON: installed, intentExists: true), .checklist)
        c.expectEqual(SetupCompletion.resumeStep(stateJSON: nil, intentExists: true), .checklist)
        c.expectEqual(SetupCompletion.resumeStep(stateJSON: untouched, intentExists: false), .checklist)
        c.expectEqual(SetupCompletion.resumeStep(stateJSON: nil, intentExists: false), nil)

        c.expectEqual(SetupCompletion.onLaunch(resumeFlag: nil, finished: true, resume: .done), .none)
        c.expectEqual(SetupCompletion.onLaunch(resumeFlag: nil, finished: false, resume: .done), .show(.done))
        c.expectEqual(SetupCompletion.onLaunch(resumeFlag: nil, finished: false, resume: nil), .show(nil))
        // --resume-setup is honored whatever the state reads.
        c.expectEqual(SetupCompletion.onLaunch(resumeFlag: .team, finished: true, resume: .done), .show(.team))
        c.expectEqual(SetupCompletion.onLaunch(resumeFlag: .checklist, finished: false, resume: nil), .show(.checklist))
    },
    Check("SetupCompletion: the tray menu offers Resume setup only while unfinished, Setup status always") { c in
        c.expectEqual(SetupCompletion.menuEntries(finished: false), [.status, .resume])
        c.expectEqual(SetupCompletion.menuEntries(finished: true), [.status])
    },
    Check("SetupCompletion: only closing the wizard at an open Done records Finish") { c in
        c.expect(SetupCompletion.closeRecordsFinish(step: .done, finishEnabled: true, readOnly: false))
        c.expect(!SetupCompletion.closeRecordsFinish(step: .done, finishEnabled: false, readOnly: false))
        c.expect(!SetupCompletion.closeRecordsFinish(step: .checklist, finishEnabled: true, readOnly: false))
        c.expect(!SetupCompletion.closeRecordsFinish(step: .done, finishEnabled: true, readOnly: true))
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
        let garbage = SetupUpdateOutcome.parse(stdout: Data("not json\n".utf8))
        c.expectEqual(garbage.ok, false)
        c.expectEqual(garbage.failedSteps, [])
    },
]
