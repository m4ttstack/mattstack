import Foundation
import MattstackCore

let setupFlowChecks: [Check] = [
    Check("SetupStep order, titles, indicator") { c in
        c.expectEqual(SetupStep.allCases.map(\.rawValue), [0, 1, 2, 3, 4])
        c.expectEqual(SetupStep.checklist.indicator, "Step 3 of 5")
        c.expectEqual(SetupStep.team.title, "Your team")
        c.expectEqual(SetupStep.checklist.title, "Before we begin")
    },
    Check("flow: next/back bounds, continue titles, back disabled on welcome/install-running/done, close only on done") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            c.expectEqual(f.step, .welcome)
            c.expectEqual(f.canGoBack, false)
            c.expectEqual(f.windowMayClose, false)
            f.back(); c.expectEqual(f.step, .welcome)
            f.next(); c.expectEqual(f.step, .team); c.expectEqual(f.canGoBack, true)
            f.next(); c.expectEqual(f.step, .checklist); c.expectEqual(f.continueTitle, "Install")
            f.next(); c.expectEqual(f.step, .install)
            f.isInstalling = true; c.expectEqual(f.canGoBack, false)
            f.isInstalling = false; c.expectEqual(f.canGoBack, true)
            f.next(); c.expectEqual(f.step, .done); c.expectEqual(f.continueTitle, "Finish")
            c.expectEqual(f.canGoBack, false); c.expectEqual(f.windowMayClose, true)
            f.next(); c.expectEqual(f.step, .done)
            f.jump(to: .team); c.expectEqual(f.step, .team)
        }
    },
    Check("read-only flow (Setup status…): no Back, primary closes instead of installing, never starts a run") { c in
        await MainActor.run {
            let f = SetupFlowModel(readOnly: true)
            f.jump(to: .checklist)
            c.expectEqual(f.showsBack, false, "a health view has no wizard behind it to walk back into")
            c.expectEqual(f.canGoBack, false)
            c.expectEqual(f.continueTitle, "Close", "Install here would start a real rt setup apply")
            c.expectEqual(f.primaryClosesWindow, true)
            c.expectEqual(f.mayStartInstall, false)
            let wizard = SetupFlowModel()
            wizard.jump(to: .checklist)
            c.expectEqual(wizard.showsBack, true)
            c.expectEqual(wizard.continueTitle, "Install")
            c.expectEqual(wizard.primaryClosesWindow, false)
            c.expectEqual(wizard.mayStartInstall, true)
        }
    },
    Check("windowMayClose follows the one finish-gate boolean on Done and nowhere else") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .done)
            c.expectEqual(f.windowMayClose, true, "a flow nobody mirrors a gate into reads open")
            f.finishGateOpen = false
            c.expectEqual(f.windowMayClose, false, "a closed Finish closes the titlebar buttons too")
            c.expectEqual(f.continueTitle, "Finish")
            f.finishGateOpen = true
            c.expectEqual(f.windowMayClose, true)
            f.jump(to: .checklist)
            c.expectEqual(f.windowMayClose, false, "the gate never opens a non-Done step")
        }
    },
    Check("upgrade entry: no Back on the team screen, first run keeps it") { c in
        await MainActor.run {
            let f = SetupFlowModel()
            f.jump(to: .team)
            c.expectEqual(f.canGoBack, true)
            f.entry = .upgrade
            c.expectEqual(f.canGoBack, false)
            f.next()
            c.expectEqual(f.canGoBack, true, "Back from the checklist to the team screen stays")
        }
    },
]

/// The plans rt composes for each harness profile, read from the file
/// `lib/setup/__tests__/integration-plan-fixtures.test.ts` holds to rt's output.
private func harnessProfilePlans() throws -> [String: Plan] {
    let repo = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
    let url = repo.appendingPathComponent("lib/setup/fixtures/integration-plans.json")
    return try JSONDecoder().decode([String: Plan].self, from: Data(contentsOf: url))
}

@MainActor private func loadedReadiness(_ plan: Plan) async -> ReadinessModel {
    let m = ReadinessModel(plans: FakePlans([plan]), permissions: FakePermissions(), ticker: FakeTicker())
    await m.load()
    return m
}

private let claudeRowIds: Set<String> = ["tool.claude", "tool.plugins", "tool.linear-mcp"]
private let codexRowIds: Set<String> = ["tool.codex", "tool.codex-mcp"]

