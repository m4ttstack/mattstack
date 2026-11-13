#!/usr/bin/env bun
// Stub rt for app tests: canned contract-v1 answers per RT_STUB_SCENARIO.
// State that must change between invocations (a permission granted, a step
// retried) lives in RT_STUB_STATE_DIR so every call is a fresh process like
// the real rt.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveClaudeBin } from "../../../lib/claude-bin.ts";
import { FALLBACK_WRITING_STYLE, isPresetId, isValidSkillId } from "../../../lib/skills/writing-style.ts";
import {
  listWritingStyles, parsePluginEntries, readSkillInventory, type SkillInventory,
} from "../../../lib/skills/writing-style-sources.ts";
import { writingStyleRow as buildWritingStyleRow } from "../../../lib/setup/validators/writing-style.ts";
import { AFTER_INSTALL_ROW } from "../../../lib/setup/plan.ts";
import { isFinishGatedRowId, WAIVABLE_ROW_IDS } from "../../../lib/setup/contract.ts";
import { WAIVED_NOTES } from "../../../lib/setup/finish-gate.ts";
import { CLAUDE_SIGNIN_ACTION, FAST_BROWSER_ADD_ACTION } from "../../../lib/setup/validators/tools.ts";
import { allAnswered, continueNote, FORM_COPY, FORM_SECTIONS, homeApp, macosRows, startButton, toolsForm, type FormPath, type FormRow, type FormSection, type FormStage, type SetupForm } from "../../../lib/setup/form.ts";
import type { Action, Row, StepId } from "../../../lib/setup/contract.ts";
import { FINISH_IN_BROWSER } from "../../../lib/setup/cli-login.ts";
import { FANCY_URLS_DETAIL } from "../../../lib/setup/fancy-urls.ts";
import { integrationDef } from "../../../lib/setup/integrations.ts";
import { drawPhaseWords, STEP_PHASES } from "../../../lib/setup/run-phases.ts";
import { PREPARE_STAGES } from "../../../lib/setup/prepare-record.ts";
import { TITLES, tokenCreateLink, tokenField } from "../../../lib/setup/token-create.ts";
import { PLACE_REPO_LABELS } from "../../../lib/setup/validators/repos.ts";
import { SLACK_APP_ACTION, SLACK_APP_MISSING, SOLO_GITHUB_NOTE, SOLO_GITLAB_NOTE } from "../../../lib/setup/validators/accounts.ts";

const scenario = process.env.RT_STUB_SCENARIO ?? "join-happy";
const stateDir = process.env.RT_STUB_STATE_DIR ?? join(import.meta.dir, ".state", scenario);
mkdirSync(stateDir, { recursive: true });
const at = new Date().toISOString();
const args = process.argv.slice(2).filter((a) => a !== "--json");

function stateGet(key: string, fallback = 0): number {
  const p = join(stateDir, key);
  return existsSync(p) ? Number(readFileSync(p, "utf8")) : fallback;
}
function stateBump(key: string): number {
  const n = stateGet(key) + 1;
  writeFileSync(join(stateDir, key), String(n));
  return n;
}
function stateSet(key: string, n: number): void { writeFileSync(join(stateDir, key), String(n)); }
function textGet(key: string): string | null {
  const p = join(stateDir, key);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}
function textSet(key: string, value: string): void { writeFileSync(join(stateDir, key), value); }

// RT_STUB_SPEED paces the waits a person sits through in Test drive setup.
// Unset, every wait is counted in reads alone, so the unit tests never sleep.
type Speed = "instant" | "realistic";
const PACE: Record<Speed, { wait: number; bar: number }> = { instant: { wait: 750, bar: 6_000 }, realistic: { wait: 4_000, bar: 60_000 } };
const speed = (Object.keys(PACE) as Speed[]).find((s) => s === process.env.RT_STUB_SPEED) ?? null;
const slow = scenario === "slow";
const NEW_TOOL = scenario === "new-tool" || scenario === "new-tool-failed";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function waitMs(units: number): number { return speed ? PACE[speed].wait * units : 0; }
function stampNow(key: string): void { if (!stateGet(key)) stateSet(key, Date.now()); }
function waited(key: string, units: number): boolean {
  const since = stateGet(key);
  return waitMs(units) === 0 || (since > 0 && Date.now() - since >= waitMs(units));
}
function emit(obj: unknown) { process.stdout.write(JSON.stringify({ contract: 1, at, ...(obj as object) }) + "\n"); }
function fail(code: string, message: string): never { emit({ error: { code, message } }); process.exit(2); }
async function readStdinJSON(): Promise<Record<string, unknown>> {
  const text = await new Response(Bun.stdin.stream()).text();
  try { return text.trim() ? JSON.parse(text) : {}; } catch { return {}; }
}

const row = (id: string, kind: string, title: string, why: string, required: boolean, status: string,
             detail: string | null, action: unknown, recheck = "on-change", optionalNote: string | null = null) =>
  ({ id, kind, title, why, required, optionalNote, status, detail, action, recheck });

const FAST_BROWSER_STEPS = [
  "Install Fast Browser from the [Chrome Web Store](https://chromewebstore.google.com/detail/fnfikoifhimpdedpdepehibjjkcfbacm)",
];

// The finish-gate scenario: the extension row, which Finish waits on and no
// one can skip, already loaded so Finish can open; and the Mission Control
// row, which can be skipped, rendered the way rt renders it before and after
// `setup waive`.
const EXTENSION_ID = "tool.fast-browser-extension";
function extensionRow() {
  return {
    ...row(EXTENSION_ID, "tool", "Fast Browser extension", "Fast Browser drives your real Chrome session through this extension.", false,
           "ready", "Loaded and paired", FAST_BROWSER_ADD_ACTION, "on-activate"),
    finishGated: true,
    waivable: false,
    waived: false,
  };
}
const MISSION_CONTROL_ID = "tool.mission-control";
function missionControlRow() {
  const waived = stateGet("waived") > 0;
  return {
    ...row(MISSION_CONTROL_ID, "tool", "Mission Control shortcut", "rt's nav picker uses Control+Up, which macOS binds to Mission Control by default.", false,
           "needs-you", "Control+Up opens Mission Control, and rt's picker needs it",
           { type: "open-settings", label: "Open Keyboard Settings…", target: "keyboard-shortcuts" },
           "on-activate", waived ? WAIVED_NOTES[MISSION_CONTROL_ID]! : "Works without this; only matters if Control+Up doesn't reach rt's nav picker."),
    finishGated: true,
    waivable: true,
    waived,
  };
}

