import { beforeEach, describe, expect, test } from "bun:test";
import { settingsHandler, viewerFrom, type RtSettingsApi, type ViewerWire } from "../server.ts";

const DEFS = {
  "board.slack": { key: "board.slack", type: "string", scopes: ["team", "org", "user", "machine"], merge: "replace", description: "Slack" },
  "rt.worktrees": { key: "rt.worktrees", type: "string", scopes: ["org", "team", "user", "machine"], merge: "replace", description: "Pool", repoScoped: true },
};

const explainCalls: unknown[] = [];
const setCalls: unknown[][] = [];

const RT = {
  allDefs: () => Object.values(DEFS),
  getDef: (key: string) => DEFS[key as keyof typeof DEFS],
  isMigrated: () => true,
  explainSetting: (key: string, opts?: { repoIdentity?: string | null; team?: string | null }) => {
    explainCalls.push({ key, ...opts });
    const team = opts?.team ?? "widgets";
    return [
      { scope: "org", file: "/org", present: true, value: "org-value" },
      { scope: "team", file: `/teams/${team}`, present: true, value: `${team}-value` },
      { scope: "user", file: "/user", present: true, value: "my-value" },
      { scope: "machine", file: "/machine", present: false },
    ];
  },
  validateValue: () => ({ ok: true }),
  validateWrite: () => ({ ok: true }),
  setSetting: (...args: unknown[]) => {
    setCalls.push(args);
  },
  unsetSetting: () => true,
  pruneStoreName: () => ({ removed: true }),
  listUnregisteredSettings: () => [],
  repoSectionsFor: (_key: string, view?: { team?: string | null }) =>
    view?.team === "gadgets" ? [{ identity: "gitlab.example.com/acme/web", scopes: ["team", "user"] }] : [],
  listStoreRepoIdentities: () => [],
  listOrgs: () => ["acme"],
  activeTeam: () => ({ org: "acme", team: "widgets", reason: "first-team", username: "sam", listedOn: ["widgets"] }),
} as unknown as RtSettingsApi;

const ADMIN: ViewerWire = { username: "sam", name: "Sam Rivera", role: "admin", team: "widgets", teams: ["gadgets", "sprockets", "widgets"] };
const MEMBER: ViewerWire = { username: "sam", name: "Sam Rivera", role: "member", team: "widgets", teams: ["widgets"] };

function handle(req: Request, viewer: ViewerWire = ADMIN) {
  return settingsHandler(req, { rt: { ...RT, viewer: () => viewer } });
}

