import { test, expect } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { personalSkillsDir } from "../../../lib/skills/writing-style-sources.ts";
import { SOLO_GITHUB_NOTE, SOLO_GITLAB_NOTE } from "../../../lib/setup/validators/accounts.ts";

const STUB = join(import.meta.dir, "stub.ts");

async function run(scenario: string, args: string[], stdin = "", stateDir?: string, extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", STUB, ...args], {
    env: { ...process.env, RT_STUB_SCENARIO: scenario, RT_STUB_STATE_DIR: stateDir ?? mkdtempSync(join(tmpdir(), "stub-")), ...extraEnv },
    stdin: new Blob([stdin]),
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, out, lines: out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
}

test("setup plan: join-happy is installable, perm-denied is not", async () => {
  const ok = await run("join-happy", ["setup", "plan", "--json"]);
  expect(ok.code).toBe(0);
  expect(ok.lines[0].contract).toBe(1);
  expect(ok.lines[0].canInstall).toBe(true);
  const denied = await run("perm-denied-then-granted", ["setup", "plan", "--json"]);
  expect(denied.lines[0].canInstall).toBe(false);
  expect(denied.lines[0].requiredMissing).toContain("perm.fda");
});

test("perm-denied-then-granted: plan flips to installable on the third call", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const first = await run("perm-denied-then-granted", ["setup", "plan", "--json"], "", state);
  const second = await run("perm-denied-then-granted", ["setup", "plan", "--json"], "", state);
  const third = await run("perm-denied-then-granted", ["setup", "plan", "--json"], "", state);
  expect(first.lines[0].canInstall).toBe(false);
  expect(second.lines[0].canInstall).toBe(false);
  expect(third.lines[0].canInstall).toBe(true);
});

test("team join --dry-run reads the code from stdin; no-access is exit 0 {access:'denied'} with a specific message", async () => {
  const happy = await run("join-happy", ["team", "join", "--dry-run", "--json"], JSON.stringify({ code: "ABCD-EFGH" }));
  expect(happy.code).toBe(0);
  expect(happy.lines[0].access).toBe("ok");
  expect(happy.lines[0].team.name).toBe("Acme");
  const denied = await run("join-no-access", ["team", "join", "--dry-run", "--json"], JSON.stringify({ code: "ABCD-EFGH" }));
  expect(denied.code).toBe(0);
  expect(denied.lines[0].access).toBe("denied");
  expect(denied.lines[0].message).toContain("ask");
  const malformed = await run("join-happy", ["team", "join", "--dry-run", "--json"], JSON.stringify({ code: "" }));
  expect(malformed.code).toBe(2);
  expect(malformed.lines[0].error.code).toBe("invite-malformed");
});

test("setup apply streams plan/step/need/done; apply-fail-retry fails once then succeeds with --from", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const first = await run("apply-fail-retry", ["setup", "apply", "--json"], "", state);
  const events = first.lines.map((e) => e.event);
  expect(events[0]).toBe("plan");
  expect(events).toContain("need");
  const done = first.lines.at(-1);
  expect(done.event).toBe("done");
  expect(done.ok).toBe(false);
  expect(done.failedStep).toBe("plugins.install");
  const retry = await run("apply-fail-retry", ["setup", "apply", "--from", "plugins.install", "--json"], "", state);
  expect(retry.lines[0].steps[0].id).toBe("plugins.install");
  expect(retry.lines.at(-1).ok).toBe(true);
});

test("setup apply --only runs just that step, so a checklist row's proxy.install carries its privileged need", async () => {
  const only = await run("join-happy", ["setup", "apply", "--only", "proxy.install", "--json"]);
  expect(only.lines[0].steps.map((s: { id: string }) => s.id)).toEqual(["proxy.install"]);
  expect(only.lines.find((e) => e.event === "need").request).toEqual({ type: "app-privileged", op: "proxy-install" });
  expect(only.lines.at(-1)).toEqual({ event: "done", ok: true, failedStep: null });
});

test("uninstall --dry-run lists L1's action ids; --delete-data needs --yes; version build is numeric", async () => {
  const dry = await run("uninstall", ["uninstall", "--dry-run", "--json"]);
  expect(dry.lines[0].actions.map((a: { id: string }) => a.id)).toEqual(["deck.managed-remove", "services.unregister", "proxy.remove", "path.unlink", "shell.remove", "extension.uninstall", "plugins.uninstall", "app.trash"]);
  const dryDelete = await run("uninstall", ["uninstall", "--dry-run", "--delete-data", "--json"]);
  expect(dryDelete.lines[0].actions.map((a: { id: string }) => a.id)).toContain("data");
  const noYes = await run("uninstall", ["uninstall", "--delete-data", "--json"]);
  expect(noYes.code).toBe(2);
  expect(noYes.lines[0].error.code).toBe("confirm-required");
  const v = await run("join-happy", ["version", "--json"]);
  expect(v.lines[0].version).toBeDefined();
  expect(v.lines[0].build).toBe(0);
});

test("team status and setup github status answer the contract shapes", async () => {
  const ts = await run("join-happy", ["team", "status", "--json"]);
  expect(ts.lines[0].slug).toBe("acme");
  expect(ts.lines[0].members[0].username).toBe("janedoe");
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const before = await run("join-happy", ["setup", "github", "status", "--json"], "", dir);
  expect(before.lines[0]).toMatchObject({ integration: "github", status: "missing" });
  await run("join-happy", ["setup", "github", "connect", "--json"], JSON.stringify({ token: "t" }), dir);
  const after = await run("join-happy", ["setup", "github", "status", "--json"], "", dir);
  expect(after.lines[0]).toMatchObject({ integration: "github", status: "ready" });
  // No gh session: rt sends no handle or owners, which is why the screens draw the GitHub token rows.
  for (const reply of [before, after]) expect(Object.keys(reply.lines[0])).not.toContain("handle");
});

test("team create answers the contract's flat shape, not nested under team", async () => {
  const created = await run("join-happy", ["team", "create", "My Team", "--json"]);
  expect(created.code).toBe(0);
  expect(created.lines[0]).toMatchObject({ contract: 1, slug: "my-team", name: "My Team", created: true });
  expect(typeof created.lines[0].remote).toBe("string");
  expect((created.lines[0] as Record<string, unknown>).team).toBeUndefined();
});

test("apps list: solo scenario has team-gated apps disabled", async () => {
  const solo = await run("solo", ["apps", "list", "--json"]);
  expect(solo.code).toBe(0);
  const board = solo.lines[0].apps.find((a: { name: string }) => a.name === "board");
  expect(board.enabled).toBe(false);
  const happy = await run("join-happy", ["apps", "list", "--json"]);
  const boardHappy = happy.lines[0].apps.find((a: { name: string }) => a.name === "board");
  expect(boardHappy.enabled).toBe(true);
});

test("setup intent solo answers the contract shape", async () => {
  const r = await run("join-happy", ["setup", "intent", "solo", "--json"]);
  expect(r.code).toBe(0);
  expect(r.lines[0]).toMatchObject({ contract: 1, mode: "solo" });
});

test("uninstall real run's done event matches apply's shape with failedStep: null", async () => {
  const real = await run("uninstall", ["uninstall", "--json"]);
  expect(real.code).toBe(0);
  const done = real.lines.at(-1);
  expect(done.event).toBe("done");
  expect(done.ok).toBe(true);
  expect(done.failedStep).toBeNull();
});

test("restore scenario's apply stream starts at home.restore", async () => {
  const first = await run("restore", ["setup", "apply", "--json"]);
  expect(first.lines[0].event).toBe("plan");
  expect(first.lines[0].steps[0].id).toBe("home.restore");
  expect(first.lines[1].event).toBe("step");
  expect(first.lines[1].id).toBe("home.restore");
});