// The writing-style scenario: a finish-gated row that cannot be waived,
// rendered the way rt renders it before and after `skills writing-style use`.
const WRITING_STYLE_ID = "skills.writing-style";
const WRITING_STYLE_PRESETS = [
  { id: "mattstack:writing-style-sparse", label: "Sparse",
    detail: "Terse, lowercase for technical points, one tight paragraph per finding.",
    sample: "**issue:** cache is keyed on userId alone, so two tenants share an entry. key on (tenant, id)?" },
  { id: "mattstack:writing-style-conversational", label: "Conversational",
    detail: "Short, friendly sentences in sentence case, like talking to a teammate.",
    sample: "**issue:** The cache is keyed on userId alone, so two tenants can share an entry. Could we key on both?" },
  { id: "mattstack:writing-style-structured", label: "Structured",
    detail: "Labelled lines and short bullets for teams that like formal write-ups.",
    sample: "**issue:** Settings leak across tenants. Why: the cache key omits the tenant. Suggestion: key on (tenant, id)." },
];
// Not part of the choose action's own options list; carried only so the
// ready-detail label lookup below can resolve a suggestion id to a label.
const WRITING_STYLE_OPTION_ROWS = [
  { id: "team-voice", label: "team-voice", detail: "Your own style, in your home repo" },
  { id: "acme:team-writing-style", label: "acme:team-writing-style", detail: "An installed skill" },
];
const WRITING_STYLE_SUGGESTIONS = [
  "acme:review-voice", "acme:team-writing-style", "superpowers:brainstorming", "superpowers:writing-plans", "team-voice", "team:team-writing-style",
];
const CHOOSE_SUBTITLE = "The voice agents use for reviews, replies and PR descriptions posted under your name.";
const CHOOSE_FOOTNOTE = "You can also choose from a terminal: rt skills writing-style use";
const INSTALLED_STYLES = [...WRITING_STYLE_PRESETS.map((p) => p.id), ...WRITING_STYLE_SUGGESTIONS];
// RT_STUB_REAL_WRITING_STYLE=1 judges the picker against the operator's own
// skills, read through the same code the app ships with, and never writes
// there: the resolved style stays stub state, and no linkPersonalSkills or
// setSetting call ever runs against realHome.
const REAL_WRITING_STYLE = scenario === "writing-style" && process.env.RT_STUB_REAL_WRITING_STYLE === "1";

// No fallback: Bun's os.userInfo().homedir honors HOME, and the app runs the
// stub under a throwaway HOME, so a default here would silently read that
// throwaway home instead of the operator's real one.
function realHome(): string {
  const home = process.env.RT_STUB_REAL_HOME;
  if (!home || !existsSync(home) || !statSync(home).isDirectory()) {
    fail("no-real-home", "RT_STUB_REAL_HOME must be set to an existing directory in real-data mode");
  }
  return home;
}

// A failed or missing claude binary reads as "no plugins", not an error: the
// inventory still carries ~/.claude/skills and personal skills.
function realInventory(): SkillInventory {
  const home = realHome();
  const bin = process.env.RT_STUB_CLAUDE_BIN ?? resolveClaudeBin() ?? "claude";
  let plugins = null;
  try {
    const res = Bun.spawnSync([bin, "plugin", "list", "--json"], { env: { ...process.env, HOME: home } });
    if (res.exitCode === 0) plugins = parsePluginEntries(res.stdout.toString());
  } catch {
    plugins = null;
  }
  return readSkillInventory(home, plugins);
}

function realWritingStyleRow() {
  const inventory = realInventory();
  const chosen = stateGet("style") > 0;
  const idPath = join(stateDir, "style-id");
  const styleId = chosen && existsSync(idPath) ? readFileSync(idPath, "utf8") : undefined;
  const resolved = styleId ? { skill: styleId, source: "user" as const } : { skill: FALLBACK_WRITING_STYLE, source: "fallback" as const };
  // Real rt's `use` links a chosen personal skill into ~/.claude/skills before
  // returning; this mode never writes to realHome, so a stub-chosen personal
  // name is instead added to the in-memory installed set, matching what the
  // real pipeline would show without ever linking anything on disk.
  if (styleId && inventory.personal.some((p) => p.name === styleId)) inventory.installed.add(styleId);
  const options = listWritingStyles(inventory, resolved).options;
  return { ...buildWritingStyleRow({ homeReady: true, resolved, inventory, options }), waivable: false };
}

function writingStyleRow() {
  const chosen = stateGet("style") > 0;
  const idPath = join(stateDir, "style-id");
  const selected = chosen ? (existsSync(idPath) ? readFileSync(idPath, "utf8") : WRITING_STYLE_PRESETS[0]!.id) : undefined;
  const lookup = [...WRITING_STYLE_PRESETS, ...WRITING_STYLE_OPTION_ROWS];
  const label = lookup.find((o) => o.id === selected)?.label ?? selected;
  return {
    ...row(WRITING_STYLE_ID, "tool", "Writing style",
           "How the reviews, replies and PR descriptions agents post under your name read. Without one they read like an AI assistant.", false,
           chosen ? "ready" : "needs-you",
           chosen ? `${label} (yours)` : "Not chosen yet",
           { type: "choose", label: "Choose style…", verb: ["skills", "writing-style", "use"],
             subtitle: CHOOSE_SUBTITLE, footnote: CHOOSE_FOOTNOTE, options: WRITING_STYLE_PRESETS,
             ...(selected ? { selected } : {}),
             other: { label: "Use my own skill…", hint: "Any installed skill id. Start one with rt skills writing-style new.", suggestions: WRITING_STYLE_SUGGESTIONS } }),
    finishGated: true,
    waivable: false,
  };
}

// The join-team-accounts scenario: before Install a joiner's plan cannot see
// the team's accounts yet; after it, Slack blocks Finish the way rt gates it.
function slackRow() {
  return {
    ...row("account.slack", "account", "Slack", "Lets the board post review requests and read the marks your team leaves on them.", true,
           "missing", "No Slack account connected yet. If Slack rejects the redirect, add http://localhost:11234/callback in the app's OAuth settings",
           { type: "oauth", label: "Connect", integration: "slack", verb: ["setup", "slack", "connect"] }),
    finishGated: true,
    waivable: false,
  };
}