const get = (path: string) => new Request(`http://console.mattstack${path}`);
const post = (path: string, body: unknown) =>
  new Request(`http://console.mattstack${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

type DefsBody = { defs: Array<{ key: string; effective: { scope: string | null; value?: unknown }; repos?: unknown[] }>; viewer: ViewerWire; viewing: string | null; activeTeam: string | null };

beforeEach(() => {
  explainCalls.length = 0;
  setCalls.length = 0;
});

describe("viewing another team", () => {
  test("defs reads your own team by default, keeps your layers, and names who you are", async () => {
    const body = (await (await handle(get("/api/settings/defs")))!.json()) as DefsBody;
    expect(body.viewer).toEqual(ADMIN);
    expect(body.viewing).toBe("widgets");
    expect(body.activeTeam).toBe("widgets");
    expect(body.defs.find((d) => d.key === "board.slack")!.effective).toMatchObject({ scope: "user", value: "my-value" });
  });

  test("defs?team= reads that team's store and leaves out your user and machine layers", async () => {
    const body = (await (await handle(get("/api/settings/defs?team=gadgets")))!.json()) as DefsBody;
    expect(body.viewing).toBe("gadgets");
    expect(body.activeTeam).toBe("widgets");
    expect(body.defs.find((d) => d.key === "board.slack")!.effective).toMatchObject({ scope: "team", value: "gadgets-value" });
    expect(explainCalls).toContainEqual(expect.objectContaining({ key: "board.slack", team: "gadgets" }));
    expect(body.defs.find((d) => d.key === "rt.worktrees")!.repos).toEqual([{ identity: "gitlab.example.com/acme/web", scopes: ["team"] }]);
  });

  test("naming your own team changes nothing", async () => {
    const body = (await (await handle(get("/api/settings/defs?team=widgets")))!.json()) as DefsBody;
    expect(body.viewing).toBe("widgets");
    expect(body.defs.find((d) => d.key === "board.slack")!.effective).toMatchObject({ scope: "user" });
  });

  test("a team you may not view is refused", async () => {
    const res = (await handle(get("/api/settings/defs?team=gadgets"), MEMBER))!;
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("gadgets");
    expect((await handle(get("/api/settings/explain/board.slack?team=gadgets"), MEMBER))!.status).toBe(403);
  });

  test("explain?team= drops your layers from the rows", async () => {
    const body = (await (await handle(get("/api/settings/explain/board.slack?team=gadgets")))!.json()) as { rows: Array<{ scope: string }> };
    expect(body.rows.map((r) => r.scope)).toEqual(["org", "team"]);
  });

  test("a write naming another team goes to that team and reads back as it", async () => {
    const res = (await handle(post("/api/settings/set", { key: "board.slack", scope: "team", team: "gadgets", value: "x" })))!;
    expect(res.status).toBe(200);
    expect(setCalls).toEqual([["board.slack", "x", "team", { team: "gadgets" }]]);
    const body = (await res.json()) as { rows: Array<{ scope: string }>; effective: { scope: string } };
    expect(body.rows.map((r) => r.scope)).toEqual(["org", "team"]);
    expect(body.effective.scope).toBe("team");
  });

  test("a write naming a team you may not view is refused before rt sees it", async () => {
    const res = (await handle(post("/api/settings/set", { key: "board.slack", scope: "team", team: "gadgets", value: "x" }), MEMBER))!;
    expect(res.status).toBe(403);
    expect(setCalls).toEqual([]);
  });

  test("while viewing another team, your own layers cannot be written", async () => {
    const res = (await handle(post("/api/settings/set", { key: "board.slack", scope: "user", team: "gadgets", value: "x" })))!;
    expect(res.status).toBe(400);
    expect(setCalls).toEqual([]);
  });
});

describe("viewerFrom", () => {
  const roles = { admins: ["ada"], teams: { gadgets: { owners: ["sam"] }, sprockets: { owners: [] } } };
  const roster = [{ username: "Sam", name: "Sam Rivera", teams: ["widgets"] }, { username: "ada", name: "Ada" }];
  const folders = ["gadgets", "sprockets", "widgets"];
  const active = { org: "acme", team: "widgets", reason: "first-team" as const, username: "sam", listedOn: ["widgets"] };

  test("an owner may view the teams they own and their own", () => {
    expect(viewerFrom({ active, roles, roster, folders })).toEqual({ username: "sam", name: "Sam Rivera", role: "owner", team: "widgets", teams: ["gadgets", "widgets"] });
  });

  test("an admin may view every team folder", () => {
    expect(viewerFrom({ active: { ...active, username: "ada" }, roles, roster, folders })).toMatchObject({ role: "admin", name: "Ada", teams: folders });
  });

  test("a member sees only their own team", () => {
    expect(viewerFrom({ active: { ...active, username: "bo" }, roles, roster, folders })).toMatchObject({ role: "member", name: null, teams: ["widgets"] });
  });

  test("with no forge username the role is unknown and there is no name", () => {
    expect(viewerFrom({ active: { ...active, username: null }, roles, roster, folders })).toMatchObject({ role: "unknown", name: null, username: null, teams: ["widgets"] });
  });

  test("with no org there is nothing to view", () => {
    expect(viewerFrom({ active: { org: null, team: null, reason: "no-org", username: null, listedOn: [] }, roles, roster, folders })).toEqual({ username: null, name: null, role: "none", team: null, teams: [] });
  });
});
