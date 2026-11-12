import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as linearModule from "../../linear.ts";
import { createDiscussionsFileStore } from "../discussions-file-store.ts";
import { refreshDiscussions } from "../discussions-store.ts";
import { createProjectMRs } from "../project-mrs-store.ts";
import { openStateDb } from "../../state/index.ts";
import type { HandlerContext } from "../handlers/types.ts";
import { fakeStore } from "./fake-cache-store.ts";

const tmpDb = () => openStateDb(join(mkdtempSync(join(tmpdir(), "rt-dnf-")), "state.db"), "cli");

type Notified = { category: string; title: string; message: string; url?: string };

function ownPrCtx(forge: "gitlab" | "github"): Pick<HandlerContext, "cache" | "repoIndex"> {
  return {
    cache: fakeStore({
      feat: { repoName: "repo", mr: { iid: 5, webUrl: "http://w/5", status: "open", author: { id: `${forge}:user:42` } }, ticket: null, linearId: "", fetchedAt: 0 } as any,
    }),
    repoIndex: () => ({}),
  };
}

const note = (id: number, author: { id: string; username: string; bot?: boolean }) =>
  ({ id, system: false, body: `n${id}`, createdAt: "2026-11-11T00:00:00Z", author: { name: author.username, avatarUrl: null, ...author } });

async function secondFetchAdds(forge: "gitlab" | "github", added: ReturnType<typeof note>[]) {
  const fileStore = createDiscussionsFileStore(tmpDb());
  const notified: Notified[] = [];
  const broadcasts: Array<{ type: string; data: any }> = [];
  const deps = { ctx: ownPrCtx(forge), broadcast: (type: string, data: any) => { broadcasts.push({ type, data }); } };
  const first = [note(1, { id: `${forge}:user:7`, username: "luke" })];
  const overrides = {
    fileStore,
    projectStore: createProjectMRs(tmpDb()),
    currentUserId: 42,
    forge,
    notify: (category: string, title: string, message: string, url?: string) => { notified.push({ category, title, message, url }); },
  };
  await refreshDiscussions(deps, "repo", 5, { ...overrides, fetchDiscussions: async () => [{ id: "d1", notes: first } as any] });
  const res = await refreshDiscussions(deps, "repo", 5, {
    ...overrides,
    fetchDiscussions: async () => [{ id: "d1", notes: [...first, ...added] } as any],
  });
  return { res, notified, newComments: broadcasts.find((b) => b.type === "discussions:new-comments")?.data };
}

describe("new-comment notifications follow the forge", () => {
  test("GitHub: own, bot and teammate comments on my PR notify once for the teammate, titled #5", async () => {
    const { res, notified, newComments } = await secondFetchAdds("github", [
      note(2, { id: "github:user:42", username: "me" }),
      note(3, { id: "github:user:99", username: "renovate[bot]", bot: true }),
      note(4, { id: "github:user:7", username: "luke" }),
    ]);
    expect(res.newNotes.map((n) => n.noteId)).toEqual([4]);
    expect(notified).toEqual([{ category: "new_comment", title: "New comment on #5", message: "@luke: n4", url: "http://w/5" }]);
    expect(newComments.mrTitle).toBe("#5");
  });

  test("GitHub: a deleted user's comment notifies without a crash", async () => {
    const { res, notified } = await secondFetchAdds("github", [note(2, { id: "github:user:ghost", username: "ghost", bot: false })]);
    expect(res.newNotes.map((n) => n.authorUser)).toEqual(["ghost"]);
    expect(notified.map((n) => n.title)).toEqual(["New comment on #5"]);
  });

  test("GitHub: a diff comment sharing its id with an earlier pull request comment still notifies", async () => {
    const fileStore = createDiscussionsFileStore(tmpDb());
    const notified: Notified[] = [];
    const deps = { ctx: ownPrCtx("github"), broadcast: () => {} };
    const overrides = {
      fileStore,
      projectStore: createProjectMRs(tmpDb()),
      currentUserId: 42,
      forge: "github" as const,
      notify: (category: string, title: string, message: string, url?: string) => { notified.push({ category, title, message, url }); },
    };
    const general = { id: "gh-issue-comment-30", notes: [note(30, { id: "github:user:7", username: "luke" })] } as any;
    await refreshDiscussions(deps, "repo", 5, { ...overrides, fetchDiscussions: async () => [general] });
    const res = await refreshDiscussions(deps, "repo", 5, {
      ...overrides,
      fetchDiscussions: async () => [general, { id: "gh-review-thread-30", notes: [note(30, { id: "github:user:7", username: "luke" })] } as any],
    });
    expect(res.newNotes.map((n) => n.noteId)).toEqual([30]);
    expect(notified.map((n) => n.title)).toEqual(["New comment on #5"]);
  });

  test("GitLab: the same shape still titles !5", async () => {
    const { res, notified, newComments } = await secondFetchAdds("gitlab", [
      note(2, { id: "gitlab:user:42", username: "me" }),
      note(3, { id: "gitlab:user:99", username: "project_12_bot_abc" }),
      note(4, { id: "gitlab:user:7", username: "luke" }),
    ]);
    expect(res.newNotes.map((n) => n.noteId)).toEqual([4]);
    expect(notified).toEqual([{ category: "new_comment", title: "New comment on !5", message: "@luke: n4", url: "http://w/5" }]);
    expect(newComments.mrTitle).toBe("!5");
  });
});

