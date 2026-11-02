import { describe, expect, test } from "bun:test";
import { finalizePlan, row, type Action, type OrgRef, type Plan, type Row } from "../contract.ts";
import { allAnswered, composeForm, thisMacRows, type FormRow, type ThisMacInputs } from "../form.ts";
import type { PrepareRecord } from "../prepare.ts";
import { HOME_BACKUP_PUSH_ACTION } from "../validators/rt-health.ts";
import type { Probes } from "../probes.ts";
import { fakeProbes } from "./fakes.ts";

const NOW = new Date("2026-10-30T10:00:00.000Z");
const JOIN: OrgRef = { slug: "mithrandir", name: "Mithrandir", mode: "join" };
const SOLO: OrgRef = { slug: "", name: "", mode: "none" };

const WIDGETS = "gitlab.com/acme/widgets";
const ACME_API = "gitlab.com/acme/acme-api";
const SHELL_RECHECK: Action = { type: "run", label: "Re-check", verb: ["setup", "apply", "--only", "shell.setup"] };

function r(id: string, status: Row["status"], detail: string, over: Partial<Row> = {}): Row {
  return row({ id, kind: "tool", title: id, why: `why ${id}`, required: true, status, detail, ...over });
}

type PlaceRepo = Extract<Action, { type: "place-repo" }>;

function placeAction(identity: string, board: string | null, over: Partial<PlaceRepo> = {}): PlaceRepo {
  const repo = identity.split("/").pop()!;
  const base: PlaceRepo = {
    type: "place-repo",
    label: "Choose…",
    labels: { checkout: "Locate…", checkoutAgain: "Locate again…", clone: "Choose…" },
    identity,
    repo,
    mode: "clone",
    checkoutPath: null,
    clonePath: `/fake-home/code/${repo}`,
    note: "rt clones it here when setup runs",
    problem: null,
    then: null,
    oneClick: null,
    segmentRecords: true,
    board,
    awaitsRun: false,
  };
  return { ...base, ...over };
}

/** A repo Install left for the member, as repos.ts emits it: gated until the repo lands. */
function deferredRow(identity: string, detail: string, over: Partial<PlaceRepo>): Row {
  const repo = identity.split("/").pop()!;
  return r(`repos.place:${identity}`, "needs-you", detail, { title: repo, why: "gitlab.com/acme", finishGated: true, waivable: false, action: placeAction(identity, null, { note: detail, ...over }) });
}

function placeRow(identity: string, status: Row["status"], board: string | null = null): Row {
  return r(`repos.place:${identity}`, status, "rt clones it here when setup runs", { title: identity.split("/").pop()!, why: "gitlab.com/acme", action: placeAction(identity, board) });
}

function plan(rows: Row[], team: OrgRef = JOIN): Plan {
  return finalizePlan(team, [{ id: "tools", title: "Tools", rows }], NOW);
}

function prepare(over: Partial<PrepareRecord & { running: boolean }> = {}): PrepareRecord & { running: boolean } {
  return { stage: "macos", startedAt: "2026-10-30T09:50:00.000Z", pid: 4242, items: ["apple-clt"], failed: [], running: true, ...over };
}

function inputs(over: Partial<ThisMacInputs> = {}): ThisMacInputs {
  return {
    path: "join",
    plan: plan([placeRow(WIDGETS, "ready", "The board starts here"), placeRow(ACME_API, "ready")]),
    forge: { provider: "gitlab", host: "gitlab.com" },
    signIn: [],
    ranOk: false,
    cltInstalled: true,
    prepare: null,
    backup: undefined,
    homeRemote: null,
    ghSignedIn: false,
    githubSignIn: null,
    githubReady: false,
    githubStored: false,
    githubClientId: "",
    repoRoot: { configured: null, staged: null, candidate: "/fake-home/Documents/GitHub" },
    ...over,
  };
}

function pick(list: FormRow[], id: string): FormRow {
  const found = list.find((x) => x.id === id);
  if (!found) throw new Error(`no row ${id} in ${list.map((x) => x.id).join(", ")}`);
  return found;
}

function startReady(list: FormRow[]): boolean {
  return allAnswered(list);
}

