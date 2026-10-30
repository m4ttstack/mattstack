import { describe, expect, test } from "bun:test";
import { finalizePlan, row, type Action, type OrgRef, type Plan, type Row } from "../contract.ts";
import type { FancyUrls } from "../fancy-urls.ts";
import {
  allAnswered,
  connectRows,
  formPath,
  formStage,
  homeApp,
  macosRows,
  needsRun,
  pausedFor,
  thisMacRows,
  type FormPath,
  type FormRow,
  type FormStage,
  type StageInputs,
} from "../form.ts";
import { LOGIN_ITEMS_SETTINGS_ACTION } from "../permissions.ts";
import type { ToolRequirement } from "../requirements.ts";
import type { SetupIntent } from "../intent.ts";
import type { SetupRun } from "../state.ts";
import { HOME_BACKUP_PUSH_ACTION } from "../validators/rt-health.ts";

const NOW = new Date("2026-10-30T10:00:00.000Z");
const JOIN: OrgRef = { slug: "mithrandir", name: "Mithrandir", mode: "join" };
const SOLO: OrgRef = { slug: "", name: "", mode: "none" };

const RUNNING: SetupRun = { startedAt: "2026-10-30T09:40:00.000Z", done: ["home.init", "org.folder"] };
const FAILED: SetupRun = {
  startedAt: "2026-10-30T09:40:00.000Z",
  done: ["home.init"],
  endedAt: "2026-10-30T09:50:00.000Z",
  ok: false,
  failed: { step: "repos.clone", detail: "Couldn't clone acme-api", remedy: "Check that your token can see acme/acme-api" },
};
const ENDED_OK: SetupRun = { startedAt: "2026-10-30T09:40:00.000Z", done: ["home.init", "verify"], endedAt: "2026-10-30T09:50:00.000Z", ok: true };

function stage(over: Partial<StageInputs> = {}): FormStage {
  return formStage({
    finished: false,
    path: "join",
    macosDone: true,
    join: "approved",
    run: undefined,
    connectDone: true,
    thisMacDone: false,
    needsRun: false,
    ...over,
  });
}

describe("formStage on a Mac setting up", () => {
  test("a fresh Mac starts at macOS", () => {
    expect(stage({ path: null, join: null, macosDone: false, connectDone: false })).toBe("macos");
  });

  test("a run that died mid-bar resumes the bar", () => {
    expect(stage({ run: RUNNING, connectDone: false })).toBe("running");
  });

  test("a run that failed shows Setup paused", () => {
    expect(stage({ run: FAILED })).toBe("paused");
  });

  test("no choice yet is the four cards", () => {
    expect(stage({ path: null, join: null, connectDone: false })).toBe("path");
  });

  test("an invite not joined yet is the invite screen", () => {
    expect(stage({ join: "unredeemed", connectDone: false })).toBe("invite");
  });

  test("waiting on the admin is the waiting screen", () => {
    expect(stage({ join: "waiting", connectDone: false })).toBe("waiting");
  });

  test("an unreadable approval lets the member on", () => {
    expect(stage({ join: "unreadable", connectDone: false })).toBe("connect");
  });

  test("a restore goes straight to the bar", () => {
    expect(stage({ path: "restore", join: null, connectDone: false })).toBe("running");
  });

  test("accounts not connected is the connect screen", () => {
    expect(stage({ connectDone: false })).toBe("connect");
    expect(stage({ path: "create", join: null, connectDone: false })).toBe("connect");
    expect(stage({ path: "solo", join: null, connectDone: false })).toBe("connect");
  });

  test("nothing run yet is the this-Mac screen", () => {
    expect(stage()).toBe("this-mac");
    expect(stage({ thisMacDone: true })).toBe("this-mac");
  });

  test("a run that ended ok with Finish still blocked never loops back to the bar", () => {
    expect(stage({ run: ENDED_OK, thisMacDone: false })).toBe("this-mac");
    expect(stage({ run: ENDED_OK, thisMacDone: true })).toBe("this-mac");
  });

  // The app resumes the bar with --resume, which runs everything again against an ended record.
  test("a run that already ended never puts the bar back up, whatever the path", () => {
    for (const path of ["join", "create", "solo", "restore"] as const) {
      for (const run of [ENDED_OK, FAILED]) {
        expect(stage({ path, join: null, run, connectDone: false })).not.toBe("running");
      }
    }
  });
});

