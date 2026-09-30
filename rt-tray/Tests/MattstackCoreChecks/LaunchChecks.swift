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
    // Parity with isSetupFinished/readSetupState in lib/setup/state.ts: the
    // daemon starts during setup, so its daemon.json is no evidence of Finish.
    Check("SetupCompletion: finished only once Finish is on record, or a v1 file's Install ran") { c in
        func finished(_ json: String?) -> Bool { SetupCompletion.isFinished(stateJSON: json.map { Data($0.utf8) }) }
        c.expect(!finished(nil))
        c.expect(!finished("not json"))
        c.expect(!finished(#"{"v":2,"lastApplyAt":"2026-09-30T00:00:00.000Z"}"#))
        c.expect(finished(#"{"v":2,"finishedAt":"2026-09-30T12:00:00.000Z"}"#))
        c.expect(!finished(#"{"v":2,"finishedAt":""}"#))
        c.expect(finished(#"{"v":1,"lastApplyAt":"2026-09-01T00:00:00.000Z"}"#))
        c.expect(finished(#"{"lastApplyAt":"2026-09-01T00:00:00.000Z"}"#))
        c.expect(!finished(#"{"v":1,"marketplaces":["core"]}"#))
        c.expectEqual(SetupCompletion.statePath(home: "/Users/u"), "/Users/u/.mattstack/rt/setup-state.json")
    },
    Check("SetupCompletion: an unfinished setup that has begun reopens at the checklist") { c in
        let home = "/Users/u"
        c.expect(!SetupCompletion.hasBegun(home: home) { _ in false })
        c.expect(SetupCompletion.hasBegun(home: home) { $0 == "/Users/u/.mattstack/rt/setup-intent.json" })
        c.expect(SetupCompletion.hasBegun(home: home) { $0 == "/Users/u/.mattstack/rt/setup-state.json" })

        c.expectEqual(SetupCompletion.onLaunch(resumeFlag: nil, finished: true, begun: true), .none)
        c.expectEqual(SetupCompletion.onLaunch(resumeFlag: nil, finished: false, begun: true), .show(.checklist))
        c.expectEqual(SetupCompletion.onLaunch(resumeFlag: nil, finished: false, begun: false), .show(nil))
        // --resume-setup is honored whatever the state reads.
        c.expectEqual(SetupCompletion.onLaunch(resumeFlag: .team, finished: true, begun: true), .show(.team))
        c.expectEqual(SetupCompletion.onLaunch(resumeFlag: .checklist, finished: false, begun: false), .show(.checklist))
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
