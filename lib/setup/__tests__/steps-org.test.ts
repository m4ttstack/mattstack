import { publishTeam } from "../../team/publish.ts";
import { stageSecret } from "../staging.ts";
import { describe, expect, test } from "bun:test";
import type { SecretsSeams } from "../../secrets/store.ts";
import type { RelayClient } from "../../team/relay-client.ts";
import type { ApplyContext } from "../apply.ts";
import type { Probes } from "../probes.ts";
import { readTeamLocal, teamLocalPath } from "../../team/team-local.ts";
import { cloneSlugs, orgPullStep, teamIdentityStep, recordForgeIdentity } from "../steps/org.ts";
import { fakeProbes as baseFakeProbes } from "./fakes.ts";

function fakeProbes(opts: Parameters<typeof baseFakeProbes>[0] = {}) {
  return baseFakeProbes({ ...opts, exec: (argv, execOpts) => {
    if (argv.includes("get-url")) return { code: 0, stdout: "https://github.com/acme/org.git\n", stderr: "" };
    return opts.exec?.(argv, execOpts) ?? { code: 0, stdout: "", stderr: "" };
  } });
}

const fakeSecrets: SecretsSeams = {
  ageKeySeam: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
  execSeam: {
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    fileExists: () => false,
    statFile: () => null,
    readFile: () => "",
    writeFile: () => {},
    ensureDir: () => {},
    chmod: () => {},
    fsyncAndRename: () => {},
    removeFile: () => {},
  },
};

const fakeRelay: RelayClient = {
  create: async () => ({ id: "", creatorSecret: "" }),
  fetch: async () => "gone",
  redeem: async () => "already",
  reply: async () => {},
  readReply: async () => "none",
  delete: async () => {},
};

function makeCtx(p: Probes, overrides: Partial<ApplyContext> = {}): { ctx: ApplyContext; logs: { id: string; line: string }[] } {
  const logs: { id: string; line: string }[] = [];
  const ctx: ApplyContext = {
    p,
    emit: () => {},
    log(id, line) {
      logs.push({ id, line });
    },
    intent: null,
    team: { slug: "", name: "", mode: "none" },
    snapshot: null,
    reqs: [],
    nonInteractive: false,
    teamOfOne: false,
    appPath: null,
    ci: false,
    secrets: fakeSecrets,
    teamSecrets: () => fakeSecrets,
    relay: fakeRelay,
    secretPresence: { has: async () => null },
    redact: () => {},
    async need() {
      return "no-app";
    },
    ...overrides,
  };
  return { ctx, logs };
}

const HOME = "/h";
const CLONE = `${HOME}/.mattstack/teams/acme`;
const gitConfig = (remote: string) => `[remote "origin"]\n\turl = ${remote}\n`;
// The fake lists a folder only when `dirs` names it; it does not infer one from the files under it.
const TEAMS_DIR = { [`${HOME}/.mattstack/teams`]: ["acme", "notes"] };