function plan(): unknown {
  const fdaCalls = stateBump("plan-calls");
  const fdaGranted = scenario !== "perm-denied-then-granted" || fdaCalls >= 3;
  const mode = scenario === "create-happy" ? "create" : scenario === "restore" ? "restore" : "join";
  const mac = [
    row("perm.fda", "permission", "Full Disk Access",
        "Reads your repositories' git state so the daemon can show branch and MR status.", true,
        fdaGranted ? "ready" : "needs-you", fdaGranted ? "Granted" : "Not granted",
        fdaGranted ? null : { type: "open-settings", label: "Open Full Disk Access Settings…", target: "fda" }, "on-activate"),
    row("perm.login-items", "permission", "Background services",
        "rt daemon and deck run in the background as login items.", true, "ready", "Enabled", null, "on-activate"),
    row("perm.notifications", "permission", "Notifications", "Pipeline and review alerts.", false, "skipped", "Not decided",
        { type: "request-permission", label: "Allow", which: "notifications" }, "on-activate",
        "Works without this; you'll see menu-bar badges instead."),
    row("tool.clt", "tool", "Apple command line tools", "git and python3 come from here.", true, "ready", "git 2.50.1", null),
    row("tool.path", "info", "~/.local/bin first on PATH", "Install adds one PATH line to your shell rc.", true, "ready", "Fixed by Install", null),
  ];
  const accounts = [
    row("account.gitlab", "account", "GitLab", "The team's merge requests live on gitlab.example.com.", true,
        stateGet("gitlab-connected") ? "ready" : "missing", stateGet("gitlab-connected") ? "token can see group acme" : null,
        { type: "connect", label: "Connect", integration: "gitlab",
          fields: [{ name: "token", label: "Personal access token", secret: true, hint: "api" }],
          alternatives: [],
          create: { label: "Create a token on GitLab…", url: "https://gitlab.example.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api" } }),
  ];
  if (scenario === "solo") {
    const soloForge = (forge: "github" | "gitlab", note: string) =>
      connected(forge)
        ? row(`account.${forge}`, "account", TITLES[forge], integrationDef(forge).why(null), false, "ready", "Connected as janedoe", null, undefined, note)
        : row(`account.${forge}`, "account", TITLES[forge], integrationDef(forge).why(null), false, "missing", null,
            { type: "connect", label: "Connect", integration: forge, fields: [tokenField(forge, "member")], alternatives: [] },
            undefined, note);
    accounts.splice(0, accounts.length,
      soloForge("github", SOLO_GITHUB_NOTE),
      soloForge("gitlab", SOLO_GITLAB_NOTE));
  }
  const access = scenario === "solo" ? [] :
    [row("access.team-repo", "access", "Team repo reachable", "github.com/acme/mattstack-team-acme", true, "ready", "ls-remote ok", null)];
  const tools = [
    row("tool.herdr", "tool", "herdr", "Runs the agents that do the work.", true, "ready", "0.9.2", null),
    row("tool.fast-browser", "tool", "Fast Browser", "Browser automation for evidence.", true, "needs-you", "extension not loaded",
        { type: "steps", label: "Show steps…", steps: FAST_BROWSER_STEPS }),
    row("tool.chrome", "tool", "Google Chrome", "Evidence capture.", false, "skipped", null,
        { type: "open-url", label: "Download", url: "https://www.google.com/chrome/" }, "manual", "Works without this."),
  ];
  if (scenario === "solo") {
    tools[1]!.required = false;
    tools[1]!.optionalNote = "Works without this; only the browser skills need it.";
  }
  // Scenarios other than perm-denied-then-granted are installable out of the box so
  // flows can reach Install without connecting anything; perm-denied-then-granted
  // gates only on perm.fda so the second plan() call can flip canInstall to true.
  const installableScenario = ["join-happy", "create-happy", "apply-fail-retry", "clone-partial", "restore", "uninstall", "perm-denied-then-granted", "finish-gate", "writing-style", "join-team-accounts"].includes(scenario);
  // accounts[0] and tools[1] are the fixed literal elements built above — non-null
  // is safe, not a runtime guess.
  if (installableScenario) { accounts[0]!.status = "ready"; accounts[0]!.detail = "token can see group acme"; tools[1]!.status = "ready"; tools[1]!.detail = "extension loaded"; }
  const gated: { id: string; status: string; waived?: boolean }[] =
    scenario === "finish-gate" ? [extensionRow(), missionControlRow()]
    : scenario === "writing-style" ? [REAL_WRITING_STYLE ? realWritingStyleRow() : writingStyleRow()]
    : [];
  if (scenario === "join-team-accounts") {
    if (stateGet("applied")) {
      accounts.push(slackRow());
    } else {
      accounts.push(AFTER_INSTALL_ROW);
    }
  }
  const requiredMissing = [...mac, ...accounts, ...access, ...tools].filter((r) => r.required && r.status !== "ready").map((r) => r.id);
  const finishBlockedBy = [...accounts, ...gated].filter((r) => "finishGated" in r && r.status !== "ready" && !(r as { waived?: boolean }).waived).map((r) => r.id);
  return {
    team: scenario === "solo" ? { slug: "", name: "", mode: "none" } : { slug: "acme", name: "Acme", mode },
    groups: [
      { id: "mac", title: "Your Mac", rows: mac },
      { id: "accounts", title: "Accounts", rows: accounts },
      { id: "access", title: "Access", rows: access },
      { id: "tools", title: "Tools", rows: [...tools, ...gated] },
    ],
    canInstall: requiredMissing.length === 0,
    requiredMissing,
    finishBlockedBy,
  };
}

// scenario "restore" uses the contract's home.restore step id in place of home.init.
const STEPS = [
  scenario === "restore" ? ["home.restore", "Restore your settings home repo", "rt"] : ["home.init", "Create your settings home repo", "rt"],
  ["team.join", "Join the team", "rt"],
  ["secrets.write", "Store the tokens you entered", "rt"], ["path.link", "Link rt, fast-browser, gitq, deck into ~/.local/bin", "rt"],
  ["settings.seed", "Write machine settings", "rt"], ["repos.clone", "Clone the team's repositories", "rt"],
  ["services.register", "Register the rt daemon and deck", "app"], ["proxy.install", "Install the local HTTPS proxy", "privileged"],
  ["board.cwds", "Point the board at widgets", "rt"],
  ["plugins.install", "Install the mattstack skills into Claude Code", "rt"], ["services.start", "Start services", "rt"],
  ["board.restart", "Restart the board", "rt"],
  ["verify", "Verify everything", "rt"],
  ["apps.restart", "Restart your apps", "rt"],
] as const;

// The contract's v1 uninstall action ids, in order; `data` only with
// --delete-data. The dry-run lists them and the real run streams the same set,
// so the app's confirmation sheet and its progress list can never disagree.
function uninstallActions(): { id: string; title: string; kind: "rt" | "app" | "privileged" }[] {
  return [
    { id: "deck.managed-remove", title: "Remove mattstack's apps from deck", kind: "rt" },
    { id: "services.unregister", title: "Stop and remove the rt daemon and deck services", kind: "app" },
    { id: "proxy.remove", title: "Remove the local HTTPS proxy (admin prompt)", kind: "privileged" },
    { id: "path.unlink", title: "Remove ~/.local/bin links", kind: "rt" },
    { id: "shell.remove", title: "Remove the shell rc block", kind: "rt" },
    { id: "extension.uninstall", title: "Uninstall rt's editor extensions", kind: "rt" },
    { id: "plugins.uninstall", title: "Uninstall the mattstack plugins from Claude Code", kind: "rt" },
    ...(args.includes("--delete-data") ? [{ id: "data", title: "Delete ~/.mattstack (settings, state, logs)", kind: "rt" as const }] : []),
    { id: "app.trash", title: "Move mattstack.app to the Trash", kind: "rt" },
  ];
}

async function apply() {
  const fromIdx = Math.max(0, args.indexOf("--from"));
  const fromId = fromIdx > 0 ? args[fromIdx + 1] : null;
  const start = fromId ? STEPS.findIndex((s) => s[0] === fromId) : 0;
  const onlyIdx = args.indexOf("--only");
  const onlyId = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  const steps = onlyId ? STEPS.filter((s) => s[0] === onlyId) : STEPS.slice(start < 0 ? 0 : start);
  const line = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
  // An --only run is a row's own fix, never the run the bar follows.
  const holdsRun = !onlyId;
  // P1's Allow already installed the proxy, so the run's own step asks for no admin password.
  const asksAdmin = onlyId === "proxy.install" || stateGet("proxy-installed") === 0;
  if (onlyId === "proxy.install") stateSet("proxy-installed", 1);
  if (onlyId === "team.join") { stateSet("team-joined", 1); stampNow("team-joined-at"); }
  if (holdsRun) stateSet("run-live", 1);
  const words = drawPhaseWords(steps.length);
  line({ event: "plan", steps: steps.map(([id, title, kind], i) => ({ id, title, kind, phase: words[i]!, ...STEP_PHASES[id as StepId] })) });
  const weightOf = (id: string) => STEP_PHASES[id as StepId]?.weight ?? 1;
  const totalWeight = STEPS.reduce((sum, [id]) => sum + weightOf(id), 0);
  const stepMs = (id: string) => speed && holdsRun ? (PACE[speed].bar * (slow ? 2.5 : 1) * weightOf(id)) / totalWeight : speed ? waitMs(1) : 120;
  for (const [id, , kind] of steps) {
    line({ event: "step", id, state: "running" });
    const log = `${id}: working…`;
    if (kind === "app") {
      line({ event: "need", id, request: { type: "app-register-services", plists: ["com.mattstack.daemon.plist", "com.mattstack.deck.plist"] } });
    } else if (kind === "privileged" && asksAdmin) {
      line({ event: "need", id, request: { type: "app-privileged", op: "proxy-install" } });
    } else {
      line({ event: "log", id, line: log });
    }
    await working(id, stepMs(id), line);
    if (scenario === "apply-fail-retry" && id === "plugins.install" && stateBump("plugins-attempts") === 1) {
      const failed = { step: id, detail: "claude plugin install exited 1", remedy: "Open Claude Code once so it finishes first-run, then Retry.", log: [log] };
      line({ event: "step", id, state: "failed", detail: failed.detail, remedy: failed.remedy });
      if (holdsRun) endRun(failed);
      line({ event: "done", ok: false, failedStep: id });
      return;
    }
    // clone-partial: the first repos.clone leaves one repo uncloned; the retry lands it.
    if (scenario === "clone-partial" && id === "repos.clone" && stateBump("clone-attempts") === 1) {
      line({ event: "log", id, line: "acme-dev: clone failed: timed out after 60 minutes" });
      line({ event: "step", id, state: "partial", detail: "cloned 1, present 0, failed 1 (acme-dev)",
             remedy: "The step log says why. Retry this step once that is fixed (rt setup apply --from repos.clone). If you already have a clone, run rt repos register <path> first and rt uses it instead of cloning again." });
      continue;
    }
    line({ event: "step", id, state: "done", detail: kind === "rt" ? "ok" : "done by the app" });
  }
  stateSet("applied", 1);
  if (holdsRun) endRun(null);
  line({ event: "done", ok: true, failedStep: null });
}