test("uninstall real run streams every v1 action id, the two need events, and honours --delete-data", async () => {
  const keep = await run("uninstall", ["uninstall", "--keep-data", "--yes", "--json"]);
  expect(keep.lines[0].event).toBe("plan");
  expect(keep.lines[0].steps.map((s: { id: string }) => s.id)).toEqual(["deck.managed-remove", "services.unregister", "proxy.remove", "path.unlink", "shell.remove", "extension.uninstall", "plugins.uninstall", "app.trash"]);
  const needs = keep.lines.filter((l: { event: string }) => l.event === "need");
  expect(needs.map((n: { id: string }) => n.id)).toEqual(["services.unregister", "proxy.remove"]);
  expect(needs[0].request.type).toBe("app-unregister-services");
  expect(needs[0].request.plists).toContain("com.mattstack.daemon.plist");
  expect(needs[1].request).toEqual({ type: "app-privileged", op: "proxy-remove" });
  expect(keep.lines.some((l: { id: string }) => l.id === "data")).toBe(false);

  const del = await run("uninstall", ["uninstall", "--delete-data", "--yes", "--json"]);
  expect(del.lines[0].steps.map((s: { id: string }) => s.id)).toContain("data");
  expect(del.lines.at(-1)).toMatchObject({ event: "done", ok: true });
});

// The finish-gate scenario's shapes mirror rt's finish-gated rows and waive verbs.
const EXTENSION = "tool.fast-browser-extension";
const MISSION_CONTROL = "tool.mission-control";
const WAIVED_NOTE = "Skipped on this Mac: Control+Up stays with Mission Control.";
const rowById = (plan: { groups: { rows: Record<string, unknown>[] }[] }, id: string) => plan.groups.flatMap((g) => g.rows).find((r) => r.id === id);

test("finish-gate: the extension row is rt's Add to Chrome, finish-gated and never skippable", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const plan = await run("finish-gate", ["setup", "plan", "--json"], "", state);
  const row = rowById(plan.lines[0], EXTENSION)!;
  expect(row).toMatchObject({ finishGated: true, waivable: false, waived: false, required: false });
  expect(row.action).toEqual({ type: "open-url", label: "Add to Chrome", url: "https://chromewebstore.google.com/detail/fnfikoifhimpdedpdepehibjjkcfbacm",
                               primary: true, waiting: "Waiting for Chrome…", again: "Open again" });
  const refused = await run("finish-gate", ["setup", "waive", EXTENSION, "--json"], "", state);
  expect(refused.code).toBe(2);
  expect(refused.lines[0].error.code).toBe("not-waivable");
});

test("finish-gate: the Mission Control row blocks Finish, waive moves it to waived, unwaive re-arms it", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const first = await run("finish-gate", ["setup", "plan", "--json"], "", state);
  expect(first.code).toBe(0);
  expect(first.lines[0].canInstall).toBe(true);
  expect(first.lines[0].finishBlockedBy).toEqual([MISSION_CONTROL]);
  const row = rowById(first.lines[0], MISSION_CONTROL)!;
  expect(row).toMatchObject({ status: "needs-you", finishGated: true, waivable: true, waived: false, required: false });

  const waive = await run("finish-gate", ["setup", "waive", MISSION_CONTROL, "--json"], "", state);
  expect(waive.code).toBe(0);
  expect(waive.lines[0]).toMatchObject({ ok: true, id: MISSION_CONTROL, waived: [MISSION_CONTROL] });

  const second = await run("finish-gate", ["setup", "plan", "--json"], "", state);
  expect(second.lines[0].finishBlockedBy).toEqual([]);
  const waived = rowById(second.lines[0], MISSION_CONTROL)!;
  expect(waived).toMatchObject({ waived: true, required: false, status: "needs-you", optionalNote: WAIVED_NOTE });

  const unwaive = await run("finish-gate", ["setup", "unwaive", MISSION_CONTROL, "--json"], "", state);
  expect(unwaive.lines[0].waived).toEqual([]);
  const third = await run("finish-gate", ["setup", "plan", "--json"], "", state);
  expect(third.lines[0].finishBlockedBy).toEqual([MISSION_CONTROL]);
  expect(rowById(third.lines[0], MISSION_CONTROL)!.waived).toBe(false);
});

test("setup finish records finishedAt where the app reads it, the way rt does", async () => {
  const home = mkdtempSync(join(tmpdir(), "stub-home-"));
  const res = await run("finish-gate", ["setup", "finish", "--json"], "", undefined, { HOME: home });
  expect(res.code).toBe(0);
  expect(res.lines[0]).toMatchObject({ contract: 1, ok: true });
  const state = JSON.parse(readFileSync(join(home, ".mattstack", "rt", "setup-state.json"), "utf8"));
  expect(state).toMatchObject({ v: 2, finishedAt: res.lines[0].finishedAt });
});

test("finish-gate: waive refuses a row that is not finish-gated with the contract's exit-2 envelope", async () => {
  const res = await run("finish-gate", ["setup", "waive", "tool.chrome", "--json"]);
  expect(res.code).toBe(2);
  expect(res.lines[0].error.code).toBe("not-finish-gated");
});

test("every other scenario keeps an open gate and no extension row", async () => {
  for (const scenario of ["join-happy", "create-happy", "perm-denied-then-granted"]) {
    const res = await run(scenario, ["setup", "plan", "--json"]);
    expect(res.lines[0].finishBlockedBy).toEqual([]);
    expect(rowById(res.lines[0], EXTENSION)).toBeUndefined();
    expect(rowById(res.lines[0], MISSION_CONTROL)).toBeUndefined();
    expect(writingStyleRow(res.lines[0])).toBeUndefined();
  }
});

// The writing-style scenario feeds the ChooseSheet walkthrough on the
// checklist, Done and Settings.
const WRITING_STYLE = "skills.writing-style";
const SPARSE = "mattstack:writing-style-sparse";
const writingStyleRow = (plan: { groups: { rows: Record<string, unknown>[] }[] }) => plan.groups.flatMap((g) => g.rows).find((r) => r.id === WRITING_STYLE);
type ChooseAction = {
  type: string; verb: string[]; selected?: string; subtitle: string; footnote: string;
  options: { id: string; label: string; detail: string; sample?: string }[];
  other: { label: string; hint: string; suggestions: string[] };
};
const CHOOSE_SUBTITLE = "The voice agents use for reviews, replies and PR descriptions posted under your name.";
const CHOOSE_FOOTNOTE = "You can also choose from a terminal: rt skills writing-style use";

test("writing-style: the row blocks Finish with a choose action until use picks a style", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const first = await run("writing-style", ["setup", "plan", "--json"], "", state);
  expect(first.code).toBe(0);
  expect(first.lines[0].canInstall).toBe(true);
  expect(first.lines[0].finishBlockedBy).toEqual([WRITING_STYLE]);
  const row = writingStyleRow(first.lines[0])!;
  expect(row).toMatchObject({ kind: "tool", status: "needs-you", detail: "Not chosen yet", required: false, finishGated: true, waivable: false });
  const action = row.action as ChooseAction;
  expect(action.type).toBe("choose");
  expect(action.verb).toEqual(["skills", "writing-style", "use"]);
  expect(action.selected).toBeUndefined();
  expect(action.subtitle).toBe(CHOOSE_SUBTITLE);
  expect(action.footnote).toBe(CHOOSE_FOOTNOTE);
  expect(action.options.map((o) => o.id)).toEqual([SPARSE, "mattstack:writing-style-conversational", "mattstack:writing-style-structured"]);
  expect(action.options.filter((o) => o.sample).map((o) => o.id)).toEqual([SPARSE, "mattstack:writing-style-conversational", "mattstack:writing-style-structured"]);
  expect(action.other).toEqual({
    label: "Use my own skill…", hint: "Any installed skill id. Start one with rt skills writing-style new.",
    suggestions: ["acme:review-voice", "acme:team-writing-style", "superpowers:brainstorming", "superpowers:writing-plans", "team-voice", "team:team-writing-style"],
  });

  const used = await run("writing-style", ["skills", "writing-style", "use", SPARSE, "--json"], "", state);
  expect(used.code).toBe(0);
  expect(used.lines[0]).toMatchObject({ contract: 1, skill: SPARSE, scope: "user" });

  const second = await run("writing-style", ["setup", "plan", "--json"], "", state);
  expect(second.lines[0].finishBlockedBy).toEqual([]);
  const ready = writingStyleRow(second.lines[0])!;
  expect(ready).toMatchObject({ status: "ready", detail: "Sparse (yours)" });
  expect((ready.action as ChooseAction).selected).toBe(SPARSE);
});