describe("thisMacRows", () => {
  test("Set up this Mac waits for Command Line Tools on Just me", () => {
    const list = thisMacRows(inputs({ path: "solo", plan: plan([], SOLO), cltInstalled: false, prepare: prepare(), repoRoot: { configured: "/fake-home/code", staged: null, candidate: null } }));
    expect(list[0]).toMatchObject({ id: "tool.clt", state: "busy" });
    expect(startReady(list)).toBe(false);
  });

  test("one row per tracked repo, the board's says the board starts here", () => {
    const list = thisMacRows(inputs());
    expect(list.map((x) => x.id)).toEqual([`repos.place:${WIDGETS}`, `repos.place:${ACME_API}`, "settings.backup"]);
    expect(pick(list, `repos.place:${WIDGETS}`)).toMatchObject({ title: "widgets", subtext: "The board starts here", state: "done", detail: "rt clones it here when setup runs", optional: false });
    expect(pick(list, `repos.place:${WIDGETS}`).action).toEqual(placeAction(WIDGETS, "The board starts here"));
    expect(pick(list, `repos.place:${ACME_API}`)).toMatchObject({ title: "acme-api", subtext: "gitlab.com/acme", state: "done" });
    expect(startReady(list)).toBe(true);
  });

  test("a repo that needs an answer holds Set up this Mac", () => {
    const blocked = placeRow(ACME_API, "needs-you");
    const list = thisMacRows(inputs({ plan: plan([placeRow(WIDGETS, "ready"), blocked]) }));
    expect(pick(list, `repos.place:${ACME_API}`)).toMatchObject({ state: "todo", action: blocked.action });
    expect(startReady(list)).toBe(false);
  });

  test("an answered deferred repo is done and lets Set up this Mac start", () => {
    const answered = deferredRow(ACME_API, "rt clones it to ~/work/acme-api next", { clonePath: "/fake-home/work/acme-api", awaitsRun: true });
    const list = thisMacRows(inputs({ plan: plan([placeRow(WIDGETS, "ready"), answered]) }));
    expect(pick(list, `repos.place:${ACME_API}`)).toMatchObject({ state: "done", detail: "rt clones it to ~/work/acme-api next", action: answered.action });
    expect(startReady(list)).toBe(true);
  });

  test("an unanswered deferred repo holds Set up this Mac", () => {
    const unanswered = deferredRow(ACME_API, "Choose where your repos go", { oneClick: { label: "Clone here", mode: "clone", path: "/fake-home/code/acme-api" } });
    const list = thisMacRows(inputs({ plan: plan([placeRow(WIDGETS, "ready"), unanswered]) }));
    expect(pick(list, `repos.place:${ACME_API}`)).toMatchObject({ state: "todo", action: unanswered.action });
    expect(startReady(list)).toBe(false);
  });

  test("a failed clone holds Set up this Mac with its Retry", () => {
    const failure = "The last clone failed: fatal: repository not found (git exited 128)";
    const failed = deferredRow(ACME_API, failure, { problem: failure, oneClick: { label: "Retry", mode: "clone", path: "/fake-home/work/acme-api" } });
    const list = thisMacRows(inputs({ plan: plan([placeRow(WIDGETS, "ready"), failed]) }));
    const row = pick(list, `repos.place:${ACME_API}`);
    expect(row).toMatchObject({ state: "todo", detail: failure });
    expect(row.action).toMatchObject({ oneClick: { label: "Retry" } });
    expect(startReady(list)).toBe(false);
  });

  test("settings default to this Mac and are done", () => {
    const settings = pick(thisMacRows(inputs()), "settings.backup");
    expect(settings).toMatchObject({
      title: "Your settings",
      subtext: "mattstack keeps your settings in one folder. A private remote copy lets you restore them on a new Mac. You can turn this on later",
      state: "done",
      detail: "Keep on this Mac",
      optional: false,
    });
    expect(settings.action).toEqual({
      type: "choose",
      label: "Change",
      verb: ["setup", "home-backup"],
      options: [
        { id: "local", label: "Keep on this Mac", detail: "" },
        { id: "remote", label: "Store in a remote repo", detail: "" },
      ],
      selected: "local",
    });
  });

  test("choosing a remote adds the repo row until one is set or staged", () => {
    const chosen = thisMacRows(inputs({ backup: { mode: "remote" } }));
    expect(chosen.map((x) => x.id).slice(-2)).toEqual(["settings.backup", "settings.remote"]);
    expect(pick(chosen, "settings.backup").action).toMatchObject({ selected: "remote" });
    expect(pick(chosen, "settings.remote")).toMatchObject({
      title: "Remote repo",
      subtext: "Where the private copy lives",
      state: "todo",
      action: {
        type: "form",
        label: "Use this repo",
        verb: ["home", "remote", "set"],
        fields: [{ name: "url", label: "Repo URL", secret: false, hint: "git@github.com:janedoe/mattstack-home.git" }],
      },
    });
    expect(startReady(chosen)).toBe(false);

    const url = "git@github.com:janedoe/mattstack-home.git";
    const staged = thisMacRows(inputs({ backup: { mode: "remote", url }, homeRemote: url }));
    expect(pick(staged, "settings.remote")).toMatchObject({ state: "done", detail: url, action: null });
    expect(startReady(staged)).toBe(true);

    const create = thisMacRows(inputs({ backup: { mode: "remote", create: true } }));
    expect(pick(create, "settings.remote")).toMatchObject({ state: "done", action: null });
    expect(startReady(create)).toBe(true);

    expect(thisMacRows(inputs({ backup: { mode: "local" }, homeRemote: url })).some((x) => x.id === "settings.remote")).toBe(false);
  });

  test("Create a private GitHub repo is a one-press run with a gh sign-in, else the URL form", () => {
    const remoteAction = (ghSignedIn: boolean) => pick(thisMacRows(inputs({ backup: { mode: "remote" }, ghSignedIn })), "settings.remote").action;
    expect(remoteAction(true)).toEqual({ type: "run", label: "Create a private GitHub repo", verb: ["setup", "home-backup", "remote"] });
    expect(remoteAction(false)).toEqual({
      type: "form",
      label: "Use this repo",
      verb: ["home", "remote", "set"],
      fields: [{ name: "url", label: "Repo URL", secret: false, hint: "git@github.com:janedoe/mattstack-home.git" }],
    });
  });

  test("solo asks where new clones go, starting at the found folder", () => {
    const solo = (repoRoot: ThisMacInputs["repoRoot"]) => thisMacRows(inputs({ path: "solo", plan: plan([], SOLO), repoRoot }));
    const empty = solo({ configured: null, staged: null, candidate: "/fake-home/Documents/GitHub" });
    expect(empty.map((x) => x.id)).toEqual(["repos.root", "settings.backup"]);
    expect(pick(empty, "repos.root")).toMatchObject({
      title: "Repos go in",
      subtext: "Where new clones go",
      state: "todo",
      action: { type: "choose-folder", label: "Choose…", startAt: "/fake-home/Documents/GitHub" },
    });
    expect(startReady(empty)).toBe(false);
    expect(pick(empty, "settings.backup").title).toBe("Back up home");

    expect(pick(solo({ configured: null, staged: "/fake-home/code", candidate: null }), "repos.root")).toMatchObject({ state: "done", detail: "/fake-home/code" });
    expect(pick(solo({ configured: "/fake-home/src", staged: null, candidate: null }), "repos.root")).toMatchObject({ state: "done", detail: "/fake-home/src" });
  });

  test("before any run, rows a run sets up stay off this screen", () => {
    const shell = r("tool.shell", "needs-you", "rt does not recognize your shell", { finishGated: true, waivable: false, action: SHELL_RECHECK });
    const list = thisMacRows(inputs({ plan: plan([placeRow(WIDGETS, "ready"), shell]) }));
    expect(list.some((x) => x.id === "tool.shell")).toBe(false);
  });

  test("a row the run could not set up comes back here with its own action", () => {
    const shell = r("tool.shell", "needs-you", "rt does not recognize your shell", { finishGated: true, waivable: false, action: SHELL_RECHECK });
    const list = thisMacRows(inputs({ ranOk: true, plan: plan([placeRow(WIDGETS, "ready"), shell]) }));
    expect(list.at(-1)).toMatchObject({ id: "tool.shell", state: "todo", detail: "rt does not recognize your shell", action: SHELL_RECHECK, optional: false });
    expect(startReady(list)).toBe(false);
  });

  test("a staged remote that never took a push comes back with its own Push", () => {
    const backup = r("home.backup", "needs-you", "Remote set, nothing pushed yet", { required: false, finishGated: true, waivable: false, action: HOME_BACKUP_PUSH_ACTION });
    const list = thisMacRows(inputs({ ranOk: true, backup: { mode: "remote", url: "git@github.com:janedoe/mattstack-home.git", appliedAt: "2026-10-30T09:00:00.000Z" }, homeRemote: "git@github.com:janedoe/mattstack-home.git", plan: plan([placeRow(WIDGETS, "ready"), backup]) }));
    expect(pick(list, "home.backup")).toMatchObject({ state: "todo", detail: "Remote set, nothing pushed yet", action: HOME_BACKUP_PUSH_ACTION });
    expect(startReady(list)).toBe(false);
  });

  test("a sign-in tool the connect screen draws never comes back here", () => {
    const sdm = r("tool.team.sdm", "missing", "sdm is not installed", { finishGated: true, waivable: false, action: { type: "install", label: "Install", tool: "sdm", via: "brew" }, waitsForInstall: true });
    const list = thisMacRows(inputs({ ranOk: true, signIn: [{ name: "sdm", why: "", connect: { integration: "sdm" } }], plan: plan([placeRow(WIDGETS, "ready"), sdm]) }));
    expect(list.some((x) => x.id === "tool.team.sdm")).toBe(false);
  });
});