describe("org.pull", () => {
  test("pulls every clone that is a git repo, even one still on the old layout", async () => {
    const pulled: string[] = [];
    const p = fakeProbes({
      home: HOME,
      dirs: TEAMS_DIR,
      files: {
        [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git"),
        [`${CLONE}/mattstack/settings.team.jsonc`]: "{}",
        [`${HOME}/.mattstack/teams/notes/readme.md`]: "x",
      },
      daemon: async (cmd, payload) => {
        pulled.push(`${cmd} ${(payload as { slug: string }).slug}`);
        return { ok: true, data: { outcome: "fast-forwarded", detail: null } };
      },
    });
    expect(cloneSlugs(p)).toEqual(["acme"]);
    let reloaded = 0;
    const { ctx } = makeCtx(p, {
      reloadTeam: () => {
        reloaded += 1;
      },
    });
    expect(await orgPullStep.run(ctx)).toEqual({ state: "done", detail: "Pulled acme" });
    expect(pulled).toEqual(["team:pull acme"]);
    expect(reloaded).toBe(1);
  });

  const files = { [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git") };
  const pullWith = (daemon: NonNullable<Parameters<typeof fakeProbes>[0]>["daemon"]) => orgPullStep.run(makeCtx(fakeProbes({ home: HOME, dirs: TEAMS_DIR, files, daemon })).ctx);

  test("no clone is a skip, and a stopped daemon is a skip that says so", async () => {
    expect(await orgPullStep.run(makeCtx(fakeProbes({ home: HOME })).ctx)).toEqual({ state: "skipped", detail: "No org on this Mac" });
    expect(await pullWith(async () => null)).toEqual({ state: "skipped", detail: "The rt daemon is not running, so the org is pulled once it is" });
  });

  test("team sync that is off, or has not started for this clone yet, is a skip: Install must not stop on it", async () => {
    const noTeam = async () => ({ ok: false, error: "no team", failure: { code: "no-team", message: "The acme team is not syncing on this Mac" } });
    expect(await pullWith(noTeam)).toEqual({ state: "skipped", detail: "Team sync has not started for acme yet, so it is pulled once it does" });
  });

  test("a pull that could not finish is partial with the reason, never failed", async () => {
    expect(await pullWith(async () => ({ ok: true, data: { outcome: "skipped", detail: "fetch failed: could not resolve host" } }))).toEqual({
      state: "partial",
      detail: "acme was not pulled: fetch failed: could not resolve host",
      remedy: "Run rt team status to see what is in the way",
    });
    expect(await pullWith(async () => ({ ok: true, data: { outcome: "conflict", detail: "mattstack/org/settings.org.jsonc" } }))).toMatchObject({
      state: "partial",
      detail: "acme was not pulled: mattstack/org/settings.org.jsonc",
    });
    expect(await pullWith(async () => ({ ok: false, error: "daemon threw" }))).toMatchObject({ state: "partial", detail: "acme was not pulled: daemon threw" });
  });

  test("an update run gets the same partial: being offline at launch is no reason to notify", async () => {
    const p = fakeProbes({ home: HOME, dirs: TEAMS_DIR, files, daemon: async () => ({ ok: true, data: { outcome: "skipped", detail: "fetch failed: could not resolve host" } }) });
    expect(await orgPullStep.run(makeCtx(p, { update: true }).ctx)).toEqual({
      state: "partial",
      detail: "acme was not pulled: fetch failed: could not resolve host",
      remedy: "Run rt team status to see what is in the way",
    });
  });

  test("an up-to-date clone is done and says so", async () => {
    expect(await pullWith(async () => ({ ok: true, data: { outcome: "up-to-date", detail: null } }))).toEqual({ state: "done", detail: "acme is already up to date" });
  });
});

describe("team.identity", () => {
  const orgFiles = { [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git"), [`${CLONE}/mattstack/org/settings.org.jsonc`]: "{}" };

  test("records the forge login while none is stored", async () => {
    const p = fakeProbes({ home: HOME, files: orgFiles });
    const { ctx } = makeCtx(p, { team: { slug: "acme", name: "Acme", mode: "none" }, identity: { login: async () => "dev1" } });
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "done", detail: "You are dev1" });
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("dev1");
  });

  test("never overwrites a stored username", async () => {
    const p = fakeProbes({ home: HOME, files: { ...orgFiles, [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: "dev1" }) } });
    const { ctx } = makeCtx(p, {
      team: { slug: "acme", name: "Acme", mode: "none" },
      identity: {
        login: async () => {
          throw new Error("must not ask");
        },
      },
    });
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "skipped", detail: "Already recorded" });
  });

  test("an org on no recognized forge records $USER", async () => {
    const p = fakeProbes({ home: HOME, env: { USER: "localdev" }, files: { ...orgFiles, [`${CLONE}/.git/config`]: gitConfig("https://git.example.com/acme/org.git") } });
    const { ctx } = makeCtx(p, {
      team: { slug: "acme", name: "Acme", mode: "none" },
      identity: {
        login: async () => {
          throw new Error("must not ask");
        },
      },
    });
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "done", detail: "You are localdev" });
  });

  test("a recognized forge that will not say who you are needs you, and records nothing", async () => {
    const p = fakeProbes({ home: HOME, files: orgFiles });
    const { ctx } = makeCtx(p, { team: { slug: "acme", name: "Acme", mode: "none" }, identity: { login: async () => null } });
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "needs-you", detail: "rt can't tell who you are on GitHub. Connect your GitHub account in Setup" });
    expect(readTeamLocal(p, "acme").forgeUsername).toBeUndefined();
  });

  test("a clone still on the old layout is identified too, so its admin can push the conversion", async () => {
    const p = fakeProbes({
      home: HOME,
      dirs: TEAMS_DIR,
      files: { [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git"), [`${CLONE}/mattstack/settings.team.jsonc`]: "{}" },
    });
    const { ctx } = makeCtx(p, { identity: { login: async () => "dev1" } });
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "done", detail: "You are dev1" });
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("dev1");
  });

  test("on a clone that is not converted yet, the old store's declared forge decides, so a self-hosted host is not read as no forge", async () => {
    const p = fakeProbes({
      home: HOME,
      dirs: TEAMS_DIR,
      env: { USER: "localdev" },
      files: {
        [`${CLONE}/.git/config`]: gitConfig("https://git.example.com/acme/org.git"),
        [`${CLONE}/mattstack/settings.team.jsonc`]: `// team settings\n${JSON.stringify({ "mattstack.integrations": { forge: { host: "git.example.com", provider: "gitlab" } } })}`,
      },
    });
    const seen: unknown[][] = [];
    const { ctx } = makeCtx(p, {
      identity: {
        token: async (_ctx, host) => {
          seen.push(["token for", host]);
          return "stored-token";
        },
        login: async (_p, provider, host, token) => {
          seen.push([provider, host, token]);
          return "dev1";
        },
      },
    });
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "done", detail: "You are dev1" });
    expect(seen).toEqual([
      ["token for", "git.example.com"],
      ["gitlab", "git.example.com", "stored-token"],
    ]);
    expect(readTeamLocal(p, "acme").forgeUsername).toBe("dev1");
  });

  test("on a clone that is not converted yet, an old store with no usable forge falls back to the remote", async () => {
    for (const declared of [{}, { forge: { host: 7, provider: "gitlab" } }, { forge: { host: "git.example.com", provider: "bitbucket" } }]) {
      const p = fakeProbes({
        home: HOME,
        dirs: TEAMS_DIR,
        env: { USER: "localdev" },
        files: {
          [`${CLONE}/.git/config`]: gitConfig("https://git.example.com/acme/org.git"),
          [`${CLONE}/mattstack/settings.team.jsonc`]: JSON.stringify({ "mattstack.integrations": declared }),
        },
      });
      const { ctx } = makeCtx(p, {
        identity: {
          login: async () => {
            throw new Error("must not ask");
          },
        },
      });
      expect(await teamIdentityStep.run(ctx)).toEqual({ state: "done", detail: "You are localdev" });
    }
  });

  test("on a clone that is not converted yet, the stored token for the clone's own host reaches the lookup", async () => {
    const p = fakeProbes({
      home: HOME,
      dirs: TEAMS_DIR,
      files: { [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git"), [`${CLONE}/mattstack/settings.team.jsonc`]: "{}" },
    });
    const seen: unknown[][] = [];
    const { ctx } = makeCtx(p, {
      identity: {
        token: async (_ctx, host) => {
          seen.push(["token for", host]);
          return "stored-token";
        },
        login: async (_p, provider, host, token) => {
          seen.push([provider, host, token]);
          return "dev1";
        },
      },
    });
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "done", detail: "You are dev1" });
    expect(seen).toEqual([
      ["token for", "github.com"],
      ["github", "github.com", "stored-token"],
    ]);
  });

  test("recording the username finishes a create that was waiting for it: this Mac becomes the org's admin", async () => {
    const p = fakeProbes({
      home: HOME,
      dirs: { ...TEAMS_DIR, [CLONE]: [] },
      files: { ...orgFiles, [teamLocalPath(HOME, "acme")]: JSON.stringify({ creatorPending: { team: "widgets" } }) },
    });
    const { ctx } = makeCtx(p, { team: { slug: "acme", name: "Acme", mode: "none" }, identity: { login: async () => "dev1" } });
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "done", detail: "You are dev1, and this org's admin now" });
    const org = JSON.parse(p.readFile(`${CLONE}/mattstack/org/settings.org.jsonc`)!);
    expect(org["mattstack.org"]).toEqual({ admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } });
    expect(readTeamLocal(p, "acme").creatorPending).toBeUndefined();
    expect(p.calls.exec.some((argv) => argv.includes("push"))).toBe(true);
  });

  test("when that push fails the roles still stand, and the step says what is owed", async () => {
    const p = fakeProbes({
      home: HOME,
      dirs: { ...TEAMS_DIR, [CLONE]: [] },
      files: { ...orgFiles, [teamLocalPath(HOME, "acme")]: JSON.stringify({ creatorPending: { team: "widgets" } }) },
      exec: (argv) => (argv.includes("push") ? { code: 128, stdout: "", stderr: "fatal: Authentication failed" } : { code: 0, stdout: "", stderr: "" }),
    });
    const { ctx } = makeCtx(p, { team: { slug: "acme", name: "Acme", mode: "none" }, identity: { login: async () => "dev1" } });
    expect(await teamIdentityStep.run(ctx)).toEqual({
      state: "partial",
      detail: "You are dev1 and this org's admin now, but rt could not push that",
      remedy: "Run rt team publish",
    });
  });

  test("no org is a skip", async () => {
    expect(await teamIdentityStep.run(makeCtx(fakeProbes({ home: HOME })).ctx)).toEqual({ state: "skipped", detail: "No org on this Mac" });
  });
});