test("writing-style: use refuses a bad id and an unknown skill with exit 2 and changes nothing; an own skill id is accepted", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const bad = await run("writing-style", ["skills", "writing-style", "use", "-rf", "--json"], "", state);
  expect(bad.code).toBe(2);
  expect(bad.lines[0].error).toEqual({ code: "bad-id", message: "\"-rf\" is not a skill id" });
  const unknown = await run("writing-style", ["skills", "writing-style", "use", "not-installed", "--json"], "", state);
  expect(unknown.code).toBe(2);
  expect(unknown.lines[0].error.code).toBe("unknown-skill");
  expect(unknown.lines[0].error.message).toStartWith("not-installed is not installed here. Choose one of: ");
  const still = await run("writing-style", ["setup", "plan", "--json"], "", state);
  expect(still.lines[0].finishBlockedBy).toEqual([WRITING_STYLE]);

  const own = await run("writing-style", ["skills", "writing-style", "use", "team-voice", "--json"], "", state);
  expect(own.code).toBe(0);
  const after = await run("writing-style", ["setup", "plan", "--json"], "", state);
  const ready = writingStyleRow(after.lines[0])!;
  expect(ready).toMatchObject({ status: "ready", detail: "team-voice (yours)" });
  expect((ready.action as ChooseAction).selected).toBe("team-voice");
});

// RT_STUB_REAL_WRITING_STYLE=1 judges the picker against the operator's real
// skills, read through the same lib/skills code the app ships with, against a
// fixture home only; it must never touch the real machine or write anywhere.
function buildRealFixture(): { home: string; claudeBin: string } {
  const home = mkdtempSync(join(tmpdir(), "stub-real-home-"));

  const personalDir = join(personalSkillsDir(home), "team-voice");
  mkdirSync(personalDir, { recursive: true });
  writeFileSync(join(personalDir, "SKILL.md"), "---\nname: team-voice\ndescription: personal voice\n---\nbody\n");

  const claudeSkillsDir = join(home, ".claude", "skills", "x:custom-note");
  mkdirSync(claudeSkillsDir, { recursive: true });
  writeFileSync(join(claudeSkillsDir, "SKILL.md"), "---\nname: x:custom-note\ndescription: not a writing style\n---\nbody\n");

  const pluginInstallPath = join(home, "plugins", "acme");
  mkdirSync(join(pluginInstallPath, ".claude-plugin"), { recursive: true });
  writeFileSync(join(pluginInstallPath, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version: "1.0.0" }));
  const pluginSkillDir = join(pluginInstallPath, "skills", "team-writing-style");
  mkdirSync(pluginSkillDir, { recursive: true });
  writeFileSync(join(pluginSkillDir, "SKILL.md"), "---\nname: team-writing-style\ndescription: acme's team voice\n---\nbody\n");

  const claudeBin = join(home, "fixture-claude");
  writeFileSync(claudeBin, [
    "#!/usr/bin/env bun",
    `console.log(JSON.stringify([{ id: "acme@marketplace", enabled: true, installPath: ${JSON.stringify(pluginInstallPath)} }]));`,
    "",
  ].join("\n"));
  chmodSync(claudeBin, 0o755);

  return { home, claudeBin };
}

function snapshotTree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, prefix: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const st = statSync(full);
      if (st.isDirectory()) walk(full, rel);
      else out.push(`${rel}:${st.size}:${st.mtimeMs}`);
    }
  };
  walk(dir, "");
  return out;
}

// Each call below is a fresh stub process that itself spawns the fixture
// claude binary, so the cold starts stack up; a generous timeout keeps this
// from flaking under load rather than proving anything about the code.
test("writing-style real-data mode: options and suggestions come from the fixture home, use accepts a fixture id and rejects an unknown one, a chosen personal style reads ready, and nothing is written", async () => {
  const { home, claudeBin } = buildRealFixture();
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const extraEnv = { RT_STUB_REAL_WRITING_STYLE: "1", RT_STUB_REAL_HOME: home, RT_STUB_CLAUDE_BIN: claudeBin };
  const before = snapshotTree(home);

  const first = await run("writing-style", ["setup", "plan", "--json"], "", state, extraEnv);
  expect(first.code).toBe(0);
  const row = writingStyleRow(first.lines[0])!;
  expect(row).toMatchObject({ status: "needs-you", detail: "Not chosen yet", finishGated: false });
  const action = row.action as ChooseAction;
  const ids = action.options.map((o) => o.id);
  expect(ids).toEqual([SPARSE, "mattstack:writing-style-conversational", "mattstack:writing-style-structured"]);
  expect(action.other.suggestions).toContain("x:custom-note");
  expect(action.other.suggestions).toContain("acme:team-writing-style");
  expect(action.other.suggestions).toContain("team-voice");

  const badShape = await run("writing-style", ["skills", "writing-style", "use", "-rf", "--json"], "", state, extraEnv);
  expect(badShape.code).toBe(2);
  expect(badShape.lines[0].error.code).toBe("bad-id");

  const unknown = await run("writing-style", ["skills", "writing-style", "use", "nobody:not-real", "--json"], "", state, extraEnv);
  expect(unknown.code).toBe(2);
  expect(unknown.lines[0].error.code).toBe("unknown-skill");

  const used = await run("writing-style", ["skills", "writing-style", "use", "team-voice", "--json"], "", state, extraEnv);
  expect(used.code).toBe(0);
  expect(used.lines[0]).toMatchObject({ skill: "team-voice", scope: "user" });

  // Real rt's `use` links a chosen personal skill before returning; this mode
  // never writes to realHome, so the row must still read ready off the
  // in-memory installed set, not off a symlink that was never created.
  const afterUse = await run("writing-style", ["setup", "plan", "--json"], "", state, extraEnv);
  const readyRow = writingStyleRow(afterUse.lines[0])!;
  expect(readyRow).toMatchObject({ status: "ready", detail: "team-voice (yours)" });
  expect((readyRow.action as ChooseAction).selected).toBe("team-voice");

  expect(snapshotTree(home)).toEqual(before);
}, 20000);

test("writing-style real-data mode requires RT_STUB_REAL_HOME: unset or non-existent fails loudly naming it", async () => {
  const unset = await run("writing-style", ["setup", "plan", "--json"], "", undefined, { RT_STUB_REAL_WRITING_STYLE: "1" });
  expect(unset.code).toBe(2);
  expect(unset.lines[0].error.code).toBe("no-real-home");
  expect(unset.lines[0].error.message).toContain("RT_STUB_REAL_HOME");

  const missing = join(tmpdir(), `stub-real-home-missing-${Date.now()}`);
  const notADir = await run("writing-style", ["setup", "plan", "--json"], "", undefined, {
    RT_STUB_REAL_WRITING_STYLE: "1", RT_STUB_REAL_HOME: missing,
  });
  expect(notADir.code).toBe(2);
  expect(notADir.lines[0].error.code).toBe("no-real-home");
});