describe("composeForm", () => {
  const NO_SECRETS = { has: async () => null, hasAdmin: async () => null, ownAgeKey: async () => null };
  const MAC_ANSWERS: Record<string, string> = { sw_vers: "26.0", uname: "arm64", rt: "rt 2.30.0" };
  const exec = (argv: string[]) => (MAC_ANSWERS[argv[0]!] ? { code: 0, stdout: MAC_ANSWERS[argv[0]!]!, stderr: "" } : { code: 127, stdout: "", stderr: "" });

  test("a solo Mac with nothing installed waits for git and asks where new clones go", async () => {
    const p = fakeProbes({ home: "/fake-home", now: NOW, dirs: { "/fake-home/code": [] }, exec });
    const form = await composeForm(p, { sections: ["this-mac"], secrets: NO_SECRETS, orgs: [] });
    const list = form.sections.thisMac ?? [];
    expect(list.map((x) => [x.id, x.state])).toEqual([
      ["tool.clt", "todo"],
      ["repos.root", "todo"],
      ["settings.backup", "done"],
    ]);
    expect(pick(list, "repos.root").action).toEqual({ type: "choose-folder", label: "Choose…", startAt: "/fake-home/code" });
    expect(form.startReady).toBe(false);
  });

  test("a url staged before the home repo has an origin counts as set", async () => {
    const url = "git@github.com:janedoe/mattstack-home.git";
    const p = fakeProbes({
      home: "/fake-home",
      now: NOW,
      dirs: { "/fake-home/.mattstack/user/.git": [] },
      files: { "/fake-home/.mattstack/rt/setup-state.json": JSON.stringify({ homeBackup: { mode: "remote", url } }) },
      exec,
    });
    const form = await composeForm(p, { sections: ["this-mac"], secrets: NO_SECRETS, orgs: [] });
    expect(pick(form.sections.thisMac ?? [], "settings.remote")).toMatchObject({ state: "done", detail: url });
  });
});