describe("refreshDiscussions on a GitHub repo, end to end", () => {
  let spies: { mockRestore(): void }[] = [];
  afterEach(() => { for (const s of spies) s.mockRestore(); spies = []; });

  test("reads the PR's threads by owner/name, reads /user once across two refreshes, stores the result", async () => {
    const path = realpathSync(mkdtempSync(join(tmpdir(), "rt-dnf-repo-")));
    execFileSync("git", ["init", "-q"], { cwd: path, stdio: "pipe" });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/widgets.git"], { cwd: path, stdio: "pipe" });
    const repoName = "discussions-notify-forge-repo";

    const paths: string[] = [];
    const issueComment = {
      id: 501, body: "looks good", created_at: "2026-11-11T00:00:00Z", html_url: "https://github.com/acme/widgets/pull/5#issuecomment-501",
      user: { id: 7, login: "luke", avatar_url: null, type: "User" },
    };
    spies = [
      spyOn(linearModule, "loadSecrets").mockImplementation((async () => ({ githubToken: "ghp_notify_forge" })) as never),
      spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        paths.push(url.pathname);
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
        if (url.host !== "api.github.com") return json({ message: "Not Found" }, 404);
        switch (url.pathname) {
          case "/user": return json({ id: 42, login: "me" });
          case "/repos/acme/widgets/issues/5/comments": return json([issueComment]);
          case "/repos/acme/widgets/pulls/5/comments":
          case "/repos/acme/widgets/pulls/5/reviews": return json([]);
          default: return json({ message: "Not Found" }, 404);
        }
      }) as typeof fetch),
    ];

    const fileStore = createDiscussionsFileStore(tmpDb());
    const deps = {
      ctx: { cache: fakeStore({}), repoIndex: () => ({ [repoName]: path }) },
      broadcast: () => {},
    };
    const overrides = { fileStore, projectStore: createProjectMRs(tmpDb()), notify: () => {} };
    await refreshDiscussions(deps, repoName, 5, overrides);
    await refreshDiscussions(deps, repoName, 5, overrides);

    const count = (p: string) => paths.filter((x) => x === p).length;
    expect(count("/repos/acme/widgets/pulls/5/comments")).toBe(2);
    expect(count("/repos/acme/widgets/issues/5/comments")).toBe(2);
    expect(count("/repos/acme/widgets/pulls/5/reviews")).toBe(2);
    expect(count("/user")).toBe(1);
    expect(paths.filter((p) => p.startsWith("/repositories"))).toEqual([]);
    expect(paths.length).toBe(7);

    const stored = fileStore.read(repoName, 5)!;
    expect(stored.discussions.map((d) => d.id)).toEqual(["gh-issue-comment-501"]);
    expect(stored.discussions[0]!.notes[0]!.author.id).toBe("github:user:7");
  });
});