test("every other scenario ignores RT_STUB_REAL_WRITING_STYLE (only the writing-style scenario reads it)", async () => {
  const { home, claudeBin } = buildRealFixture();
  const extraEnv = { RT_STUB_REAL_WRITING_STYLE: "1", RT_STUB_REAL_HOME: home, RT_STUB_CLAUDE_BIN: claudeBin };
  const res = await run("join-happy", ["setup", "plan", "--json"], "", undefined, extraEnv);
  expect(writingStyleRow(res.lines[0])).toBeUndefined();
});

test("logins: add, list and remove keep state and list prints a bare array without passwords", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const empty = await run("solo", ["logins", "list", "--json"], "", state);
  expect(JSON.parse(empty.out)).toEqual([]);
  const add = await run("solo", ["logins", "add", "https://login.example.com", "--json"], JSON.stringify({ email: "dev@example.com", password: "pw" }), state);
  expect(add.code).toBe(0);
  const listed = await run("solo", ["logins", "list", "--json"], "", state);
  expect(JSON.parse(listed.out)).toEqual([{ origin: "https://login.example.com", email: "dev@example.com",
    fields: { email: "devlogin:login.example.com:email", password: "devlogin:login.example.com:password" } }]);
  expect(listed.out).not.toContain("pw\"");
  await run("solo", ["logins", "remove", "https://login.example.com", "--json"], "", state);
  expect(JSON.parse((await run("solo", ["logins", "list", "--json"], "", state)).out)).toEqual([]);
});

test("clone-partial scenario: the first apply reports repos.clone partial and finishes ok; a --from retry lands it", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "stub-"));
  const first = (await run("clone-partial", ["setup", "apply", "--json"], "", stateDir)).lines;
  expect(first).toContainEqual(expect.objectContaining({ event: "step", id: "repos.clone", state: "partial" }));
  expect(first.at(-1)).toEqual({ event: "done", ok: true, failedStep: null });
  const retry = (await run("clone-partial", ["setup", "apply", "--from", "repos.clone", "--json"], "", stateDir)).lines;
  expect(retry).toContainEqual(expect.objectContaining({ event: "step", id: "repos.clone", state: "done" }));
});

test("join-team-accounts: the after-install note before Install, then Slack blocks Finish", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const before = (await run("join-team-accounts", ["setup", "plan", "--json"], "", dir)).lines[0];
  const ids = (p: { groups: { rows: { id: string }[] }[] }) => p.groups.flatMap((g) => g.rows.map((r) => r.id));
  expect(ids(before)).toContain("accounts.after-install");
  expect(ids(before)).not.toContain("account.slack");
  expect(before.canInstall).toBe(true);
  await run("join-team-accounts", ["setup", "apply", "--json"], "", dir);
  const after = (await run("join-team-accounts", ["setup", "plan", "--json"], "", dir)).lines[0];
  expect(ids(after)).not.toContain("accounts.after-install");
  expect(ids(after).filter((id) => id === "account.slack")).toHaveLength(1);
  expect(after.finishBlockedBy).toEqual(["account.slack"]);
  expect(after.requiredMissing).toContain("account.slack");
});

test("join-status answers waiting, then approved, and no-join before this Mac joins in any scenario", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const early = await run("join", ["setup", "join-status", "--json"], "", dir);
  expect(early.code).toBe(2);
  expect(early.lines[0].error.code).toBe("no-join");
  await run("join", ["setup", "apply", "--only", "team.join", "--json"], "", dir);
  const first = await run("join", ["setup", "join-status", "--json"], "", dir);
  expect(first.code).toBe(0);
  expect(first.lines[0].state).toBe("waiting");
  expect(typeof first.lines[0].since).toBe("string");
  expect(first.lines[0].team).toEqual({ slug: "acme", name: "Acme" });
  expect(first.lines[0].uses).toEqual({ repos: 2, accounts: 2, packs: 1 });
  const second = await run("join", ["setup", "join-status", "--json"], "", dir);
  expect(second.lines[0].state).toBe("approved");
  expect(second.lines[0].since).toBeNull();
  const quickDir = mkdtempSync(join(tmpdir(), "stub-"));
  await run("join-team-accounts", ["setup", "apply", "--only", "team.join", "--json"], "", quickDir);
  expect((await run("join-team-accounts", ["setup", "join-status", "--json"], "", quickDir)).lines[0].state).toBe("approved");
  const creatorDir = mkdtempSync(join(tmpdir(), "stub-"));
  await run("create-happy", ["setup", "apply", "--only", "team.join", "--json"], "", creatorDir);
  expect((await run("create-happy", ["setup", "join-status", "--json"], "", creatorDir)).lines[0].state).toBe("approved");
});

const FORM_KEYS = ["path", "team", "stage", "sections", "continueReady", "continueNote", "startReady", "start", "paused", "home"].sort();
const ROW_KEYS = ["id", "title", "subtext", "state", "detail", "action", "waiting", "watch", "optional"].sort();
type StubAction = {
  type: string; label?: string; verb?: string[]; url?: string; target?: string; which?: string; integration?: string;
  fields?: { name: string; label?: string; secret?: boolean }[]; identity?: string; clonePath?: string; options?: { id: string }[]; selected?: string;
};
type StubRow = { id: string; title: string; subtext: string; state: string; detail: string; watch: boolean; optional: boolean; action: StubAction | null };
type StubForm = {
  path: string | null; team: { slug: string; name: string; invitedBy: string | null } | null; stage: string | null;
  sections: Record<string, StubRow[]>; continueReady: boolean; startReady: boolean; paused: unknown; home: unknown;
};

async function form(dir: string, section?: string, scenario = "join-happy", extra: string[] = []): Promise<StubForm> {
  const res = await run(scenario, ["setup", "form", ...(section ? ["--section", section] : []), ...extra, "--json"], "", dir);
  expect(res.code).toBe(0);
  const { contract, at: _at, ...body } = res.lines[0];
  expect(contract).toBe(1);
  expect(Object.keys(body).sort()).toEqual(FORM_KEYS);
  for (const rows of Object.values(body.sections as Record<string, StubRow[]>)) {
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
  }
  return body as StubForm;
}

/** What the app does for a row's action: an rt verb, or (Test drive) the app's own side told to the stub. */
async function answer(scenario: string, dir: string, row: StubRow): Promise<void> {
  const a = row.action!;
  const verb = async (args: string[], stdin: unknown = "") =>
    expect((await run(scenario, [...args, "--json"], typeof stdin === "string" ? stdin : JSON.stringify(stdin), dir)).code).toBe(0);
  const filled = Object.fromEntries((a.fields ?? []).map((f) => [f.name, `fake-${f.name}`]));
  switch (a.type) {
    case "run": case "oauth": return verb(a.verb!);
    case "connect": return verb(a.verb ?? ["setup", a.integration!, "connect"], a.fields?.length ? filled : { token: "fake-token" });
    case "form": return verb(a.verb!, a.verb![0] === "home" ? { url: "git@github.com:janedoe/mattstack-home.git" } : filled);
    case "owner-once": return verb(["setup", a.integration!, "create-app"], filled);
    case "open-url": return verb(["stub", "opened", a.url!]);
    case "open-settings": return verb(["stub", "grant", a.target!]);
    case "request-permission": return verb(["stub", "grant", a.which!]);
    case "place-repo": return verb(["setup", "repo", "place"], { identity: a.identity, mode: "clone", path: a.clonePath });
    case "choose": return verb([...a.verb!, "local"]);
    case "choose-folder": return verb(["setup", "repo-root", "set"], { root: "/Users/janedoe/code" });
    default: throw new Error(`no answer for ${a.type} on ${row.id}`);
  }
}

