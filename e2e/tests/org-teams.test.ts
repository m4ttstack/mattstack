import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { createTestHome, rt } from "../harness.ts";

let home = "";
let cleanup = () => {};

function org(): string {
  return join(home, ".mattstack", "orgs", "acme");
}

function write(rel: string, value: unknown, root = org()): void {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

function identifyAs(username: string): void {
  write(join("rt", "teams", "acme.json"), { forgeUsername: username }, join(home, ".mattstack"));
}

async function json(args: string[]): Promise<Record<string, unknown>> {
  const out = await rt([...args, "--json"], { home });
  expect(out.exitCode).toBe(0);
  expect(out.stderr).toBe("");
  return JSON.parse(out.stdout) as Record<string, unknown>;
}

async function get(key: string): Promise<unknown> {
  const out = await json(["settings", "get", key]);
  expect(out.ok).toBe(true);
  expect(out.key).toBe(key);
  return out.value;
}

beforeEach(() => {
  const made = createTestHome();
  home = made.path;
  cleanup = made.cleanup;
  write("mattstack/mattstack.jsonc", { role: "org", org: "acme" });
  write("mattstack/org/settings.org.jsonc", {
    "board.gitlabHost": "gitlab.example.com",
    "board.title": "Acme",
    "claude.plugins": ["acme-tools@acme"],
    "mattstack.roster": [
      { username: "dev1", teams: ["widgets"] },
      { username: "dev2", teams: ["gadgets"] },
      { username: "dev3", teams: ["widgets", "gadgets"] },
    ],
    "mattstack.org": {
      admins: ["dev1"],
      teams: { widgets: { owners: ["dev1"] }, gadgets: { owners: ["dev2"] } },
    },
  });
  write("mattstack/teams/widgets/settings.team.jsonc", { "board.title": "Widgets", "claude.plugins": ["widgets@acme"] });
  write("mattstack/teams/gadgets/settings.team.jsonc", { "board.title": "Gadgets" });
});

afterEach(() => cleanup());

describe("an org with two teams", () => {
  test("each member reads the org layer plus their own team's", async () => {
    identifyAs("dev1");
    expect(await get("board.title")).toBe("Widgets");
    expect(await get("board.gitlabHost")).toBe("gitlab.example.com");
    expect(await get("claude.plugins")).toEqual(["acme-tools@acme", "widgets@acme"]);

    identifyAs("dev2");
    expect(await get("board.title")).toBe("Gadgets");
    expect(await get("claude.plugins")).toEqual(["acme-tools@acme"]);
  });

  test("a member on both starts on their first team, and the active team setting switches them", async () => {
    identifyAs("dev3");
    expect(await get("board.title")).toBe("Widgets");

    const chosen = await rt(["settings", "set", "mattstack.activeTeam", '"gadgets"', "--scope", "user"], { home });
    expect(chosen.exitCode).toBe(0);
    expect(await get("board.title")).toBe("Gadgets");
    expect(await json(["team", "status"])).toMatchObject({ activeTeam: "gadgets", teams: ["widgets", "gadgets"] });

    expect((await rt(["settings", "set", "mattstack.activeTeam", '"sprockets"', "--scope", "user"], { home })).exitCode).toBe(0);
    expect(await get("board.title")).toBe("Widgets");
    expect((await rt(["settings", "unset", "mattstack.activeTeam", "--scope", "user"], { home })).exitCode).toBe(0);
    expect(await get("board.title")).toBe("Widgets");
  });

  test("an owner writes their own team and is refused another team and the org; a member writes nothing shared", async () => {
    identifyAs("dev2");
    expect((await rt(["settings", "set", "board.title", '"Gadgets 2"', "--scope", "team"], { home })).exitCode).toBe(0);
    expect(await get("board.title")).toBe("Gadgets 2");

    const files = ["mattstack/org/settings.org.jsonc", "mattstack/teams/widgets/settings.team.jsonc", "mattstack/teams/gadgets/settings.team.jsonc"];
    const before = files.map((file) => readFileSync(join(org(), file), "utf8"));
    const other = await rt(["settings", "set", "board.title", '"x"', "--scope", "team", "--team", "widgets"], { home });
    expect(other.exitCode).not.toBe(0);
    expect(other.stderr).toContain("The widgets team's files belong to its owners");
    const shared = await rt(["settings", "set", "board.gitlabHost", '"x"', "--scope", "org"], { home });
    expect(shared.exitCode).not.toBe(0);
    expect(shared.stderr).toContain("The org's shared files belong to its admins");

    identifyAs("dev3");
    const member = await rt(["settings", "set", "board.title", '"x"', "--scope", "team"], { home });
    expect(member.exitCode).not.toBe(0);
    expect(member.stderr).toContain("The widgets team's files belong to its owners");
    expect(files.map((file) => readFileSync(join(org(), file), "utf8"))).toEqual(before);
  });

  test("explain names the org layer and the team layer apart", async () => {
    identifyAs("dev1");
    const out = await json(["settings", "explain", "board.title"]);
    const rows = out.rows as { scope: string; present: boolean }[];
    expect(rows.filter((row) => row.present).map((row) => row.scope)).toEqual(["org", "team"]);
  });

  test("status reports the role and the teams", async () => {
    identifyAs("dev1");
    expect(await json(["team", "status"])).toMatchObject({
      contract: 1,
      slug: "acme",
      role: "admin",
      activeTeam: "widgets",
      teams: ["widgets"],
      orgTeams: ["gadgets", "widgets"],
    });
  });
});