describe("the remote repo row signs in to GitHub", () => {
  const remote = (over: Partial<ThisMacInputs>) => pick(thisMacRows(inputs({ backup: { mode: "remote" }, githubClientId: "acme-client", ...over })), "settings.remote");
  const SIGN_IN = ["setup", "github", "sign-in"];
  const live = { userCode: "ABCD-1234", url: "https://github.com/login/device", expiresAt: "2026-10-30T10:10:00.000Z", pid: 4242 };

  test("a staged url or create is done and shows no action", () => {
    expect(remote({ homeRemote: "git@github.com:janedoe/mattstack-home.git" })).toMatchObject({ state: "done", detail: "git@github.com:janedoe/mattstack-home.git", action: null });
    expect(remote({ backup: { mode: "remote", create: true } })).toMatchObject({ state: "done", detail: "rt creates it as a private repo when setup runs", action: null });
  });

  test("a live sign-in waits with its code and an Open again button", () => {
    expect(remote({ githubSignIn: live })).toMatchObject({
      state: "waiting",
      detail: "Your code is ABCD-1234. Confirm it in your browser",
      action: { type: "open-url", label: "Open again", url: "https://github.com/login/device" },
      watch: true,
    });
  });

  test("an expired or declined record offers the sign-in again", () => {
    expect(remote({ githubSignIn: { ...live, outcome: "expired" } })).toMatchObject({
      state: "todo",
      detail: "That code expired. Sign in again",
      action: { type: "run", label: "Sign in to GitHub", verb: SIGN_IN },
    });
    expect(remote({ githubSignIn: { ...live, outcome: "declined" } })).toMatchObject({ state: "todo", detail: "GitHub sign-in was declined. Sign in again" });
  });

  test("an outcome record without a client id leaves the URL form", () => {
    expect(remote({ githubClientId: "", githubSignIn: { ...live, outcome: "expired" } })).toMatchObject({ detail: "", action: { type: "form", verb: ["home", "remote", "set"] } });
  });

  test("with a client id and nothing else the row offers Sign in to GitHub", () => {
    expect(remote({})).toMatchObject({
      state: "todo",
      detail: "",
      subtext: "Opens your browser once. rt then makes a private repo for you",
      action: { type: "run", label: "Sign in to GitHub", verb: SIGN_IN },
    });
  });

  test("without a client id the URL form stays", () => {
    expect(remote({ githubClientId: "" })).toMatchObject({ state: "todo", action: { type: "form", verb: ["home", "remote", "set"] } });
  });

  test("a token or gh that can already create the repo skips the sign-in", () => {
    for (const over of [{ githubReady: true }, { ghSignedIn: true }]) {
      expect(remote(over)).toMatchObject({
        state: "todo",
        detail: "",
        action: { type: "run", label: "Create a private GitHub repo", verb: ["setup", "home-backup", "remote"] },
      });
    }
  });

  test("a stored token that cannot create repos gets the URL form, never the sign-in", () => {
    expect(remote({ githubStored: true })).toMatchObject({ state: "todo", detail: "", action: { type: "form", verb: ["home", "remote", "set"] } });
    expect(remote({ githubStored: true, githubSignIn: { ...live, outcome: "expired" } })).toMatchObject({ action: { type: "form" } });
  });

  test("a live sign-in outranks a ready token", () => {
    expect(remote({ githubSignIn: live, githubReady: true })).toMatchObject({ state: "waiting" });
  });
});