/** Answers every open row in a section, once per state it shows, re-reading as the app's watch would. */
async function settle(scenario: string, dir: string, section: string, extra: string[] = []): Promise<StubForm> {
  const acted = new Set<string>();
  const key = section === "this-mac" ? "thisMac" : section;
  for (let round = 0; round < 12; round++) {
    const read = await form(dir, section, scenario, extra);
    const open = read.sections[key]!.filter((r) => r.state !== "done" && r.action !== null);
    if (open.length === 0 && read.sections[key]!.every((r) => r.state === "done" || r.optional)) return read;
    for (const row of open) {
      if (acted.has(`${row.id}:${row.state}`)) continue;
      acted.add(`${row.id}:${row.state}`);
      await answer(scenario, dir, row);
    }
  }
  throw new Error(`${section} never settled`);
}

/** Drives a scenario the way SetupCoordinator does, from P1 to the end, and returns the stages rt's whole reads named. */
type Stage = () => Promise<string>;

async function walk(scenario: string, choose: (dir: string, stage: Stage) => Promise<void>): Promise<{ dir: string; stages: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const stages: string[] = [];
  const stage = async () => {
    const s = (await form(dir, undefined, scenario)).stage!;
    if (stages.at(-1) !== s) stages.push(s);
    return s;
  };
  expect(await stage()).toBe("macos");
  await settle(scenario, dir, "macos");
  expect(await stage()).toBe("path");
  await choose(dir, stage);
  if (await stage() === "connect") {
    expect((await settle(scenario, dir, "connect")).continueReady).toBe(true);
    expect(await stage()).toBe("this-mac");
    expect((await settle(scenario, dir, "this-mac")).startReady).toBe(true);
  }
  const applied = await run(scenario, ["setup", "apply", "--resume", "--unattended", "--json"], "", dir);
  expect(applied.lines.at(-1).event).toBe("done");
  if (await stage() === "paused") {
    const retried = await run(scenario, ["setup", "apply", "--from", applied.lines.at(-1).failedStep, "--json"], "", dir);
    expect(retried.lines.at(-1)).toEqual({ event: "done", ok: true, failedStep: null });
    await stage();
  }
  return { dir, stages };
}

const INVITE = JSON.stringify({ code: "ABCD-EFGH" });

async function joinThroughWait(scenario: string, dir: string, stage: Stage): Promise<void> {
  const dry = await run(scenario, ["team", "join", "--dry-run", "--json"], INVITE, dir);
  expect(dry.lines[0].team.owner).toBe("Jane Doe");
  expect(await stage()).toBe("invite");
  await settle(scenario, dir, "invite");
  await run(scenario, ["setup", "apply", "--only", "team.join", "--json"], "", dir);
  for (let i = 0; i < 3 && (await run(scenario, ["setup", "join-status", "--json"], "", dir)).lines[0].state !== "approved"; i++) {
    expect(await stage()).toBe("waiting");
  }
}

test("setup form walks the join scenario's stages", async () => {
  const { dir, stages } = await walk("join-happy", (dir, stage) => joinThroughWait("join-happy", dir, stage));
  expect(stages).toEqual(["macos", "path", "invite", "waiting", "connect", "this-mac", "ready"]);
  const done = await form(dir);
  expect(done.home).toEqual({ label: "Open the board", url: "https://board.mattstack" });
  expect(done.team).toEqual({ slug: "acme", name: "Acme", invitedBy: "Jane Doe" });
  expect(Object.keys(done.sections).sort()).toEqual(["connect", "invite", "macos", "restore", "thisMac"]);
  expect(done.sections.connect!.map((r) => r.id)).toEqual(["forge", "slack", "claude", "signin.doppler", "linear", "fast-browser"]);
}, 20000);

test("the slow scenario walks the join stages too", async () => {
  const { stages } = await walk("slow", (dir, stage) => joinThroughWait("slow", dir, stage));
  expect(stages).toEqual(["macos", "path", "invite", "waiting", "connect", "this-mac", "ready"]);
}, 20000);

test("the paused scenario stops at a failed step, then Retry lands it", async () => {
  const { stages } = await walk("apply-fail-retry", (dir, stage) => joinThroughWait("apply-fail-retry", dir, stage));
  expect(stages).toEqual(["macos", "path", "invite", "connect", "this-mac", "paused", "ready"]);
}, 20000);

test("the create scenario makes the team, connects the owner's accounts, and runs", async () => {
  const { dir, stages } = await walk("create-happy", async (dir) => {
    const create = await settle("create-happy", dir, "create", ["--forge", "gitlab"]);
    expect(create.sections.create!.map((r) => [r.id, r.detail])).toEqual([["forge.token", "Connected"]]);
    const made = await run("create-happy", ["team", "create", "Widgets", "--forge", "gitlab", "--group", "acme", "--others", "--json"], "", dir);
    expect(made.lines[0]).toMatchObject({ slug: "widgets", name: "Widgets", created: true });
  });
  expect(stages).toEqual(["macos", "path", "connect", "this-mac", "ready"]);
  const done = await form(dir, undefined, "create-happy");
  expect(done.team).toEqual({ slug: "widgets", name: "Widgets", invitedBy: null });
  expect(done.sections.connect!.map((r) => r.id)).toEqual(["forge", "slack-app", "slack", "claude", "fast-browser"]);
  expect(done.sections.connect!.find((r) => r.id === "forge")!.detail).toBe("Connected");
}, 20000);

test("the solo scenario connects nothing it need not and keeps the found folder for clones", async () => {
  const { dir, stages } = await walk("solo", async (dir) => {
    expect((await run("solo", ["setup", "intent", "solo", "--json"], "", dir)).code).toBe(0);
  });
  expect(stages).toEqual(["macos", "path", "connect", "this-mac", "ready"]);
  const done = await form(dir, undefined, "solo");
  expect(done.home).toEqual({ label: "Open the console", url: "https://console.mattstack" });
  expect(done.sections.thisMac!.find((r) => r.id === "repos.root")).toMatchObject({ state: "done", detail: "/Users/janedoe/Documents/GitHub" });
}, 20000);

test("the solo connect screen draws GitHub and GitLab, both optional, then Claude and an optional Fast Browser", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  expect((await run("solo", ["setup", "intent", "solo", "--json"], "", dir)).code).toBe(0);
  const connect = async () => (await form(dir, "connect", "solo")).sections.connect!;
  const rows = await connect();
  expect(rows.map((r) => [r.id, r.title, r.subtext, r.optional])).toEqual([
    ["forge", "GitHub", "Optional. Lets mattstack open PRs", true],
    ["forge.gitlab", "GitLab", "Optional. Lets mattstack open MRs", true],
    ["claude", "Claude", "You know, to do agentic stuff.", false],
    ["fast-browser", "Fast Browser", "Optional. Lets agents drive your real Chrome", true],
  ]);
  const gitlab = rows.find((r) => r.id === "forge.gitlab")!;
  expect([gitlab.state, gitlab.action?.type]).toEqual(["todo", "connect"]);
  expect(gitlab.detail).toBe("On your own GitLab server? Connect from a terminal with rt setup gitlab connect --host <host>");
  expect((await run("solo", ["setup", "gitlab", "connect", "--json"], JSON.stringify({ token: "glpat-x" }), dir)).code).toBe(0);
  expect((await connect()).find((r) => r.id === "forge.gitlab")).toMatchObject({ state: "done", detail: "Connected" });
});