describe("pending admin recovery", () => {
  for (const verb of ["add", "commit"])
    test(`a failed ${verb} keeps the pending claim and retries without looking up a recorded identity`, async () => {
      let fail = true;
      const p = fakeProbes({
        home: HOME,
        dirs: { [CLONE]: [] },
        files: {
          [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git"),
          [`${CLONE}/mattstack/org/settings.org.jsonc`]: "{}",
          [teamLocalPath(HOME, "acme")]: JSON.stringify({ creatorPending: { team: "widgets" } }),
        },
        exec: (argv, opts) => {
          expect(opts?.cwd).toBe(CLONE);
          if (argv[1] === verb && fail) return { code: 128, stdout: "", stderr: "denied" };
          return { code: argv[1] === "diff" ? 1 : 0, stdout: "", stderr: "" };
        },
      });
      const first = await recordForgeIdentity(p, "acme", { provider: "github", host: "github.com" }, "token", async () => "dev1");
      expect(first.admin).toMatchObject({ claimed: true, published: false });
      expect(first.admin?.detail).toBeTruthy();
      expect(readTeamLocal(p, "acme").creatorPending?.team).toBe("widgets");
      fail = false;
      const retry = await recordForgeIdentity(p, "acme", { provider: "github", host: "github.com" }, "token", async () => {
        throw new Error("must not ask again");
      });
      expect(retry).toMatchObject({ outcome: "already", username: "dev1", admin: { claimed: true, published: true } });
      expect(readTeamLocal(p, "acme").creatorPending).toBeUndefined();
      expect(p.calls.exec.some((argv) => argv.includes("push"))).toBe(true);
      expect(p.calls.exec.filter((argv) => argv[1] === "add").every((argv) => argv.join(" ") === "git add -- mattstack/org/settings.org.jsonc")).toBe(true);
    });
  test("another admin remains unchanged", async () => {
    const raw = JSON.stringify({ "mattstack.org": { admins: ["dev2"] } });
    const p = fakeProbes({
      home: HOME,
      files: { [`${CLONE}/mattstack/org/settings.org.jsonc`]: raw, [teamLocalPath(HOME, "acme")]: JSON.stringify({ creatorPending: { team: "widgets" }, forgeUsername: "dev1" }) },
    });
    expect(await recordForgeIdentity(p, "acme", null, null)).toEqual({ username: "dev1", outcome: "already" });
    expect(p.readFile(`${CLONE}/mattstack/org/settings.org.jsonc`)).toBe(raw);
    expect(p.calls.exec).toEqual([]);
  });
  test("an untrusted host never reads a secret", async () => {
    const p = fakeProbes({ home: HOME, dirs: TEAMS_DIR, files: { [`${CLONE}/.git/config`]: gitConfig("https://gitlab.example.com/acme/org.git") } });
    const { ctx } = makeCtx(p, {
      secrets: {
        ...fakeSecrets,
        ageKeySeam: {
          run: async () => {
            throw new Error("must not read a secret");
          },
        },
      },
      identity: {
        login: async (_p, _provider, host, token) => {
          expect(host).toBe("gitlab.example.com");
          expect(token).toBeNull();
          return "dev1";
        },
      },
    });
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "done", detail: "You are dev1" });
  });
  test("a throwing pull is partial and still tries later clones", async () => {
    const pulled: string[] = [];
    const p = fakeProbes({
      home: HOME,
      dirs: { [`${HOME}/.mattstack/teams`]: ["acme", "widgets"] },
      files: {
        [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git"),
        [`${HOME}/.mattstack/teams/widgets/.git/config`]: gitConfig("https://github.com/acme/widgets.git"),
      },
      daemon: async (_cmd, payload) => {
        const slug = (payload as { slug: string }).slug;
        pulled.push(slug);
        if (slug === "acme") throw new Error("offline");
        return { ok: true, data: { outcome: "up-to-date", detail: null } };
      },
    });
    expect(await orgPullStep.run(makeCtx(p).ctx)).toMatchObject({ state: "partial", detail: "widgets is already up to date; acme was not pulled: offline" });
    expect(pulled).toEqual(["acme", "widgets"]);
  });
});