/** Every step longer than a tick reports its percent as it goes, so the bar's fraction tracks the clock and
 *  the app's time-left estimate, which extrapolates from it, reads the drive's own pace. */
async function working(id: string, ms: number, line: (o: unknown) => void): Promise<void> {
  const tick = 500;
  if (ms <= tick) return sleep(ms);
  const label = id === "repos.clone" ? "Receiving objects" : "Working";
  for (let done = 0; done < ms; done += tick) {
    await sleep(Math.min(tick, ms - done));
    line({ event: "progress", id, label, percent: Math.min(99, Math.round(((done + tick) / ms) * 100)) });
  }
}

type RunFailure = { step: string; detail: string; remedy: string; log: string[] };
const RUN_FAILED = "run-failed.json";

function endRun(failed: RunFailure | null): void {
  stateSet("run-live", 0);
  stateSet("run-ok", failed ? 0 : 1);
  writeFileSync(join(stateDir, RUN_FAILED), JSON.stringify(failed));
}

function runFailure(): RunFailure | null {
  const p = join(stateDir, RUN_FAILED);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

// The join scenarios wait on the admin, so the fast-setup walk passes through
// P4: approved from the second check, or with a speed set once its wait has
// passed. Every other joiner is approved at once. The status keys on this
// Mac's own join, so any card works in any scenario.
const WAITING_JOINS = ["join", "join-happy", "slow"];
const INVITER = "Jane Doe";
function joinStatus(): unknown {
  if (stateGet("team-joined") === 0) fail("no-join", "This Mac has not joined a team");
  const calls = stateBump("join-status-calls");
  const approved = !WAITING_JOINS.includes(scenario) || stateGet("join-approved") > 0 || (speed ? waited("team-joined-at", 2) : calls > 1);
  if (approved) stateSet("join-approved", 1);
  return {
    team: { slug: "acme", name: "Acme" },
    state: approved ? "approved" : "waiting",
    since: approved ? null : at,
    uses: { repos: 2, accounts: 2, packs: 1 },
    pull: { outcome: "pulled", detail: "Pulled the team's settings" },
  };
}

// Fast setup: `setup form` walks the scenario off the verbs the app has
// already run, which each leave a mark in the state dir.
const PATHS: readonly FormPath[] = ["join", "create", "solo", "restore"];
function choosePath(path: FormPath): void {
  for (const p of PATHS) stateSet(`path-${p}`, p === path ? 1 : 0);
}
function chosenPath(): FormPath | null {
  return PATHS.find((p) => stateGet(`path-${p}`) > 0) ?? null;
}

const formRow = (r: Omit<FormRow, "waiting" | "watch" | "optional"> & Partial<Pick<FormRow, "waiting" | "watch" | "optional">>): FormRow =>
  ({ waiting: null, watch: false, optional: false, ...r });
const TOKEN_SUBTEXT = FORM_COPY.invite.tokenSubtext("github");
type Forge = "github" | "gitlab";

/** The app answers these two outside rt: `stub grant` is the person back from System Settings or a macOS prompt. */
function macosSection(): FormRow[] {
  const granted = scenario === "perm-denied-then-granted" ? stateBump("plan-calls") >= 3 : stateGet("granted-fda") > 0;
  const fda = { id: "perm.fda", status: granted ? "ready" : "needs-you", detail: granted ? "Granted" : "Not granted" } as Row;
  const fancy = stateGet("proxy-installed") > 0;
  return macosRows({
    permissions: [fda],
    notifications: stateGet("granted-notifications") > 0 ? "authorized" : "notDetermined",
    fancyUrls: { state: fancy ? "done" : "todo", detail: fancy ? FANCY_URLS_DETAIL.done : FANCY_URLS_DETAIL.noProxy },
  });
}

/** Each prepare stage runs for the scenario's install time; its rows read busy until it ends. */
function prepareMs(): number { return waitMs(slow ? 6 : 1); }
function preparing(stage: string): boolean { return Date.now() < stateGet(`prepare-${stage}-until`); }

/** Git leads the screens that clone, and only while the macos stage is still installing it. */
function cltRows(): FormRow[] {
  if (!preparing("macos")) return [];
  const c = FORM_COPY.clt;
  return [formRow({ id: "tool.clt", title: c.title, subtext: c.subtext, state: "busy", detail: c.installing, action: null, watch: true })];
}

function connected(forge: string): boolean { return stateGet(`${forge}-connected`) > 0; }

/** A forge token row the way rt's forgeAccountRow draws it before and after the token lands. */
function forgeTokenRow(id: string, forge: Forge, role: "member" | "owner", subtext: string, done: string, optional = false): FormRow {
  const base = { id, title: TITLES[forge], subtext, optional };
  if (connected(forge)) return formRow({ ...base, state: "done", detail: done, action: null });
  return formRow({
    ...base,
    state: "todo",
    detail: `No ${TITLES[forge]} token yet`,
    action: { type: "connect", label: FORM_COPY.invite.connect, integration: forge, fields: [tokenField(forge, role)],
              create: { label: FORM_COPY.invite.createToken, url: tokenCreateLink(forge, role, null).url } },
  });
}

function inviteSection(): FormRow[] {
  return [...cltRows(), forgeTokenRow("forge.token", "github", "member", TOKEN_SUBTEXT, FORM_COPY.invite.connectedAs("janedoe"))];
}

function createSection(forge: Forge): FormRow[] {
  return [...cltRows(), forgeTokenRow("forge.token", forge, "owner", FORM_COPY.invite.tokenSubtext(forge), FORM_COPY.invite.connected)];
}

function createdForge(): Forge { return textGet("create-forge") === "github" ? "github" : "gitlab"; }

// `claude connect` answers needs-you and leaves the row waiting on the code
// Claude shows in the browser; `claude code` with that code signs it in.
function claudeRow(): FormRow {
  const c = FORM_COPY.connect.claude;
  const base = { id: "claude", title: c.title, subtext: c.subtext, watch: true };
  const calls = stateGet("claude-connect-calls");
  if (preparing("accounts")) return formRow({ ...base, state: "busy", detail: FORM_COPY.installing, action: null });
  if (stateGet("claude-signed-in") > 0 || calls >= 2) return formRow({ ...base, state: "done", detail: "Signed in as janedoe@example.com", action: null });
  if (calls === 1) {
    return formRow({ ...base, state: "waiting", detail: FINISH_IN_BROWSER,
                     action: { type: "form", label: c.pasteCode, verb: ["setup", "claude", "code"], fields: [{ name: "code", label: c.codeField, secret: true }] } });
  }
  return formRow({ ...base, state: "todo", detail: "Not signed in yet", action: CLAUDE_SIGNIN_ACTION });
}

const DOPPLER_CODE = "WIDGET-4271";
const DOPPLER_LOGIN = "https://dashboard.doppler.com/workplace/auth/cli";

/** The team's sign-in tool: its browser sign-in lands on its own after a while, the way doppler's does. */
/** A set speed lands it on time alone, as a person waits; unset, the third read lands it, so the tests never sleep. */
function landsAfter(readsKey: string, sinceKey: string, units: number): boolean {
  return speed ? waited(sinceKey, units) : stateBump(readsKey) > 2;
}

function dopplerSignedIn(): boolean {
  if (stateGet("doppler-signed-in") > 0) return true;
  if (!stateGet("doppler-login-at")) return false;
  const landed = landsAfter("doppler-reads", "doppler-login-at", 3);
  if (landed) stateSet("doppler-signed-in", 1);
  return landed;
}

function dopplerRow(): FormRow {
  const c = FORM_COPY.connect.teamTool;
  const base = { id: "signin.doppler", title: integrationDef("doppler").title, subtext: c.subtext, watch: true };
  if (dopplerSignedIn()) return formRow({ ...base, state: "done", detail: "Signed in to doppler", action: null });
  if (stateGet("doppler-login-at")) return formRow({ ...base, state: "waiting", detail: c.code(DOPPLER_CODE), action: { type: "open-url", label: c.openAgain, url: DOPPLER_LOGIN } });
  return formRow({ ...base, state: "todo", detail: "Not signed in to doppler", action: { type: "run", label: c.label, verb: ["setup", "doppler", "connect"] } });
}

/** The new-tool scenario's one row, through install and sign-in, as `toolsRows` draws a sign-in tool on a finished Mac. */
function newToolRows(): FormRow[] {
  if (!NEW_TOOL) return [];
  const c = FORM_COPY.connect.teamTool;
  const base = { id: "tool.team.doppler", title: integrationDef("doppler").title, subtext: c.subtext, watch: true };
  if (preparing("tool")) return [formRow({ ...base, state: "busy", detail: FORM_COPY.installing, action: null })];
  if (!stateGet("prepare-tool-until")) {
    const install: Action = { type: "install", label: "Install", tool: "doppler", via: "download" };
    if (scenario !== "new-tool-failed") return [formRow({ ...base, state: "todo", detail: "", action: install, waiting: FORM_COPY.installing })];
    const secondary: Action = { type: "steps", label: "Show steps…", steps: ["Download it from https://docs.doppler.com/docs/install-cli"] };
    return [formRow({ ...base, state: "todo", tone: "failed", detail: "The download failed", action: { ...install, label: FORM_COPY.tools.retry }, secondary, waiting: FORM_COPY.installing })];
  }
  const row = dopplerRow();
  return [{ ...row, id: base.id, detail: row.state === "todo" ? "" : row.detail }];
}

function linearRow(): FormRow {
  const c = FORM_COPY.connect.linear;
  const base = { id: "linear", title: c.title, subtext: c.subtext };
  if (connected("linear")) return formRow({ ...base, state: "done", detail: FORM_COPY.connect.connected, action: null });
  return formRow({ ...base, state: "todo", detail: "Not connected yet",
                   action: { type: "connect", label: FORM_COPY.invite.connect, integration: "linear", fields: integrationDef("linear").fields,
                             create: { label: c.label, url: "https://linear.app/settings/account/security" } } });
}

/** Opening the Web Store is the app's; the extension then lands a few reads later, as Chrome installs it. */
function fastBrowserAdded(): boolean {
  if (stateGet("fast-browser-added") > 0) return true;
  if (!stateGet("fast-browser-opened-at")) return false;
  const landed = landsAfter("fast-browser-reads", "fast-browser-opened-at", 2);
  if (landed) stateSet("fast-browser-added", 1);
  return landed;
}

function fastBrowserRow(optional: boolean): FormRow {
  const c = FORM_COPY.connect.fastBrowser;
  const base = { id: "fast-browser", title: c.title, subtext: c.subtext, watch: true, optional };
  if (fastBrowserAdded()) return formRow({ ...base, state: "done", detail: c.done, action: null });
  return formRow({ ...base, state: "todo", detail: "Not added yet", action: FAST_BROWSER_ADD_ACTION, waiting: c.waiting });
}

function connectSlackRow(forge: Forge, appReady: boolean): FormRow {
  const c = FORM_COPY.connect.slack;
  const base = { id: "slack", title: c.title, subtext: c.subtext(forge), waiting: c.waiting, watch: true };
  if (connected("slack")) return formRow({ ...base, state: "done", detail: FORM_COPY.connect.connected, action: null });
  if (!appReady) return formRow({ ...base, state: "todo", detail: "Waits for the team's Slack app", action: null, waiting: null, optional: true });
  return formRow({ ...base, state: "todo", detail: "Not connected yet", action: { type: "oauth", label: c.label, integration: "slack", verb: ["setup", "slack", "connect"] } });
}

function slackAppRow(): FormRow {
  const c = FORM_COPY.connect.slackApp;
  const base = { id: "slack-app", title: c.title, subtext: c.subtext };
  if (stateGet("slack-app-created") > 0) return formRow({ ...base, state: "done", detail: FORM_COPY.connect.connected, action: null });
  return formRow({ ...base, state: "todo", detail: SLACK_APP_MISSING, action: SLACK_APP_ACTION });
}

function connectSection(path: FormPath | null): FormRow[] {
  const c = FORM_COPY.connect;
  if (path === "solo") {
    const gitlab = forgeTokenRow("forge.gitlab", "gitlab", "member", c.soloGitlab, c.connected, true);
    return [
      forgeTokenRow("forge", "github", "member", c.soloForge, FORM_COPY.invite.connectedAs("janedoe"), true),
      gitlab.state === "done" ? gitlab : { ...gitlab, detail: c.soloGitlabHint },
      claudeRow(),
      { ...fastBrowserRow(true), subtext: c.soloFastBrowser },
    ];
  }
  if (path === "create") {
    const forge = createdForge();
    const app = stateGet("slack-app-created") > 0;
    return [
      formRow({ id: "forge", title: TITLES[forge], subtext: FORM_COPY.invite.tokenSubtext(forge), state: "done", detail: FORM_COPY.invite.connected, action: null }),
      slackAppRow(), connectSlackRow(forge, app), claudeRow(), fastBrowserRow(false),
    ];
  }
  return [
    formRow({ id: "forge", title: "GitHub", subtext: TOKEN_SUBTEXT, state: "done", detail: c.connectedFromInvite("janedoe"), action: null }),
    connectSlackRow("github", true), claudeRow(), dopplerRow(), linearRow(), fastBrowserRow(false),
  ];
}

// Paths the screens show; the member's own pick from a folder panel shows as picked.
const SHOWN_HOME = "/Users/janedoe";
const BOARD_REPO = "github.com/acme/widgets";
function tildify(path: string): string { return path.startsWith(`${SHOWN_HOME}/`) ? `~${path.slice(SHOWN_HOME.length)}` : path; }

type Placement = { mode: "checkout" | "clone"; path: string };
function placement(): Placement | null {
  const raw = textGet("repo-placement");
  return raw ? (JSON.parse(raw) as Placement) : null;
}

/** A new Mac's repo row waits on a pick, as rt's deferred placement does; a recorded pick is done and lands at the run. */
function repoRow(): FormRow {
  const c = FORM_COPY.thisMac.repos;
  const recorded = placement();
  const clonePath = recorded?.mode === "clone" ? recorded.path : `${SHOWN_HOME}/Documents/GitHub/widgets`;
  const note = recorded
    ? recorded.mode === "clone" ? `rt clones it to ${tildify(recorded.path)} next` : `rt uses your checkout at ${tildify(recorded.path)} next`
    : "Choose where your repos go";
  const action: Action = {
    type: "place-repo",
    label: recorded?.mode === "checkout" ? PLACE_REPO_LABELS.checkout : PLACE_REPO_LABELS.clone,
    labels: PLACE_REPO_LABELS,
    identity: BOARD_REPO,
    repo: "widgets",
    mode: recorded?.mode ?? "clone",
    checkoutPath: recorded?.mode === "checkout" ? recorded.path : null,
    clonePath,
    note,
    problem: null,
    then: null,
    oneClick: recorded ? null : { label: "Clone here", mode: "clone", path: clonePath },
    segmentRecords: true,
    board: c.board,
    awaitsRun: recorded !== null,
    answered: recorded !== null,
  };
  return formRow({ id: `repos.place:${BOARD_REPO}`, title: "widgets", subtext: c.board, state: recorded ? "done" : "todo", detail: note, action });
}

function repoRootRow(): FormRow {
  const c = FORM_COPY.thisMac.repos;
  // Like rt, the found folder is the answer until one is picked.
  const chosen = textGet("repo-root") ?? `${SHOWN_HOME}/Documents/GitHub`;
  return formRow({ id: "repos.root", title: c.title, subtext: c.root, state: "done", detail: chosen,
                   action: { type: "choose-folder", label: c.change, startAt: chosen } });
}

type Backup = { mode: "local" } | { mode: "remote"; url?: string; create?: boolean };
function backup(): Backup | null {
  const raw = textGet("home-backup");
  return raw ? (JSON.parse(raw) as Backup) : null;
}

function backupRow(path: FormPath | null): FormRow {
  const c = FORM_COPY.thisMac.settings;
  const selected = backup()?.mode;
  return formRow({ id: "settings.backup", title: path === "solo" ? c.soloTitle : c.title, subtext: c.subtext, state: selected ? "done" : "todo",
                   detail: selected ? c[selected] : "",
                   action: { type: "choose", label: c.change, verb: ["setup", "home-backup"], ...(selected ? { selected } : {}),
                             options: [{ id: "remote", label: c.remote, detail: c.remoteDetail },
                                       { id: "local", label: c.local, detail: c.localDetail, warn: true }] } });
}

const GITHUB_CODE = "WDGT-4271";
const GITHUB_DEVICE_URL = "https://github.com/login/device";

/** The device-flow sign-in lands on its own after a while; landing it stores the token and stages the create. */
function githubSignedIn(): boolean {
  if (stateGet("github-token") > 0) return true;
  if (!stateGet("github-signin-at")) return false;
  const landed = landsAfter("github-reads", "github-signin-at", 2);
  if (landed) {
    stateSet("github-token", 1);
    textSet("home-backup", JSON.stringify({ mode: "remote", create: true }));
  }
  return landed;
}

/** Choosing remote stages nothing, so the row stays open until a url or a create is staged. */
function remoteRow(): FormRow | null {
  const b = backup();
  if (b?.mode !== "remote") return null;
  const c = FORM_COPY.thisMac.remote;
  const base = { id: "settings.remote", title: c.title, subtext: c.subtext };
  if (b.url) return formRow({ ...base, state: "done", detail: b.url, action: null });
  if (b.create) return formRow({ ...base, state: "done", detail: c.creates, action: null });
  const t = FORM_COPY.connect.teamTool;
  if (stateGet("github-signin-at")) {
    if (githubSignedIn()) return formRow({ ...base, state: "done", detail: c.creates, action: null });
    return formRow({ ...base, state: "waiting", detail: t.code(GITHUB_CODE), watch: true, action: { type: "open-url", label: t.openAgain, url: GITHUB_DEVICE_URL } });
  }
  return formRow({ ...base, subtext: c.signInSubtext, state: "todo", detail: "", action: { type: "run", label: c.signIn, verb: ["setup", "github", "sign-in"] } });
}

function thisMacSection(path: FormPath | null): FormRow[] {
  const repos = path === "solo" ? repoRootRow() : repoRow();
  return [...cltRows(), repos, backupRow(path), remoteRow()].filter((r): r is FormRow => r !== null);
}

function formStage(path: FormPath | null, sections: SetupForm["sections"]): FormStage {
  if (NEW_TOOL) return stateGet("tools-acked") > 0 ? "ready" : "tools";
  if (!allAnswered(sections.macos)) return "macos";
  if (stateGet("run-live") > 0) return "running";
  if (runFailure()) return "paused";
  if (stateGet("run-ok") > 0) return "ready";
  if (path === null) return "path";
  if (path === "join" && stateGet("team-joined") === 0) return "invite";
  if (path === "join" && WAITING_JOINS.includes(scenario) && stateGet("join-approved") === 0) return "waiting";
  if (path === "restore") return "running";
  if (!allAnswered(sections.connect)) return "connect";
  return "this-mac";
}

function createdTeam(): { slug: string; name: string } {
  const raw = textGet("created-team");
  return raw ? (JSON.parse(raw) as { slug: string; name: string }) : { slug: "acme", name: "Acme" };
}

function setupForm(): SetupForm {
  const at = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const section = at("--section") as FormSection | undefined;
  const wanted: readonly FormSection[] = section ? [section] : FORM_SECTIONS;
  const path = chosenPath();
  const sections: SetupForm["sections"] = {};
  if (wanted.includes("macos")) sections.macos = macosSection();
  if (wanted.includes("invite")) sections.invite = inviteSection();
  if (wanted.includes("restore")) sections.restore = cltRows();
  if (wanted.includes("connect")) sections.connect = connectSection(path);
  if (wanted.includes("this-mac")) sections.thisMac = thisMacSection(path);
  if (wanted.includes("create")) sections.create = createSection(at("--forge") === "github" ? "github" : "gitlab");
  const stage = section ? null : formStage(path, sections);
  if (section === "tools" || stage === "tools") sections.tools = newToolRows();
  const team = path === "join" ? { slug: "acme", name: "Acme", invitedBy: INVITER } : path === "create" ? { ...createdTeam(), invitedBy: null } : null;
  const failed = runFailure();
  return {
    path,
    team,
    stage,
    sections,
    continueReady: allAnswered(sections.connect),
    continueNote: continueNote(path),
    startReady: allAnswered(sections.thisMac),
    start: startButton(path, false, sections.thisMac ?? [], new Set()),
    paused: section || !failed ? null : { step: failed.step, title: STEP_PHASES[failed.step as StepId]?.paused ?? failed.detail,
                                          detail: failed.detail, remedy: failed.remedy, log: failed.log, action: null },
    home: homeApp(path),
    ...(sections.tools ? { tools: toolsForm(sections.tools) } : {}),
  };
}

const [a0, a1, a2] = args;
if (a0 === "setup" && (a1 === "plan" || a1 === "status")) emit(plan());
else if (a0 === "setup" && a1 === "apply") await apply();
else if (a0 === "setup" && a1 === "join-status") emit(joinStatus());
// No gh session, so rt sends no handle or owners and the screens show the GitHub token rows; a pasted token is the account.
else if (a0 === "setup" && a1 === "github" && a2 === "status") {
  emit(connected("github") ? { integration: "github", status: "ready", detail: "token can see group acme", scopesSeen: ["repo", "read:org"] }
                           : { integration: "github", status: "missing", detail: "No GitHub token yet", scopesSeen: [] });
}
else if (a0 === "setup" && a1 === "intent" && a2 === "restore") emit({ ok: true, intent: "restore", repo: args[3] });
else if (a0 === "setup" && a1 === "intent" && a2 === "solo") { choosePath("solo"); emit({ mode: "solo" }); }
else if (a0 === "setup" && a1 === "form" && args.includes("--ack-tools")) { stateSet("tools-acked", 1); emit({ ok: true }); }
else if (a0 === "setup" && a1 === "form") emit(setupForm());
else if (a0 === "tools" && a1 === "install" && a2) {
  const ms = prepareMs();
  stateSet("prepare-tool-until", Date.now() + ms);
  await sleep(ms);
  emit({ tool: a2, installed: true });
}
else if (a0 === "setup" && a1 === "prepare") {
  const stage = PREPARE_STAGES.find((s) => s === a2);
  if (!stage) fail("bad-stage", `${a2 ?? "(none)"} is not a part of setup that installs anything. Use macos or accounts`);
  const ms = prepareMs();
  stateSet(`prepare-${stage}-until`, Date.now() + ms);
  await sleep(ms);
  emit({ stage, installed: stage === "macos" ? ["apple-clt"] : ["claude", "herdr"], failed: [] });
}
else if (a0 === "setup" && a1 === "claude" && a2 === "connect") {
  await sleep(waitMs(1));
  const ready = stateBump("claude-connect-calls") > 1 || stateGet("claude-signed-in") > 0;
  emit({ integration: "claude", status: ready ? "ready" : "needs-you", detail: ready ? "Signed in as janedoe@example.com" : FINISH_IN_BROWSER });
}
else if (a0 === "setup" && a1 === "claude" && a2 === "code") {
  if (stateGet("claude-connect-calls") === 0) fail("no-login", "Start signing in again");
  const body = await readStdinJSON();
  if (typeof body.code !== "string" || body.code.trim() === "") fail("bad-stdin", 'No code given. Pipe {"code": "<code>"} on stdin');
  await sleep(waitMs(1));
  stateSet("claude-signed-in", 1);
  emit({ integration: "claude", status: "ready", detail: "Signed in as janedoe@example.com" });
}
else if (a0 === "setup" && a1 === "slack" && a2 === "connect") {
  await sleep(waitMs(1));
  stateBump("slack-connected");
  emit({ integration: "slack", status: "ready", detail: FORM_COPY.connect.connected });
}
else if (a0 === "setup" && a1 === "slack" && a2 === "create-app") {
  const body = await readStdinJSON();
  if (!body.configToken) fail("bad-stdin", "Paste the app configuration token");
  await sleep(waitMs(1));
  stateSet("slack-app-created", 1);
  emit({ integration: "slack", status: "ready", detail: "Slack app created", scopesSeen: [] });
}
else if (a0 === "setup" && a1 === "github" && a2 === "sign-in") {
  await sleep(waitMs(1));
  stampNow("github-signin-at");
  emit({ integration: "github", status: "needs-you", userCode: GITHUB_CODE, url: GITHUB_DEVICE_URL });
}
else if (a0 === "setup" && a1 === "doppler" && a2 === "connect") {
  await sleep(waitMs(1));
  if (dopplerSignedIn()) emit({ integration: "doppler", status: "ready", detail: "Signed in to doppler", scopesSeen: [] });
  else {
    stampNow("doppler-login-at");
    emit({ integration: "doppler", status: "needs-you", detail: FORM_COPY.connect.teamTool.code(DOPPLER_CODE), scopesSeen: [] });
  }
}
else if (a0 === "setup" && a1 === "home-backup") {
  if (a2 !== "local" && a2 !== "remote") fail("usage", `${a2 ?? "Nothing"} is not a place for your settings. Use local or remote`);
  const prior = backup();
  const remote: Backup = stateGet("github-token") > 0 ? { mode: "remote", create: true } : { mode: "remote" };
  const homeBackup: Backup = a2 === "local" ? { mode: "local" } : prior?.mode === "remote" ? prior : remote;
  if (a2 === "local") for (const key of ["github-signin-at", "github-reads"]) rmSync(join(stateDir, key), { force: true });
  textSet("home-backup", JSON.stringify(homeBackup));
  emit({ homeBackup });
}
else if (a0 === "home" && a1 === "remote" && a2 === "set") {
  const body = await readStdinJSON();
  const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : null;
  if (!url && body.alternative !== "create") fail("bad-stdin", 'No remote given. Pipe {"url": "<git url>"} or {"alternative": "create"} on stdin');
  textSet("home-backup", JSON.stringify(url ? { mode: "remote", url } : { mode: "remote", create: true }));
  emit({ staged: true, url, created: false, pushed: false });
}
else if (a0 === "setup" && a1 === "repo" && a2 === "place") {
  const body = await readStdinJSON();
  if (body.identity !== BOARD_REPO || (body.mode !== "checkout" && body.mode !== "clone") || typeof body.path !== "string") {
    fail("bad-stdin", 'Pipe {"identity", "mode", "path"} on stdin');
  }
  textSet("repo-placement", JSON.stringify({ mode: body.mode, path: body.path }));
  emit({ identity: body.identity, mode: body.mode, path: body.path });
}
else if (a0 === "setup" && a1 === "repo-root" && a2 === "set") {
  const body = await readStdinJSON();
  if (typeof body.root !== "string" || !body.root) fail("bad-stdin", 'No folder given. Pipe {"root": "<path>"} on stdin');
  textSet("repo-root", body.root);
  emit({ path: body.root, tccWarning: null });
}
// The app's own side of Test drive setup: a System Settings pane or a macOS
// prompt answered, and a link opened in the browser rt never sees.
// `--probe` answers before a drive starts, so an older stub without these verbs is caught then, not as a stuck row.
else if (a0 === "stub" && a1 === "grant" && a2 === "--probe") emit({ ok: true, probe: true });
else if (a0 === "stub" && a1 === "grant" && a2) { stateSet(`granted-${a2}`, 1); emit({ ok: true, granted: a2 }); }
else if (a0 === "stub" && a1 === "opened" && a2) {
  if (FAST_BROWSER_ADD_ACTION.type === "open-url" && a2 === FAST_BROWSER_ADD_ACTION.url) stampNow("fast-browser-opened-at");
  emit({ ok: true, opened: a2 });
}
else if (a0 === "setup" && a1 === "finish") {
  const rtDir = join(process.env.HOME ?? stateDir, ".mattstack", "rt");
  mkdirSync(rtDir, { recursive: true });
  writeFileSync(join(rtDir, "setup-state.json"), JSON.stringify({ v: 2, marketplaces: [], plugins: [], links: [], extensionEditors: [], forcedLinks: [], finishedAt: at }));
  emit({ ok: true, finishedAt: at });
}
else if (a0 === "setup" && (a1 === "waive" || a1 === "unwaive")) {
  if (a2 === undefined || (!isFinishGatedRowId(a2) && !WAIVABLE_ROW_IDS.includes(a2))) fail("not-finish-gated", `${a2} is not a row that blocks Finish`);
  if (a1 === "waive" && !WAIVABLE_ROW_IDS.includes(a2)) fail("not-waivable", `${a2} cannot be skipped. Rows that can: ${WAIVABLE_ROW_IDS.join(", ")}`);
  const wasWaived = stateGet("waived") > 0;
  stateSet("waived", a1 === "waive" ? 1 : 0);
  emit({ ok: true, id: a2, changed: wasWaived !== (a1 === "waive"), waived: a1 === "waive" ? [a2] : [] });
}
else if (a0 === "skills" && a1 === "writing-style" && a2 === "use") {
  const id = args[3];
  if (id === undefined) fail("usage", "usage: rt skills writing-style use <skill-id> [--scope user|team] [--json]");
  if (!isValidSkillId(id)) fail("bad-id", `"${id}" is not a skill id`);
  if (REAL_WRITING_STYLE) {
    const inventory = realInventory();
    const known = isPresetId(id) || inventory.installed.has(id) || inventory.personal.some((p) => p.name === id);
    if (!known) fail("unknown-skill", `${id} is not installed here.`);
  } else if (!INSTALLED_STYLES.includes(id)) {
    fail("unknown-skill", `${id} is not installed here. Choose one of: ${INSTALLED_STYLES.join(", ")}`);
  }
  stateSet("style", 1);
  writeFileSync(join(stateDir, "style-id"), id);
  emit({ skill: id, scope: "user" });
}
else if (a0 === "setup" && a2 === "status") emit({ integration: a1, status: stateGet(`${a1}-connected`) ? "ready" : "missing", detail: null });
else if (a0 === "setup" && a2 === "connect") {
  const body = await readStdinJSON();
  const named = integrationDef(a1!).fields.map((f) => f.name);
  const filled = (named.length ? named : ["token"]).some((n) => typeof body[n] === "string" && (body[n] as string).trim() !== "");
  if (!filled && !body.useGh) fail("no-token", "Paste a token or use gh.");
  await sleep(waitMs(0.5));
  stateBump(`${a1}-connected`);
  emit({ integration: a1, status: "ready", detail: "token can see group acme", scopesSeen: ["api"] });
}
else if (a0 === "team" && a1 === "create") {
  choosePath("create");
  const name = args[2] ?? "My team";
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-team";
  const forgeAt = args.indexOf("--forge");
  textSet("create-forge", forgeAt >= 0 ? args[forgeAt + 1]! : "github");
  textSet("created-team", JSON.stringify({ slug, name }));
  await sleep(waitMs(1));
  emit({ slug, name, remote: `https://github.com/acme/mattstack-team-${slug}.git`, created: true });
}
else if (a0 === "team" && a1 === "join") {
  const body = await readStdinJSON();
  if (!body.code) fail("invite-malformed", "Paste an invite code.");
  choosePath("join");
  const team = { slug: "acme", name: "Acme", owner: INVITER };
  if (scenario === "join-no-account") emit({ team, access: "no-account", peering: "idle", intent: "written", message: `Joining Acme (owner ${INVITER}). Connect your GitLab account on the next screen so rt can reach gitlab.com/acme/mattstack-team-acme.` });
  else if (scenario === "join-no-access") emit({ team, access: "denied", peering: "idle", intent: "written", message: `Joining Acme. Your GitHub account cannot see acme/team yet: ask ${INVITER} or your org admin to grant read access.` });
  else emit({ team, access: "ok", peering: "idle", intent: "written", message: `Joining Acme (owner ${INVITER})` });
}
else if (a0 === "team" && a1 === "status") emit(scenario === "solo" ? { mode: "solo", slug: null, name: null, remote: null, lastPush: null, members: [] } : { slug: "acme", name: "Acme", remote: "git@github.com:acme/mattstack-team-acme.git", lastPush: "2026-08-21T03:00:00Z", members: [{ username: "janedoe" }, { username: "bob" }] });
else if (a0 === "apps" && a1 === "list") emit({ apps: [
  { name: "board", displayName: "Board", description: "Open MRs ready for review.", enabled: scenario !== "solo", requiresTeam: true },
  { name: "boxscore", displayName: "boxscore", description: "Team scoreboard.", enabled: scenario !== "solo", requiresTeam: true },
  { name: "console", displayName: "Console", description: "Settings and logs for this Mac.", enabled: true, requiresTeam: false },
  { name: "chat", displayName: "Chat", description: "Rooms and DMs for the agents on this Mac.", enabled: true, requiresTeam: false },
] });
else if (a0 === "apps" && (a1 === "enable" || a1 === "disable")) emit({ name: a2, enabled: a1 === "enable" });
else if (a0 === "team" && a1 === "invite") emit({ code: "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567", expiresAt: "2026-08-28T00:00:00Z",
  pasteBlock: "Install mattstack from https://github.com/m4ttstack/mattstack/releases, then open mattstack://join/ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567 or paste the code into Setup → Join a team.",
  forgeAccess: "granted", manualSteps: [], link: "https://mattstack.dev/join#ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567" });
else if (a0 === "uninstall" && args.includes("--dry-run")) emit({ actions: uninstallActions() });
else if (a0 === "uninstall") {
  if (args.includes("--delete-data") && !args.includes("--yes")) fail("confirm-required", "--delete-data needs --yes when not on a TTY.");
  const line = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
  const actions = uninstallActions();
  line({ event: "plan", steps: actions.map((a) => ({ id: a.id, title: a.title, kind: a.kind })) });
  for (const a of actions) {
    line({ event: "step", id: a.id, state: "running" });
    if (a.id === "services.unregister") {
      line({ event: "need", id: a.id, request: { type: "app-unregister-services", plists: ["com.mattstack.daemon.plist", "com.mattstack.deck.plist"] } });
    } else if (a.id === "proxy.remove") {
      line({ event: "need", id: a.id, request: { type: "app-privileged", op: "proxy-remove" } });
    }
    line({ event: "step", id: a.id, state: "done", detail: a.kind === "rt" ? "ok" : "done by the app" });
  }
  line({ event: "done", ok: true, failedStep: null }); }
else if (a0 === "settings" && a1 === "set") emit({ ok: true, key: a2 });
else if (a0 === "home" && a1 === "restore") {
  if (args.includes("--stdin") && !(await new Response(Bun.stdin.stream()).text()).trim()) fail("bad-stdin", "Paste the recovery key from your other Mac");
  await sleep(waitMs(1));
  choosePath("restore");
  emit({ ok: true, repo: a2, url: `https://github.com/${a2}.git`, key: "imported" });
}
else if (a0 === "home" && a1 === "init") emit({ ok: true });
else if (a0 === "version" || a0 === "--version") emit({ version: "2.8.0-stub", build: 0 });
else if (a0 === "logins") {
  const path = join(stateDir, "logins.json");
  const saved: Record<string, { email: string }> = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const origin = args[2];
  if (a1 === "list") {
    const rows = Object.entries(saved).sort().map(([o, v]) => {
      const u = new URL(o);
      const key = u.host.replace(":", "_") + (u.protocol === "http:" ? "_http" : "");
      return { origin: o, email: v.email, fields: { email: `devlogin:${key}:email`, password: `devlogin:${key}:password` } };
    });
    process.stdout.write(JSON.stringify(rows) + "\n");
  } else if (a1 === "add" && origin) {
    const body = await readStdinJSON();
    const replaced = origin in saved;
    saved[origin] = { email: String(body.email ?? "") };
    writeFileSync(path, JSON.stringify(saved));
    process.stdout.write(JSON.stringify({ ok: true, origin, replaced }) + "\n");
  } else if (a1 === "remove" && origin) {
    const removed = origin in saved;
    delete saved[origin];
    writeFileSync(path, JSON.stringify(saved));
    process.stdout.write(JSON.stringify({ ok: true, removed }) + "\n");
  } else fail("usage", "rt logins list|add|remove");
}
else fail("unknown-verb", `stub has no answer for: ${args.join(" ")}`);