test("the solo plan's accounts are the optional GitHub and GitLab rows real rt plans", async () => {
  const plan = (await run("solo", ["setup", "plan", "--json"])).lines[0];
  const accounts = plan.groups.find((g: { id: string }) => g.id === "accounts").rows;
  expect(accounts.map((r: { id: string; required: boolean; optionalNote: string }) => [r.id, r.required, r.optionalNote])).toEqual([
    ["account.github", false, SOLO_GITHUB_NOTE],
    ["account.gitlab", false, SOLO_GITLAB_NOTE],
  ]);
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  expect((await run("solo", ["setup", "gitlab", "connect", "--json"], JSON.stringify({ token: "glpat-x" }), dir)).code).toBe(0);
  const after = (await run("solo", ["setup", "plan", "--json"], "", dir)).lines[0].groups.find((g: { id: string }) => g.id === "accounts").rows;
  expect(after.find((r: { id: string }) => r.id === "account.gitlab")).toMatchObject({ status: "ready", detail: "Connected as janedoe", action: null });
});

test("the restore scenario runs straight after the restore", async () => {
  const { stages } = await walk("restore", async (dir) => {
    const refused = await run("restore", ["home", "restore", "janedoe/mattstack-home", "--stdin", "--json"], "", dir);
    expect(refused.code).toBe(2);
    expect(refused.lines[0].error.code).toBe("bad-stdin");
    const restored = await run("restore", ["home", "restore", "janedoe/mattstack-home", "--stdin", "--json"], "AGE-SECRET-KEY-1FAKE", dir);
    expect(restored.lines[0]).toMatchObject({ ok: true, repo: "janedoe/mattstack-home" });
  });
  expect(stages).toEqual(["macos", "path", "running", "ready"]);
});

test("P1 starts with all three to do, and the app's grants answer them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const fresh = (await form(dir, "macos")).sections.macos!;
  expect(fresh.map((r) => [r.id, r.state, r.action?.type])).toEqual([
    ["perm.fda", "todo", "open-settings"], ["perm.notifications", "todo", "request-permission"], ["mac.fancy-urls", "todo", "run"],
  ]);
  await run("join-happy", ["stub", "grant", "fda", "--json"], "", dir);
  await run("join-happy", ["stub", "grant", "notifications", "--json"], "", dir);
  const granted = (await form(dir, "macos")).sections.macos!;
  expect(granted.slice(0, 2).map((r) => [r.state, r.detail])).toEqual([["done", "Granted"], ["done", "Allowed"]]);
});

test("the waiting Claude row carries rt's paste-code action, and claude code signs it in", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const early = await run("join-happy", ["setup", "claude", "code", "--json"], JSON.stringify({ code: "abc" }), dir);
  expect(early.code).toBe(2);
  expect(early.lines[0].error.code).toBe("no-login");
  await run("join-happy", ["setup", "claude", "connect", "--json"], "", dir);
  const claude = () => form(dir, "connect").then((f) => f.sections.connect!.find((r) => r.id === "claude")!);
  const waiting = await claude();
  expect(waiting).toMatchObject({ state: "waiting", detail: "Finish signing in in your browser", watch: true });
  expect(waiting.action).toEqual({ type: "form", label: "Sign in", verb: ["setup", "claude", "code"], fields: [{ name: "code", label: "Paste the code from your browser", secret: true }] });
  expect((await claude()).state).toBe("waiting");
  const empty = await run("join-happy", ["setup", "claude", "code", "--json"], JSON.stringify({ code: " " }), dir);
  expect(empty.lines[0].error.code).toBe("bad-stdin");
  const signed = await run("join-happy", ["setup", "claude", "code", "--json"], JSON.stringify({ code: "abc" }), dir);
  expect(signed.lines[0]).toMatchObject({ integration: "claude", status: "ready", detail: "Signed in as janedoe@example.com" });
  expect(await claude()).toMatchObject({ state: "done", action: null });
});

test("Fast Browser lands a few reads after the app opens the Web Store", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const row = () => form(dir, "connect").then((f) => f.sections.connect!.find((r) => r.id === "fast-browser")!);
  const todo = await row();
  expect(todo).toMatchObject({ state: "todo", optional: false, watch: true, waiting: "Waiting for Chrome…" });
  expect(todo.action).toMatchObject({ type: "open-url", label: "Add to Chrome", primary: true });
  expect((await row()).state).toBe("todo");
  await run("join-happy", ["stub", "opened", todo.action!.url!, "--json"], "", dir);
  expect((await row()).state).toBe("todo");
  expect((await row()).state).toBe("todo");
  expect(await row()).toMatchObject({ state: "done", detail: "Added", action: null });
});

test("this-mac waits on a repo pick, and the settings choice opens and closes the remote row", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const read = () => form(dir, "this-mac");
  const first = await read();
  expect(first.startReady).toBe(false);
  const repo = first.sections.thisMac![0]!;
  expect(repo).toMatchObject({ id: "repos.place:github.com/acme/widgets", state: "todo", detail: "Choose where your repos go" });
  expect(repo.action).toMatchObject({ type: "place-repo", mode: "clone", oneClick: { label: "Clone here", mode: "clone" }, segmentRecords: true, awaitsRun: false });
  const placed = await run("join-happy", ["setup", "repo", "place", "--json"], JSON.stringify({ identity: "github.com/acme/widgets", mode: "checkout", path: "/Users/janedoe/src/widgets" }), dir);
  expect(placed.lines[0]).toMatchObject({ identity: "github.com/acme/widgets", mode: "checkout", path: "/Users/janedoe/src/widgets" });
  const second = await read();
  expect(second.startReady).toBe(false);
  expect(second.sections.thisMac!.map((r) => [r.id, r.state])).toEqual([["repos.place:github.com/acme/widgets", "done"], ["settings.backup", "todo"]]);
  expect(second.sections.thisMac![0]).toMatchObject({ state: "done", detail: "rt uses your checkout at ~/src/widgets next" });
  expect(second.sections.thisMac![0]!.action).toMatchObject({ mode: "checkout", checkoutPath: "/Users/janedoe/src/widgets", oneClick: null, awaitsRun: true });

  const remote = await run("join-happy", ["setup", "home-backup", "remote", "--json"], "", dir);
  expect(remote.lines[0].homeBackup).toEqual({ mode: "remote" });
  const third = await read();
  expect(third.startReady).toBe(false);
  expect(third.sections.thisMac!.map((r) => [r.id, r.state])).toEqual([["repos.place:github.com/acme/widgets", "done"], ["settings.backup", "done"], ["settings.remote", "todo"]]);
  const remoteRow = third.sections.thisMac!.find((r) => r.id === "settings.remote")!;
  expect(Object.keys(remoteRow.action!)).not.toContain("alternatives");
  const url = "git@github.com:janedoe/mattstack-home.git";
  const staged = await run("join-happy", ["home", "remote", "set", "--json"], JSON.stringify({ url }), dir);
  expect(staged.lines[0]).toMatchObject({ staged: true, url, created: false, pushed: false });
  expect((await read()).sections.thisMac!.find((r) => r.id === "settings.remote")).toMatchObject({ state: "done", detail: url });
  await run("join-happy", ["setup", "home-backup", "local", "--json"], "", dir);
  const last = await read();
  expect(last.sections.thisMac!.map((r) => r.id)).toEqual(["repos.place:github.com/acme/widgets", "settings.backup"]);
  expect(last.startReady).toBe(true);
});

test("setup form reads running while an apply holds the run, and paused with what failed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const read = async () => (await run("apply-fail-retry", ["setup", "form", "--json"], "", dir)).lines[0];
  for (const key of ["granted-fda", "granted-notifications", "proxy-installed", "path-join", "team-joined", "join-status-calls"]) writeFileSync(join(dir, key), "2");
  writeFileSync(join(dir, "run-live"), "1");
  expect((await read()).stage).toBe("running");
  await run("apply-fail-retry", ["setup", "apply", "--resume", "--unattended", "--json"], "", dir);
  const paused = await read();
  expect(paused.stage).toBe("paused");
  expect(paused.paused).toEqual({ step: "plugins.install", title: "Couldn't install Claude plugins", detail: "claude plugin install exited 1",
    remedy: "Open Claude Code once so it finishes first-run, then Retry.", log: ["plugins.install: working…"], action: null });
  await run("apply-fail-retry", ["setup", "apply", "--from", "plugins.install", "--json"], "", dir);
  expect((await read()).stage).toBe("ready");
});