test("identity refreshes the context before later setup steps read the active team's pack", async () => {
  const p = fakeProbes({ home: HOME, dirs: TEAMS_DIR, files: { [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git") } });
  let reloaded = 0;
  const { ctx } = makeCtx(p, {
    reloadTeam: () => {
      expect(readTeamLocal(p, "acme").forgeUsername).toBe("dev1");
      reloaded++;
    },
    identity: { login: async () => "dev1" },
  });
  await teamIdentityStep.run(ctx);
  expect(reloaded).toBe(1);
});

test("a confirmed self-hosted origin uses only this probe home's staged token", async () => {
  const p = fakeProbes({
    home: HOME,
    dirs: TEAMS_DIR,
    files: {
      [`${CLONE}/.git/config`]: gitConfig("https://gitlab.example.com/acme/org.git"),
      [`${HOME}/.mattstack/user/settings.user.jsonc`]: JSON.stringify({ "rt.integrations": { forgeHost: "gitlab.example.com" } }),
    },
  });
  stageSecret(p, "rt", "gitlabToken", "staged-token");
  const { ctx } = makeCtx(p, {
    identity: {
      login: async (_p, provider, host, token) => {
        expect([provider, host, token]).toEqual(["gitlab", "gitlab.example.com", "staged-token"]);
        return "dev1";
      },
    },
  });
  expect(await teamIdentityStep.run(ctx)).toEqual({ state: "done", detail: "You are dev1" });
});
test("a failed push leaves committed roles for ordinary publication recovery", async () => {
  let fail = true;
  const p = fakeProbes({
    home: HOME,
    dirs: { [CLONE]: [] },
    files: {
      [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git"),
      [`${CLONE}/mattstack/org/settings.org.jsonc`]: "{}",
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ creatorPending: { team: "widgets" } }),
    },
    exec: (argv) => ({ code: argv[1] === "diff" ? 1 : argv.includes("push") && fail ? 128 : 0, stdout: "", stderr: "denied" }),
  });
  const claimed = await recordForgeIdentity(p, "acme", { provider: "github", host: "github.com" }, "token", async () => "dev1");
  expect(claimed.admin).toMatchObject({ claimed: true, published: false });
  expect(readTeamLocal(p, "acme").creatorPending).toBeUndefined();
  expect(p.calls.exec.some((argv) => argv[1] === "commit")).toBe(true);
  fail = false;
  await publishTeam(p, "acme", null, { token: "token", tokenRemote: "https://github.com/acme/org.git" });
  expect(p.calls.exec.filter((argv) => argv.includes("push"))).toHaveLength(2);
});

for (const verb of ["add", "commit"])
  test(`identity gives a local role ${verb} failure a retry that commits before publishing`, async () => {
    let fail = true;
    const p = fakeProbes({
      home: HOME,
      dirs: { [CLONE]: [] },
      files: {
        [`${CLONE}/.git/config`]: gitConfig("https://github.com/acme/org.git"),
        [`${CLONE}/mattstack/org/settings.org.jsonc`]: "{}",
        [teamLocalPath(HOME, "acme")]: JSON.stringify({ creatorPending: { team: "widgets" }, forgeUsername: "dev1" }),
      },
      exec: (argv) => ({ code: argv[1] === "diff" ? 1 : argv[1] === verb && fail ? 128 : 0, stdout: "", stderr: "denied" }),
    });
    const { ctx } = makeCtx(p, {
      team: { slug: "acme", name: "Acme", mode: "none" },
      identity: {
        login: async () => {
          throw new Error("must not query a recorded identity");
        },
      },
    });
    expect(await teamIdentityStep.run(ctx)).toEqual({
      state: "partial",
      detail: "You are dev1 and this org's admin now, but rt could not save that",
      remedy: "Run rt setup apply --only team.identity",
    });
    expect(readTeamLocal(p, "acme").creatorPending?.team).toBe("widgets");
    expect(p.calls.exec.some((argv) => argv.includes("push"))).toBe(false);
    fail = false;
    expect(await teamIdentityStep.run(ctx)).toEqual({ state: "done", detail: "You are dev1, and this org's admin now" });
    expect(readTeamLocal(p, "acme").creatorPending).toBeUndefined();
  });