describe("formStage on a finished Mac", () => {
  const finished = (over: Partial<StageInputs> = {}) => stage({ finished: true, run: ENDED_OK, thisMacDone: true, ...over });

  test("a finished Mac with everything done is ready", () => {
    expect(finished()).toBe("ready");
    expect(finished({ run: undefined })).toBe("ready");
    expect(finished({ join: "unreadable" })).toBe("ready");
  });

  test("a finished Mac an update broke goes back to the this-Mac screen", () => {
    expect(finished({ thisMacDone: false })).toBe("this-mac");
    expect(finished({ needsRun: true })).toBe("this-mac");
  });

  test("a finished Mac missing an account goes to the connect screen", () => {
    expect(finished({ connectDone: false })).toBe("connect");
    expect(finished({ connectDone: false, thisMacDone: false })).toBe("connect");
    expect(finished({ macosDone: false, connectDone: false })).toBe("macos");
  });

  test("a finished Mac joining another team from Settings lands on the wait", () => {
    expect(finished({ join: "waiting" })).toBe("waiting");
    expect(finished({ join: "unredeemed", connectDone: false })).toBe("invite");
  });
});

const FANCY_DONE: FancyUrls = { state: "done", detail: "Allowed", brewMissing: false };
const SDM_CONNECT: Action = { type: "connect", label: "Connect", integration: "sdm", fields: [{ name: "email", label: "StrongDM email", secret: false }] };
const SHELL_RECHECK: Action = { type: "run", label: "Re-check", verb: ["setup", "apply", "--only", "shell.setup"] };
const DOPPLER: ToolRequirement = { name: "doppler", why: "Pulls your dev secrets", connect: { integration: "doppler" } };
const ACME_LOGIN: ToolRequirement = { name: "acme-api", why: "", connect: { verb: ["acme-api", "login"], label: "Log in" } };

function r(id: string, status: Row["status"], detail: string, over: Partial<Row> = {}): Row {
  return row({ id, kind: id.startsWith("account.") ? "account" : id.startsWith("perm.") ? "permission" : "tool", title: id, why: `why ${id}`, required: true, status, detail, ...over });
}

function plan(rows: Row[], team: OrgRef = JOIN): Plan {
  return finalizePlan(team, [{ id: "tools", title: "Tools", rows }], NOW);
}

/** A joiner with every account connected and every permission granted. */
function settledRows(): Row[] {
  return [
    r("perm.fda", "ready", "Granted"),
    r("perm.login-items", "ready", "Enabled"),
    r("account.gitlab", "ready", "GitLab token works"),
    r("account.slack", "ready", "Connected to Acme", { finishGated: true, waivable: false }),
    r("tool.claude", "ready", "Claude Code 2.1.0, signed in"),
    r("tool.team.doppler", "ready", "doppler 3.70.0"),
    r("account.doppler", "ready", "Signed in to Doppler", { required: false }),
    r("account.linear", "ready", "Connected", { finishGated: true, waivable: false }),
    r("tool.chrome", "ready", "Google Chrome installed"),
    r("tool.fast-browser-extension", "ready", "Loaded and paired", { required: false, finishGated: true, waivable: false }),
  ];
}

/** Rows the run never sets up: each has its own fix on a form screen. */
function formFixRows(): Row[] {
  return [
    // Denied stays denied: macOS never asks twice, and the row reads done.
    r("perm.notifications", "needs-you", "Denied"),
    r("tool.herdr", "missing", "herdr is not installed", { action: { type: "install", label: "Install", tool: "herdr", via: "brew" } }),
    r("tool.team.widget-cli", "missing", "widget-cli is not installed", { finishGated: true, waivable: false, action: { type: "open-url", label: "Download", url: "https://example.com/widget-cli" } }),
    r("account.sdm", "missing", "No StrongDM account connected yet", { action: SDM_CONNECT }),
  ];
}

/** Rows a run sets up, left standing after one that ended ok. */
function runFixRows(): Row[] {
  return [
    r("tool.shell", "needs-you", "rt does not recognize your shell", { finishGated: true, waivable: false, action: SHELL_RECHECK }),
    r("home.backup", "needs-you", "Remote set, nothing pushed yet", { required: false, finishGated: true, waivable: false, action: HOME_BACKUP_PUSH_ACTION }),
  ];
}

const SECTIONS = ["macos", "connect", "this-mac"] as const;
type Section = (typeof SECTIONS)[number];