test("setup form --section create answers only the create rows for the forge it names", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const res = await run("create-happy", ["setup", "form", "--section", "create", "--forge", "gitlab", "--json"], "", dir);
  expect(res.lines[0].stage).toBeNull();
  expect(Object.keys(res.lines[0].sections)).toEqual(["create"]);
  const row = res.lines[0].sections.create[0];
  expect(row).toMatchObject({ id: "forge.token", title: "GitLab", state: "todo" });
  expect(row.action).toMatchObject({ type: "connect", integration: "gitlab", create: { label: "Create token" } });
  expect(row.action.create.url).toStartWith("https://gitlab.com/-/user_settings/personal_access_tokens?");
});

// Test drive setup's pacing: the waits a person sits through, and the bar's motion.
const INSTANT = { RT_STUB_SPEED: "instant" };

test("an instant speed holds the approval until its wait has passed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  await run("join-happy", ["setup", "apply", "--only", "team.join", "--json"], "", dir, INSTANT);
  const status = async () => (await run("join-happy", ["setup", "join-status", "--json"], "", dir, INSTANT)).lines[0].state;
  expect(await status()).toBe("waiting");
  expect(await status()).toBe("waiting");
  await Bun.sleep(1600);
  expect(await status()).toBe("approved");
  expect(await status()).toBe("approved");
});

test("an instant prepare reads busy while it installs, and git leads the screens that clone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const prepare = run("join-happy", ["setup", "prepare", "macos", "--json"], "", dir, INSTANT);
  await Bun.sleep(250);
  const busy = (await form(dir, "invite")).sections.invite!;
  expect(busy.map((r) => [r.id, r.state])).toEqual([["tool.clt", "busy"], ["forge.token", "todo"]]);
  expect((await prepare).lines[0]).toMatchObject({ stage: "macos", installed: ["apple-clt"] });
  expect((await form(dir, "invite")).sections.invite!.map((r) => r.id)).toEqual(["forge.token"]);
});

test("the slow scenario's installs take several waits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const proc = Bun.spawn(["bun", STUB, "setup", "prepare", "accounts", "--json"], {
    env: { ...process.env, RT_STUB_SCENARIO: "slow", RT_STUB_STATE_DIR: dir, ...INSTANT }, stdout: "pipe",
  });
  try {
    await Bun.sleep(400);
    const until = Number(readFileSync(join(dir, "prepare-accounts-until"), "utf8"));
    expect(until - Date.now()).toBeGreaterThan(3000);
    const claude = (await form(dir, "connect", "slow")).sections.connect!.find((r) => r.id === "claude")!;
    expect(claude).toMatchObject({ state: "busy", detail: "Installing…" });
  } finally {
    proc.kill();
  }
});

test("an instant run reports progress inside its long steps", async () => {
  const res = await run("join-happy", ["setup", "apply", "--from", "plugins.install", "--json"], "", undefined, INSTANT);
  const progress = res.lines.filter((l) => l.event === "progress");
  expect(progress.length).toBeGreaterThan(0);
  expect(progress.every((p) => p.id === "plugins.install" && p.percent > 0 && p.percent < 100)).toBe(true);
  expect(res.lines.at(-1)).toEqual({ event: "done", ok: true, failedStep: null });
});

test("the run's own proxy step asks for no admin password once P1 installed it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const allow = await run("join-happy", ["setup", "apply", "--only", "proxy.install", "--json"], "", dir);
  expect(allow.lines.filter((l) => l.event === "need").map((l) => l.request.type)).toEqual(["app-privileged"]);
  const full = await run("join-happy", ["setup", "apply", "--resume", "--unattended", "--json"], "", dir);
  expect(full.lines.filter((l) => l.event === "need").map((l) => l.request.type)).toEqual(["app-register-services"]);
});

test("apply --resume streams phases and ends ok", async () => {
  const res = await run("join-happy", ["setup", "apply", "--resume", "--unattended", "--json"]);
  const plan = res.lines[0];
  expect(plan.event).toBe("plan");
  for (const step of plan.steps) {
    expect(typeof step.phase).toBe("string");
    expect(step.weight).toBeGreaterThan(0);
    expect(step.paused).toStartWith("Couldn't ");
  }
  expect(plan.steps.find((s: { id: string }) => s.id === "repos.clone")).toMatchObject({ phase: expect.any(String), weight: 10, paused: "Couldn't clone your repos" });
  expect(res.lines.at(-1)).toEqual({ event: "done", ok: true, failedStep: null });
});

test("prepare answers what it installed", async () => {
  const macos = await run("join-happy", ["setup", "prepare", "macos", "--json"]);
  expect(macos.code).toBe(0);
  expect(macos.lines[0]).toMatchObject({ contract: 1, stage: "macos", installed: ["apple-clt"], failed: [] });
  const accounts = await run("join-happy", ["setup", "prepare", "accounts", "--json"]);
  expect(accounts.lines[0]).toMatchObject({ stage: "accounts", installed: ["claude", "herdr"], failed: [] });
  const bad = await run("join-happy", ["setup", "prepare", "later", "--json"]);
  expect(bad.code).toBe(2);
  expect(bad.lines[0].error.code).toBe("bad-stage");
});

test("setup claude connect answers needs-you, then ready", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const first = await run("join-happy", ["setup", "claude", "connect", "--json"], "", dir);
  expect(first.lines[0]).toMatchObject({ integration: "claude", status: "needs-you", detail: "Finish signing in in your browser" });
  const second = await run("join-happy", ["setup", "claude", "connect", "--json"], "", dir);
  expect(second.lines[0]).toMatchObject({ integration: "claude", status: "ready" });
});

test("setup <integration> connect takes the integration's own field, so Linear's API key connects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const linear = await run("join-happy", ["setup", "linear", "connect", "--json"], JSON.stringify({ apiKey: "lin_api_x" }), dir);
  expect(linear.lines[0]).toMatchObject({ integration: "linear", status: "ready" });
  const sdm = await run("join-happy", ["setup", "sdm", "connect", "--json"], JSON.stringify({ email: "janedoe@acme.dev" }), dir);
  expect(sdm.lines[0]).toMatchObject({ integration: "sdm", status: "ready" });
  const blank = await run("join-happy", ["setup", "linear", "connect", "--json"], JSON.stringify({ apiKey: "  " }), dir);
  expect(blank.lines[0].error.code).toBe("no-token");
});

test("stub grant --probe answers without granting anything, so the app can tell an older stub before a drive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const probe = await run("join-happy", ["stub", "grant", "--probe", "--json"], "", dir);
  expect(probe.code).toBe(0);
  expect(probe.lines[0]).toMatchObject({ contract: 1, ok: true, probe: true });
  expect(readdirSync(dir)).toEqual([]);
});

test("with a speed set, Fast Browser lands on time alone, however few reads came before", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const row = async () => (await run("join-happy", ["setup", "form", "--section", "connect", "--json"], "", dir, INSTANT)).lines[0]
    .sections.connect.find((r: { id: string }) => r.id === "fast-browser");
  await run("join-happy", ["stub", "opened", "https://chromewebstore.google.com/detail/fnfikoifhimpdedpdepehibjjkcfbacm", "--json"], "", dir, INSTANT);
  expect((await row()).state).toBe("todo");
  await Bun.sleep(1600);
  expect((await row()).state).toBe("done");
});