let harnessProfileChecks: [Check] = [
    Check("harness profiles: every supported profile decodes, and the app gates exactly what rt's plan gates") { c in
        let plans = try harnessProfilePlans()
        c.expectEqual(Set(plans.keys), ["claude-only", "codex-only", "both", "none", "absent"])
        for (name, plan) in plans {
            let m = await loadedReadiness(plan)
            await MainActor.run {
                c.expectEqual(m.requiredMissing, plan.requiredMissing, "\(name): Install waits on rt's required rows and no others")
                c.expectEqual(m.finishBlockedRows.map(\.id), plan.finishBlockedBy, "\(name): Finish waits on rt's finish gates and no others")
                c.expectEqual(m.canInstall, plan.canInstall, name)
            }
        }
    },
    Check("harness profiles: the checklist model shows only the profile's harness rows, badging none of rt's required ones optional") { c in
        let plans = try harnessProfilePlans()
        let expected: [String: (shown: Set<String>, required: Set<String>)] = [
            "claude-only": (["tool.claude", "tool.plugins", "tool.linear-mcp"], ["tool.claude"]),
            "codex-only": (["tool.codex", "tool.codex-mcp"], ["tool.codex"]),
            "both": (claudeRowIds.union(codexRowIds), ["tool.claude", "tool.codex"]),
            "none": ([], []),
            "absent": (["tool.claude", "tool.plugins", "tool.linear-mcp"], ["tool.claude"]),
        ]
        for (name, want) in expected {
            let plan = try c.requireSome(plans[name], name)
            let m = await loadedReadiness(plan)
            await MainActor.run {
                let harnessRows = m.groups(for: .all).flatMap(\.rows).filter { claudeRowIds.union(codexRowIds).contains($0.id) }
                c.expectEqual(Set(harnessRows.map(\.id)), want.shown, name)
                c.expectEqual(Set(harnessRows.filter(\.required).map(\.id)), want.required, name)
                for row in harnessRows where want.required.contains(row.id) {
                    c.expect(row.badge != .optional, "\(name): \(row.id) is required, never badged optional")
                }
                for row in harnessRows where !want.required.contains(row.id) {
                    c.expectEqual(row.badge, .optional, "\(name): \(row.id)")
                }
            }
        }
    },
    Check("harness profiles: a Mac without Claude Code can install and finish on Codex alone") { c in
        let plan = try c.requireSome(try harnessProfilePlans()["codex-only"])
        let m = await loadedReadiness(plan)
        await MainActor.run {
            c.expect(m.row("tool.claude") == nil, "Claude Code is not offered on a Codex-only Mac")
            c.expect(!m.requiredMissing.contains { claudeRowIds.contains($0) }, "Install never waits on Claude Code")
            c.expect(!m.finishBlockedRows.contains { claudeRowIds.contains($0.id) }, "Finish never waits on Claude Code")
            c.expectEqual(m.row("tool.codex")?.required, true)
            c.expectEqual(m.row("tool.codex")?.status, .ready)
            c.expectEqual(m.row("tool.integrations")?.detail, "Turned on: Codex")
        }
    },
    Check("harness profiles: with no agent app turned on, the reason and its picker come from rt and never block Install") { c in
        let plan = try c.requireSome(try harnessProfilePlans()["none"])
        let m = await loadedReadiness(plan)
        await MainActor.run {
            let row = m.row("tool.integrations")
            c.expectEqual(row?.status, .needsYou)
            c.expectEqual(row?.detail, "No agent integration is turned on")
            c.expectEqual(row?.action?.type, .chooseHarnesses)
            c.expectEqual(row?.badge, .optional)
            c.expect(!m.requiredMissing.contains("tool.integrations"))
            c.expect(m.outstandingManualRows.contains { $0.id == "tool.integrations" }, "Done lists it as a step left for you")
        }
    },
    Check("harness picker: opens on rt's set and default, and each selection runs the exact rt setup harnesses argv") { c in
        let plans = try harnessProfilePlans()
        let both = try c.requireSome(plans["both"]?.groups.flatMap(\.rows).first { $0.id == "tool.integrations" }?.action)
        var draft = try c.requireSome(HarnessChoiceDraft(action: both))
        c.expectEqual(draft.options.map(\.id), ["claude", "codex"])
        c.expectEqual(draft.enabled, ["claude", "codex"])
        c.expectEqual(draft.defaultHarness, "claude")
        c.expectEqual(draft.args, ["setup", "harnesses", "claude", "codex", "--default", "claude", "--json"])
        draft.setDefault("codex")
        c.expectEqual(draft.args, ["setup", "harnesses", "claude", "codex", "--default", "codex", "--json"])
        draft.toggle("codex")
        c.expectEqual(draft.args, ["setup", "harnesses", "claude", "--json"], "a default that is turned off is left to rt")
        draft.toggle("claude")
        c.expectEqual(draft.args, ["setup", "harnesses", "--none", "--json"])

        let none = try c.requireSome(plans["none"]?.groups.flatMap(\.rows).first { $0.id == "tool.integrations" }?.action)
        var fresh = try c.requireSome(HarnessChoiceDraft(action: none))
        c.expectEqual(fresh.enabled, [])
        c.expectEqual(fresh.defaultHarness, nil)
        fresh.toggle("codex")
        fresh.toggle("claude")
        c.expectEqual(fresh.args, ["setup", "harnesses", "claude", "codex", "--json"], "ids keep rt's option order, not click order")
        fresh.setDefault("gemini")
        c.expectEqual(fresh.defaultHarness, nil, "a default must be one of those turned on")
        c.expect(HarnessChoiceDraft(action: RowAction(type: .chooseHarnesses, label: "x", options: [])) == nil, "no verb, nothing to run")
    },
    Check("harness picker: the run is the draft's argv, and a refusal shows rt's own message") { c in
        let rt = ScriptedRt()
        rt.answers["setup harnesses claude codex --default codex"] = (0, #"{"contract":1,"at":"x","ok":true,"enabled":["claude","codex"],"default":"codex"}"#)
        rt.answers["setup harnesses codex --default claude"] = (2, #"{"contract":1,"at":"x","error":{"code":"usage","message":"claude is not in the list you turned on. Choose your default from codex."}}"#)
        let client = await ChoiceClient(rt: rt)
        c.expect(await client.run(["setup", "harnesses", "claude", "codex", "--default", "codex", "--json"]) == nil)
        c.expectEqual(rt.calls.last?.args, ["setup", "harnesses", "claude", "codex", "--default", "codex", "--json"])
        c.expectEqual(await client.run(["setup", "harnesses", "codex", "--default", "claude", "--json"]),
                      "claude is not in the list you turned on. Choose your default from codex.")
    },
    Check("process badges: harness metadata names the badge, and a row without it keeps today's Claude rule") { c in
        let claude = ProcessHarness(id: "claude", label: "Claude Code")
        let codex = ProcessHarness(id: "codex", label: "Codex")
        let other = ProcessHarness(id: "gemini", label: "Gemini CLI")
        c.expectEqual(HarnessBadge.forProcess(harness: claude, command: "claude › node"),
                      HarnessBadge(text: "\u{273B} claude", tooltip: "Claude Code session", tint: .claude))
        c.expectEqual(HarnessBadge.forProcess(harness: codex, command: "node › codex"),
                      HarnessBadge(text: "codex", tooltip: "Codex session", tint: .harness))
        c.expectEqual(HarnessBadge.forProcess(harness: other, command: "gemini"),
                      HarnessBadge(text: "gemini", tooltip: "Gemini CLI session", tint: .harness))
        c.expectEqual(HarnessBadge.forProcess(harness: nil, command: "claude › node")?.text, "\u{273B} claude",
                      "a daemon that sends no metadata (integrations off, or an older rt) keeps the Claude badge")
        c.expectEqual(HarnessBadge.forProcess(harness: nil, command: "claude-ish › node"), nil)
        c.expectEqual(HarnessBadge.forProcess(harness: nil, command: "node › codex"), nil,
                      "without metadata a Codex process gets no badge, exactly as before")
        c.expectEqual(HarnessBadge.forProcess(harness: nil, command: "bun › node"), nil)
    },
    Check("process badges: a process row decodes its harness, and an older payload without one still decodes") { c in
        let tagged = try JSONDecoder().decode(ProcessHarnessCarrier.self, from: Data(#"{"harness":{"id":"codex","label":"Codex"}}"#.utf8))
        c.expectEqual(tagged.harness, ProcessHarness(id: "codex", label: "Codex"))
        let bare = try JSONDecoder().decode(ProcessHarnessCarrier.self, from: Data("{}".utf8))
        c.expectEqual(bare.harness, nil)
    },
]

private struct ProcessHarnessCarrier: Decodable { let harness: ProcessHarness? }