function screens(p: Plan, o: { path?: FormPath; ranOk: boolean; signIn?: ToolRequirement[] }): Record<Section, FormRow[]> {
  const path = o.path ?? "join";
  const signIn = o.signIn ?? [DOPPLER];
  const permissions = p.groups.flatMap((g) => g.rows).filter((x) => x.id.startsWith("perm."));
  const denied = permissions.find((x) => x.id === "perm.notifications")?.detail === "Denied";
  return {
    macos: macosRows({ permissions, notifications: denied ? "denied" : "authorized", fancyUrls: FANCY_DONE }),
    connect: connectRows({ path, plan: p, forge: path === "solo" ? null : { provider: "gitlab", host: "gitlab.com" }, forgeLogin: "janedoe", signIn, prepare: null, logins: {} }),
    "this-mac": thisMacRows({
      path,
      plan: p,
      signIn,
      ranOk: o.ranOk,
      cltInstalled: true,
      prepare: null,
      backup: undefined,
      homeRemote: null,
      ghSignedIn: false,
      repoRoot: { configured: "/fake-home/code", staged: null, candidate: null },
    }),
  };
}

const DRAWN_AS: Record<string, string[]> = {
  forge: ["account.github", "account.gitlab"],
  slack: ["account.slack"],
  "slack-app": ["account.slack-app"],
  claude: ["tool.claude"],
  linear: ["account.linear"],
  "fast-browser": ["tool.fast-browser-extension", "tool.chrome"],
};

/** The plan rows a drawn row stands for: some sections draw a plan row under a name of their own. */
function planIdsOf(drawn: string, signIn: ToolRequirement[]): string[] {
  if (drawn.startsWith("signin.")) {
    const name = drawn.slice("signin.".length);
    const connect = signIn.find((t) => t.name === name)?.connect;
    return [`tool.team.${name}`, ...(connect && "integration" in connect ? [`account.${connect.integration}`] : [])];
  }
  if (drawn.startsWith("settings.")) return [];
  return DRAWN_AS[drawn] ?? [drawn];
}

function drawnStates(s: Record<Section, FormRow[]>, signIn: ToolRequirement[]): Map<string, FormRow["state"][]> {
  const states = new Map<string, FormRow["state"][]>();
  for (const section of SECTIONS) {
    for (const x of s[section]) for (const id of planIdsOf(x.id, signIn)) states.set(id, [...(states.get(id) ?? []), x.state]);
  }
  return states;
}

function holdsTodo(rows: FormRow[]): boolean {
  return rows.some((x) => x.state === "todo" && !x.optional);
}

function stageOf(s: Record<Section, FormRow[]>, p: Plan, o: { finished: boolean; run: SetupRun | undefined; path?: FormPath }): FormStage {
  return formStage({
    finished: o.finished,
    path: o.path ?? "join",
    macosDone: allAnswered(s.macos),
    join: "approved",
    run: o.run,
    connectDone: allAnswered(s.connect),
    thisMacDone: allAnswered(s["this-mac"]),
    needsRun: o.finished && needsRun(p),
  });
}

describe("every row that blocks Install or Finish is on a screen", () => {
  const cases: { name: string; rows: Row[]; run: SetupRun | undefined }[] = [
    { name: "before a run", rows: [...settledRows(), ...formFixRows()], run: undefined },
    { name: "after an ok run", rows: [...settledRows(), ...runFixRows()], run: ENDED_OK },
    { name: "after an ok run that left both kinds", rows: [...settledRows(), ...formFixRows(), ...runFixRows()], run: ENDED_OK },
  ];

  test("setup never lands on a screen that shows none of the missing rows", () => {
    for (const c of cases) {
      const p = plan(c.rows);
      const s = screens(p, { ranOk: c.run?.ok === true });
      const drawn = drawnStates(s, [DOPPLER]);
      for (const id of p.finishBlockedBy) expect({ case: c.name, id, states: drawn.get(id) ?? [] }).toMatchObject({ states: expect.arrayContaining(["todo"]) });
      for (const id of p.requiredMissing) {
        const states = drawn.get(id) ?? [];
        expect({ case: c.name, id, drawn: states.some((st) => st === "todo" || st === "done") }).toEqual({ case: c.name, id, drawn: true });
      }
      const first = SECTIONS.find((section) => holdsTodo(s[section]));
      expect(first).toBeDefined();
      for (const finished of [false, true]) expect({ case: c.name, finished, stage: stageOf(s, p, { finished, run: c.run }) }).toEqual({ case: c.name, finished, stage: first! });
    }
  });

  test("before any ok run, rows only the bar can fix send the member to Set up this Mac", () => {
    const p = plan([...settledRows(), r("tool.daemon", "missing", "Not running")]);
    const s = screens(p, { ranOk: false });
    expect(p.requiredMissing).toEqual(["tool.daemon"]);
    expect(drawnStates(s, [DOPPLER]).has("tool.daemon")).toBe(false);
    expect(stageOf(s, p, { finished: true, run: undefined })).toBe("this-mac");
  });

  test("a finished Mac with only optional connections left is ready", () => {
    const team = plan([...settledRows(), r("tool.team.acme-api", "ready", "acme-api 1.0.0")]);
    const teamScreens = screens(team, { ranOk: true, signIn: [DOPPLER, ACME_LOGIN] });
    expect(teamScreens.connect.find((x) => x.id === "signin.acme-api")).toMatchObject({ state: "todo", optional: true });
    expect(stageOf(teamScreens, team, { finished: true, run: ENDED_OK })).toBe("ready");

    const solo = plan(
      [
        r("perm.fda", "ready", "Granted"),
        r("account.github", "missing", "No GitHub account connected yet", { required: false }),
        r("tool.claude", "ready", "Claude Code 2.1.0, signed in"),
        r("tool.chrome", "ready", "Google Chrome installed"),
        r("tool.fast-browser-extension", "ready", "Loaded and paired", { required: false }),
      ],
      SOLO,
    );
    const soloScreens = screens(solo, { path: "solo", ranOk: true, signIn: [] });
    expect(soloScreens.connect.find((x) => x.id === "forge")).toMatchObject({ state: "todo", optional: true });
    expect(stageOf(soloScreens, solo, { finished: true, run: ENDED_OK, path: "solo" })).toBe("ready");
  });
});