test("an instant run's bar tracks the clock, so the app's time-left estimate reads the drive's pace", async () => {
  const proc = Bun.spawn(["bun", STUB, "setup", "apply", "--resume", "--unattended", "--json"], {
    env: { ...process.env, RT_STUB_SCENARIO: "join-happy", RT_STUB_STATE_DIR: mkdtempSync(join(tmpdir(), "stub-")), ...INSTANT }, stdout: "pipe",
  });
  const timed: { at: number; event: Record<string, unknown> }[] = [];
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of proc.stdout) {
    buffered += decoder.decode(chunk);
    const lines = buffered.split("\n");
    buffered = lines.pop()!;
    for (const l of lines.filter(Boolean)) timed.push({ at: performance.now(), event: JSON.parse(l) });
  }
  await proc.exited;
  // The same arithmetic as RunProgress.bar: finished steps count their weight, a running step its share.
  const steps = (timed[0]!.event.steps as { id: string; weight: number }[]).map((s) => ({ ...s, state: "pending", percent: 0 }));
  const total = steps.reduce((sum, s) => sum + s.weight, 0);
  const start = timed[0]!.at, end = timed.at(-1)!.at;
  let worst = 0;
  for (const { at, event } of timed.slice(1)) {
    const step = steps.find((s) => s.id === event.id);
    if (step && event.event === "step") { step.state = event.state as string; step.percent = 0; }
    if (step && event.event === "progress") step.percent = event.percent as number;
    if (event.event !== "progress") continue;
    const done = steps.reduce((sum, s) => sum + (s.state === "done" ? s.weight : s.state === "running" ? (s.weight * s.percent) / 100 : 0), 0);
    worst = Math.max(worst, Math.abs(done / total - (at - start) / (end - start)));
  }
  expect(timed.filter((t) => t.event.event === "progress").length).toBeGreaterThan(5);
  expect(worst).toBeLessThan(0.15);
}, 20000);

test("github sign-in: the remote row walks sign in, code, then a staged create", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const remoteOf = async () => (await form(dir, "this-mac")).sections.thisMac!.find((r) => r.id === "settings.remote")!;
  await run("join-happy", ["setup", "home-backup", "remote", "--json"], "", dir);
  const todo = await remoteOf();
  expect(todo).toMatchObject({ state: "todo", subtext: "Opens your browser once. rt then makes a private repo for you" });
  expect(todo.action).toEqual({ type: "run", label: "Sign in to GitHub", verb: ["setup", "github", "sign-in"] });
  const started = await run("join-happy", ["setup", "github", "sign-in", "--json"], "", dir);
  expect(started.lines[0]).toMatchObject({ integration: "github", status: "needs-you", userCode: "WDGT-4271", url: "https://github.com/login/device" });
  const waiting = await remoteOf();
  expect(waiting).toMatchObject({ state: "waiting", detail: "Your code is WDGT-4271. Confirm it in your browser", watch: true });
  expect(waiting.action).toEqual({ type: "open-url", label: "Open again", url: "https://github.com/login/device" });
  await remoteOf();
  const done = await remoteOf();
  expect(done).toMatchObject({ state: "done", detail: "rt creates it as a private repo when setup runs", action: null });
  const again = await run("join-happy", ["setup", "home-backup", "remote", "--json"], "", dir);
  expect(again.lines[0].homeBackup).toEqual({ mode: "remote", create: true });
});

test("github sign-in: picking local clears the sign-in, so a later remote pick starts over", async () => {
  const changed = mkdtempSync(join(tmpdir(), "stub-"));
  const restartedRemote = async () => (await form(changed, "this-mac")).sections.thisMac!.find((r) => r.id === "settings.remote")!;
  await run("join-happy", ["setup", "home-backup", "remote", "--json"], "", changed);
  await run("join-happy", ["setup", "github", "sign-in", "--json"], "", changed);
  expect(await restartedRemote()).toMatchObject({ state: "waiting" });
  await run("join-happy", ["setup", "home-backup", "local", "--json"], "", changed);
  await run("join-happy", ["setup", "home-backup", "remote", "--json"], "", changed);
  expect(await restartedRemote()).toMatchObject({ state: "todo", action: { label: "Sign in to GitHub" } });
});

test("new-tool: tools holds through install and sign-in, and only --ack-tools moves it on", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const whole = async () => (await run("new-tool", ["setup", "form", "--json"], "", state)).lines[0];
  const section = async () => (await run("new-tool", ["setup", "form", "--section", "tools", "--json"], "", state)).lines[0];

  const first = await whole();
  expect(first.stage).toBe("tools");
  expect(first.sections.tools.map((r: { id: string }) => r.id)).toEqual(["tool.team.doppler"]);
  expect(first.sections.tools[0].action).toMatchObject({ type: "install", label: "Install", tool: "doppler" });
  expect(first.tools).toEqual({ heading: "One new tool for your team", allDone: false });

  expect((await run("new-tool", ["tools", "install", "doppler", "--json"], "", state)).code).toBe(0);
  const installed = await section();
  expect(installed.stage).toBe(null);
  expect(installed.sections.tools[0]).toMatchObject({ id: "tool.team.doppler", state: "todo", action: { label: "Sign in" } });

  await run("new-tool", ["setup", "doppler", "connect", "--json"], "", state);
  await section();
  await section();
  const signedIn = await section();
  expect(signedIn.sections.tools[0]).toMatchObject({ id: "tool.team.doppler", state: "done" });
  expect(signedIn.tools).toEqual({ heading: "You're all set", allDone: true });
  expect((await whole()).stage).toBe("tools");

  expect((await run("new-tool", ["setup", "form", "--ack-tools", "--json"], "", state)).lines[0].ok).toBe(true);
  const after = await whole();
  expect(after.stage).toBe("ready");
  expect(after.tools).toBeUndefined();
});

test("new-tool: a plain row carries no reason, whether missing or signed out", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const section = async () => (await run("new-tool", ["setup", "form", "--section", "tools", "--json"], "", state)).lines[0].sections.tools[0];
  expect(await section()).toMatchObject({ detail: "", waiting: "Installing…" });
  await run("new-tool", ["tools", "install", "doppler", "--json"], "", state);
  expect(await section()).toMatchObject({ state: "todo", detail: "", action: { label: "Sign in" } });
});

test("new-tool-failed: the row reads failed and Retry runs the same install", async () => {
  const state = mkdtempSync(join(tmpdir(), "stub-"));
  const section = async () => (await run("new-tool-failed", ["setup", "form", "--section", "tools", "--json"], "", state)).lines[0];
  const failed = await section();
  expect(failed.sections.tools[0]).toMatchObject({
    state: "todo", tone: "failed", detail: "The download failed", optional: false,
    action: { type: "install", label: "Retry", tool: "doppler" },
    secondary: { type: "steps", label: "Show steps…" },
  });
  expect(failed.tools.allDone).toBe(false);
  expect((await run("new-tool-failed", ["tools", "install", "doppler", "--json"], "", state)).code).toBe(0);
  expect((await section()).sections.tools[0]).toMatchObject({ state: "todo", action: { label: "Sign in" } });
});

test("a --section tools read in any other scenario is empty, and a whole read carries no tools", async () => {
  const empty = (await run("join-happy", ["setup", "form", "--section", "tools", "--json"])).lines[0];
  expect(empty.sections.tools).toEqual([]);
  expect(empty.tools).toEqual({ heading: "You're all set", allDone: true });
  const whole = (await run("join-happy", ["setup", "form", "--json"])).lines[0];
  expect(whole.sections.tools).toBeUndefined();
  expect(whole.tools).toBeUndefined();
});