describe("the form reads the GitHub sign-in", () => {
  const NO_SECRETS = { has: async () => null, hasAdmin: async () => null, ownAgeKey: async () => null };
  const MAC_ANSWERS: Record<string, string> = { sw_vers: "26.0", uname: "arm64", rt: "rt 2.30.0" };
  const exec = (argv: string[]) => (MAC_ANSWERS[argv[0]!] ? { code: 0, stdout: MAC_ANSWERS[argv[0]!]!, stderr: "" } : { code: 127, stdout: "", stderr: "" });
  const stateFile = (homeBackup: object) => ({ "/fake-home/.mattstack/rt/setup-state.json": JSON.stringify({ homeBackup }) });
  const scopes = (granted: string): Probes["fetch"] => async () => ({ status: 200, body: '{"login":"janedoe"}', headers: { "x-oauth-scopes": granted } });
  const remoteOf = async (homeBackup: object, fetch: Probes["fetch"], githubToken: () => Promise<string | null>) => {
    const p = fakeProbes({ home: "/fake-home", now: NOW, files: stateFile(homeBackup), exec, fetch });
    const form = await composeForm(p, { sections: ["this-mac"], secrets: NO_SECRETS, orgs: [], githubToken });
    return (form.sections.thisMac ?? []).find((x) => x.id === "settings.remote");
  };

  test("a stored token that can create repos makes the row offer the create", async () => {
    const row = await remoteOf({ mode: "remote" }, scopes("repo, read:org"), async () => "tok");
    expect(row?.action).toMatchObject({ type: "run", verb: ["setup", "home-backup", "remote"] });
  });

  test("with a client id, a stored narrow token gets the URL form and no stored token gets the sign-in", async () => {
    const p = (fetch: Probes["fetch"]) => fakeProbes({ home: "/fake-home", now: NOW, files: stateFile({ mode: "remote" }), exec, fetch });
    const narrow = await composeForm(p(scopes("read:org")), { sections: ["this-mac"], secrets: NO_SECRETS, orgs: [], githubToken: async () => "tok", githubClientId: "acme-client" });
    expect(pick(narrow.sections.thisMac ?? [], "settings.remote").action).toMatchObject({ type: "form", verb: ["home", "remote", "set"] });
    const none = await composeForm(p(scopes("repo")), { sections: ["this-mac"], secrets: NO_SECRETS, orgs: [], githubToken: async () => null, githubClientId: "acme-client" });
    expect(pick(none.sections.thisMac ?? [], "settings.remote").action).toMatchObject({ type: "run", verb: ["setup", "github", "sign-in"] });
  });

  test("a token without repo scope gets the URL form, and no token gets the sign-in", async () => {
    const narrow = await remoteOf({ mode: "remote" }, scopes("read:org"), async () => "tok");
    expect(narrow?.action).toMatchObject({ type: "form", verb: ["home", "remote", "set"] });
    const none = await remoteOf({ mode: "remote" }, scopes("repo"), async () => null);
    expect(none?.action).toMatchObject({ type: "run", verb: ["setup", "github", "sign-in"] });
  });

  test("a live sign-in or a gh sign-in skips the store and the network", async () => {
    let reads = 0;
    const token = async () => {
      reads++;
      return "tok";
    };
    const live = { userCode: "ABCD-1234", url: "https://github.com/login/device", expiresAt: "2026-10-30T10:10:00.000Z", pid: null };
    const files = { ...stateFile({ mode: "remote" }), "/fake-home/.mattstack/rt/logins/github.json": JSON.stringify(live) };
    const liveProbes = fakeProbes({ home: "/fake-home", now: NOW, files, exec, fetch: scopes("repo") });
    const liveForm = await composeForm(liveProbes, { sections: ["this-mac"], secrets: NO_SECRETS, orgs: [], githubToken: token });
    expect(pick(liveForm.sections.thisMac ?? [], "settings.remote").state).toBe("waiting");

    const ghPlan = plan([r("account.github", "ready", "Signed in through the gh CLI as janedoe")]);
    const ghProbes = fakeProbes({ home: "/fake-home", now: NOW, files: stateFile({ mode: "remote" }), exec, fetch: scopes("repo") });
    const ghForm = await composeForm(ghProbes, { sections: ["this-mac"], secrets: NO_SECRETS, orgs: [], githubToken: token, plan: async () => ghPlan });
    expect(pick(ghForm.sections.thisMac ?? [], "settings.remote").action).toMatchObject({ type: "run", verb: ["setup", "home-backup", "remote"] });

    expect(reads).toBe(0);
    expect(liveProbes.calls.fetch).toEqual([]);
    expect(ghProbes.calls.fetch).toEqual([]);
  });

  test("the store is not read when a create or url is staged, or the backup is local", async () => {
    let reads = 0;
    const token = async () => {
      reads++;
      return "tok";
    };
    await remoteOf({ mode: "remote", create: true }, scopes("repo"), token);
    await remoteOf({ mode: "remote", url: "git@github.com:janedoe/mattstack-home.git" }, scopes("repo"), token);
    await remoteOf({ mode: "local" }, scopes("repo"), token);
    expect(reads).toBe(0);
  });
});