describe("pausedFor", () => {
  const event = (ev: object) => `${JSON.stringify(ev)}\n`;
  const events = [
    event({ event: "plan", steps: [] }),
    event({ event: "log", id: "home.init", line: "home.init said hello" }),
    ...Array.from({ length: 60 }, (_, i) => event({ event: "log", id: "repos.clone", line: `clone line ${i + 1}` })),
    "a torn line\n",
    event({ event: "step", id: "repos.clone", state: "failed", detail: "Couldn't clone acme-api" }),
    event({ event: "done", ok: false, failedStep: "repos.clone" }),
  ].join("");

  test("the paused copy names the step and carries its detail and log", () => {
    const paused = pausedFor(FAILED, { events, loginItems: r("perm.login-items", "ready", "Enabled") });
    expect(paused).toEqual({
      step: "repos.clone",
      title: "Couldn't clone your repos",
      detail: "Couldn't clone acme-api",
      remedy: "Check that your token can see acme/acme-api",
      log: Array.from({ length: 50 }, (_, i) => `clone line ${i + 11}`),
      action: null,
    });
    expect(pausedFor({ ...FAILED, failed: { step: "home.init", detail: "boom" } }, { events: null, loginItems: undefined })).toMatchObject({ remedy: null, log: [] });
  });

  test("no failed run, nothing paused", () => {
    expect(pausedFor(undefined, { events, loginItems: undefined })).toBeNull();
    expect(pausedFor(RUNNING, { events, loginItems: undefined })).toBeNull();
    expect(pausedFor(ENDED_OK, { events, loginItems: undefined })).toBeNull();
  });

  test("a held background item puts Open Login Items on the paused screen", () => {
    const held = r("perm.login-items", "needs-you", "Approve in Login Items", { action: LOGIN_ITEMS_SETTINGS_ACTION });
    expect(pausedFor(FAILED, { events: null, loginItems: held })?.action).toEqual(LOGIN_ITEMS_SETTINGS_ACTION);
  });
});

describe("homeApp", () => {
  test("Just me opens the console", () => {
    expect(homeApp("solo")).toEqual({ label: "Open the console", url: "https://console.mattstack" });
    for (const path of ["join", "create", "restore", null] as const) expect(homeApp(path)).toEqual({ label: "Open the board", url: "https://board.mattstack" });
  });
});

describe("formPath", () => {
  const intent = (mode: SetupIntent["mode"]): SetupIntent => ({ v: 1, at: "2026-10-30T09:00:00.000Z", mode });
  const none = { intent: null, joined: false, created: false, orgs: [] as string[], ranOrFinished: false };

  test("the path follows the choice, then the team on disk, then any run", () => {
    expect(formPath(none)).toBeNull();
    expect(formPath({ ...none, intent: intent("restore"), orgs: ["mithrandir"], joined: true })).toBe("restore");
    expect(formPath({ ...none, orgs: ["mithrandir"], joined: true, created: true })).toBe("join");
    expect(formPath({ ...none, orgs: ["mithrandir"], created: true })).toBe("create");
    expect(formPath({ ...none, orgs: ["mithrandir"] })).toBe("join");
    expect(formPath({ ...none, ranOrFinished: true })).toBe("solo");
  });
});
