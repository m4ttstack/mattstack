import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import type { Probes } from "../../setup/probes.ts";
import { UserActionableError } from "../../errors.ts";
import { createForgeRepo } from "../create-repo.ts";

type Reply = { status: number; body: string };
type Fetch = (url: string, init?: Parameters<Probes["fetch"]>[1]) => Reply;

function probes(answer: Fetch) {
  return fakeProbes({ home: "/home/x", fetch: async (url, init) => ({ ...answer(url, init), headers: {} }) });
}

const json = (status: number, body: unknown): Reply => ({ status, body: JSON.stringify(body) });

async function failure(run: Promise<unknown>): Promise<UserActionableError> {
  try {
    await run;
  } catch (err) {
    if (err instanceof UserActionableError) return err;
    throw err;
  }
  throw new Error("expected a UserActionableError");
}

const GITLAB = { provider: "gitlab" as const, host: "gitlab.example.com", namespace: "acme/widgets", name: "mattstack-team-acme", token: "glpat-sekrit", login: "janedoe" };
const GITHUB = { provider: "github" as const, host: "github.com", name: "mattstack-team-acme", token: "ghp_sekrit", login: "janedoe" };

describe("createForgeRepo", () => {
  test("GitLab creates a private project under the group", async () => {
    const p = probes((url, init) => {
      if (url === "https://gitlab.example.com/api/v4/namespaces/acme%2Fwidgets" && (init?.method ?? "GET") === "GET") return json(200, { id: 42, full_path: "acme/widgets" });
      if (url === "https://gitlab.example.com/api/v4/projects" && init?.method === "POST") return json(201, { http_url_to_repo: "https://gitlab.example.com/acme/widgets/mattstack-team-acme.git" });
      return json(500, {});
    });

    expect(await createForgeRepo(p, GITLAB)).toEqual({ remote: "https://gitlab.example.com/acme/widgets/mattstack-team-acme.git" });
    const create = p.calls.fetchInits.find((c) => c.url.endsWith("/projects"))!;
    expect(create.init?.headers).toMatchObject({ "PRIVATE-TOKEN": "glpat-sekrit", "Content-Type": "application/json" });
    expect(JSON.parse(create.init!.body!)).toEqual({ name: "mattstack-team-acme", path: "mattstack-team-acme", namespace_id: 42, visibility: "private" });
    expect(p.calls.fetchInits[0]!.init?.headers).toMatchObject({ "PRIVATE-TOKEN": "glpat-sekrit" });
  });

  test("GitHub creates under the member's own account or an org", async () => {
    const answer: Fetch = (url) => (url === "https://api.github.com/user/repos" || url === "https://api.github.com/orgs/acme/repos" ? json(201, { clone_url: url.includes("/orgs/") ? "https://github.com/acme/mattstack-team-acme.git" : "https://github.com/janedoe/mattstack-team-acme.git" }) : json(500, {}));

    const own = probes(answer);
    expect(await createForgeRepo(own, { ...GITHUB, namespace: "JaneDoe" })).toEqual({ remote: "https://github.com/janedoe/mattstack-team-acme.git" });
    expect(own.calls.fetchInits.map((c) => [c.init?.method, c.url])).toEqual([["POST", "https://api.github.com/user/repos"]]);
    expect(JSON.parse(own.calls.fetchInits[0]!.init!.body!)).toEqual({ name: "mattstack-team-acme", private: true });
    expect(own.calls.fetchInits[0]!.init?.headers).toMatchObject({ Authorization: "Bearer ghp_sekrit" });

    const org = probes(answer);
    expect(await createForgeRepo(org, { ...GITHUB, namespace: "acme" })).toEqual({ remote: "https://github.com/acme/mattstack-team-acme.git" });
    expect(org.calls.fetchInits.map((c) => [c.init?.method, c.url])).toEqual([["POST", "https://api.github.com/orgs/acme/repos"]]);
    expect(JSON.parse(org.calls.fetchInits[0]!.init!.body!)).toEqual({ name: "mattstack-team-acme", private: true });
  });

  test("a name already taken says so with the way out", async () => {
    const gitlab = probes((url) => (url.includes("/namespaces/") ? json(200, { id: 42 }) : json(400, { message: { name: ["has already been taken"], path: ["has already been taken"] } })));
    const taken = await failure(createForgeRepo(gitlab, GITLAB));
    expect(taken.code).toBe("create-repo-exists");
    expect(taken.message).toBe("GitLab already has a repo with this team's name");
    expect(taken.why).toBe("It is https://gitlab.example.com/acme/widgets/mattstack-team-acme.git. Point rt at it instead of creating a new one.");
    expect(taken.next).toBe("rt team create <name> --remote <its url>");

    const github = probes(() => json(422, { message: "Repository creation failed.", errors: [{ resource: "Repository", code: "custom", field: "name", message: "name already exists on this account" }] }));
    const takenOnGithub = await failure(createForgeRepo(github, { ...GITHUB, namespace: "acme" }));
    expect(takenOnGithub.code).toBe("create-repo-exists");
    expect(takenOnGithub.message).toBe("GitHub already has a repo with this team's name");
    expect(takenOnGithub.why).toBe("It is https://github.com/acme/mattstack-team-acme.git. Point rt at it instead of creating a new one.");
    expect(takenOnGithub.next).toBe("rt team create <name> --remote <its url>");
  });

  test("a group the token cannot see is named", async () => {
    const gitlab = probes(() => ({ status: 404, body: '{"message":"404 Namespace Not Found","see":"https://gitlab.example.com/help glpat-sekrit"}' }));
    const unseen = await failure(createForgeRepo(gitlab, GITLAB));
    expect(unseen.code).toBe("create-repo-failed");
    expect(unseen.message).toBe("This token cannot see acme/widgets on GitLab");
    expect(gitlab.calls.fetch).toHaveLength(1);
    expect(unseen.log).toContain("404");
    expect(unseen.log).not.toContain("https://gitlab.example.com/help");
    expect(unseen.log).not.toContain("glpat-sekrit");

    const github = probes(() => json(404, { message: "Not Found" }));
    const unseenOrg = await failure(createForgeRepo(github, { ...GITHUB, namespace: "acme" }));
    expect(unseenOrg.code).toBe("create-repo-failed");
    expect(unseenOrg.message).toBe("This token cannot see acme on GitHub");
  });

  test("GitHub refuses any host but github.com before the token leaves", async () => {
    const p = probes(() => json(201, { clone_url: "https://github.com/acme/mattstack-team-acme.git" }));
    const refused = await failure(createForgeRepo(p, { ...GITHUB, host: "gitlab.com", namespace: "acme" }));
    expect(refused.code).toBe("create-repo-host-mismatch");
    expect(p.calls.fetch).toEqual([]);
  });

  test("any other answer is a failed create with the forge's words in the log", async () => {
    const github = probes(() => json(401, { message: "Bad credentials", documentation_url: "https://docs.github.com/rest" }));
    const denied = await failure(createForgeRepo(github, { ...GITHUB, namespace: "janedoe" }));
    expect(denied.code).toBe("create-repo-failed");
    expect(denied.message).toBe("GitHub did not create the team repo");
    expect(denied.log).toContain("Bad credentials");
    expect(denied.log).not.toContain("https://docs.github.com/rest");

    const offline = probes(() => ({ status: 0, body: "" }));
    expect((await failure(createForgeRepo(offline, { ...GITHUB, namespace: "janedoe" }))).message).toBe("rt could not reach GitHub to create the team repo");
  });
});
