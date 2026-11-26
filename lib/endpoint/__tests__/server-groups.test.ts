import { expect, test } from "bun:test";
import type { EnrichedBranch, MRInfo } from "../../enrich.ts";
import type { LinearTicket } from "../../linear.ts";
import { groupServers, mrText, serverMatch } from "../server-groups.ts";
import type { RunningServer } from "../servers.ts";

function server(role: string, tree: string, branch: string | null, over: Partial<RunningServer> = {}): RunningServer {
  return {
    role, port: 10400, listening: true, worktree: { path: `/trees/${tree}`, name: tree }, branch,
    pid: 10, pids: [10], startTime: "Tue Nov 24 14:45:47 2026", etime: "18:00:00", leftBehind: false, agent: null, inside: null, removed: false, ...over,
  };
}

function ticket(identifier: string, title: string, stateName = "In Progress"): LinearTicket {
  return { id: identifier, identifier, title, description: null, url: `https://linear.app/x/issue/${identifier}`, stateName, stateColor: "#f2c94c", branchName: null };
}

function mr(iid: number, title: string, over: Partial<MRInfo> = {}): MRInfo {
  return {
    provider: "gitlab", iid, title, webUrl: null, state: "opened", isDraft: false,
    author: { id: "u1", name: "a", avatarUrl: null }, assignees: [], createdAt: null, sourceBranch: "b", targetBranch: "main",
    behindTarget: null, diff: null, pipeline: null, reviews: [], sha: "abc123", ...over,
  } as unknown as MRInfo;
}

function enriched(...rows: Array<{ tree: string; branch: string; linearId?: string; ticket?: LinearTicket; mr?: MRInfo }>): Map<string, EnrichedBranch> {
  return new Map(rows.map((r) => [`/trees/${r.tree}`, {
    path: `/trees/${r.tree}`, dirName: r.tree, branch: r.branch, linearId: r.linearId ?? null, ticket: r.ticket ?? null, mr: r.mr ?? null,
  }]));
}

const LOGIN = [server("web", "calm-marble", "web-214-login-rate-limit"), server("api", "calm-marble", "web-214-login-rate-limit")];
const FORMS = [
  server("web", "old-pond", "web-240-shell"),
  server("api", "new-hill", "web-240-forms"),
  server("api", "old-pond", "web-240-shell"),
];

test("servers of one ticket on one branch are one group, its MR on the group", () => {
  const groups = groupServers(LOGIN, enriched({
    tree: "calm-marble", branch: "web-214-login-rate-limit", linearId: "WEB-214", ticket: ticket("WEB-214", "Add a login rate limit"), mr: mr(412, "Rate limit logins"),
  }));
  expect(groups).toEqual([expect.objectContaining({
    key: "WEB-214", ticketId: "WEB-214", title: "Add a login rate limit", detached: false, mr: expect.objectContaining({ iid: 412 }),
  })]);
  expect(groups[0]!.servers.map((r) => [r.server.role, r.branch, r.mr])).toEqual([["api", null, null], ["web", null, null]]);
});

test("one ticket on two branches is one group, branch and MR on the rows", () => {
  const groups = groupServers(FORMS, enriched(
    { tree: "old-pond", branch: "web-240-shell", linearId: "WEB-240", ticket: ticket("WEB-240", "Split the settings page"), mr: mr(420, "Shell") },
    { tree: "new-hill", branch: "web-240-forms", linearId: "WEB-240", ticket: ticket("WEB-240", "Split the settings page"), mr: mr(423, "Forms") },
  ));
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({ title: "Split the settings page", mr: null });
  expect(groups[0]!.servers.map((r) => [r.branch, r.mr?.iid])).toEqual([["web-240-forms", 423], ["web-240-shell", 420], ["web-240-shell", 420]]);
});

test("before enrichment the ticket id comes from the branch, and the title is the branch", () => {
  expect(groupServers(LOGIN, new Map())[0]).toMatchObject({ key: "WEB-214", ticketId: "WEB-214", ticket: null, title: "web-214-login-rate-limit", mr: null });
});

test("with several branches and no ticket yet, the title is the ticket id", () => {
  const groups = groupServers(FORMS, new Map());
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({ key: "WEB-240", title: "WEB-240" });
});

test("a ticket found on only one of its branches still titles the group", () => {
  const groups = groupServers(FORMS, enriched({ tree: "old-pond", branch: "web-240-shell", linearId: "WEB-240", ticket: ticket("WEB-240", "Split the settings page") }));
  expect(groups[0]!.title).toBe("Split the settings page");
});

test("a ticket id found only in the MR title groups by that ticket", () => {
  const groups = groupServers([server("api", "calm-marble", "export-retry")], enriched({
    tree: "calm-marble", branch: "export-retry", linearId: "WEB-250", ticket: ticket("WEB-250", "Retry exports"), mr: mr(430, "WEB-250: retry exports"),
  }));
  expect(groups.map((g) => [g.key, g.title])).toEqual([["WEB-250", "Retry exports"]]);
});

test("a word in an MR title that is no ticket groups nothing", () => {
  const groups = groupServers([server("api", "calm-marble", "fix-encoding"), server("api", "tall-fern", "hash-check")], enriched(
    { tree: "calm-marble", branch: "fix-encoding", linearId: "UTF-8", mr: mr(501, "Read files as UTF-8") },
    { tree: "tall-fern", branch: "hash-check", linearId: "UTF-8", mr: mr(502, "Log UTF-8 names") },
  ));
  expect(groups.map((g) => [g.key, g.ticketId, g.title])).toEqual([
    ["fix-encoding", null, "Read files as UTF-8"],
    ["hash-check", null, "Log UTF-8 names"],
  ]);
});

test("no ticket: the MR's title, else the branch", () => {
  const groups = groupServers([server("api", "calm-marble", "export-retry"), server("api", "sample-app", "main")], enriched(
    { tree: "calm-marble", branch: "export-retry", mr: mr(430, "Retry the export job on timeout") },
    { tree: "sample-app", branch: "main" },
  ));
  expect(groups.map((g) => [g.key, g.ticketId, g.title])).toEqual([
    ["export-retry", null, "Retry the export job on timeout"],
    ["main", null, "main"],
  ]);
});

test("a detached worktree groups by itself under its own name", () => {
  const groups = groupServers([server("api", "slow-comet", null), server("api", "tall-fern", null)], new Map());
  expect(groups.map((g) => [g.key, g.title, g.detached, g.servers.length])).toEqual([
    ["/trees/slow-comet", "slow-comet", true, 1],
    ["/trees/tall-fern", "tall-fern", true, 1],
  ]);
});

test("a removed worktree with no branch groups under its own name, and is not called detached", () => {
  const groups = groupServers([server("api", "slow-comet", null, { removed: true })], new Map());
  expect(groups.map((g) => [g.title, g.detached])).toEqual([["slow-comet", false]]);
});

test("groups run oldest server first, rows by branch then role", () => {
  const at = (startTime: string) => ({ startTime });
  const groups = groupServers([
    server("api", "main-tree", "main", at("Wed Nov 25 09:00:00 2026")),
    server("web", "calm-marble", "web-214-login", at("Tue Nov 24 14:00:00 2026")),
    server("api", "calm-marble", "web-214-login", at("Tue Nov 24 16:00:00 2026")),
    server("api", "old-pond", "web-240-shell", at("Wed Nov 25 08:00:00 2026")),
    server("api", "new-hill", "web-240-forms", at("Sun Nov 22 08:00:00 2026")),
    server("api", "red-kite", "web-198-order-totals", at("Mon Nov 23 12:00:00 2026")),
  ], new Map());
  expect(groups.map((g) => g.key)).toEqual(["WEB-240", "WEB-198", "WEB-214", "main"]);
  expect(groups[2]!.servers.map((r) => r.server.role)).toEqual(["api", "web"]);
});

test("the filter text holds role, port, worktree, ticket, state, title, branch, MR title and MR state", () => {
  const [group] = groupServers([server("api", "red-kite", "web-198-order-totals")], enriched({
    tree: "red-kite", branch: "web-198-order-totals", linearId: "WEB-198",
    ticket: ticket("WEB-198", "Fix rounding in order totals", "Done"), mr: mr(398, "Fix totals", { state: "merged" }),
  }));
  expect(serverMatch(group!, group!.servers[0]!)).toBe("api :10400 red-kite WEB-198 Done Fix rounding in order totals web-198-order-totals Fix totals merged");
});

test("a row of a ticket on several branches is filtered by its own branch and MR", () => {
  const [group] = groupServers(FORMS, enriched(
    { tree: "old-pond", branch: "web-240-shell", linearId: "WEB-240", mr: mr(420, "Shell") },
    { tree: "new-hill", branch: "web-240-forms", linearId: "WEB-240", mr: mr(423, "Forms", { state: "closed" }) },
  ));
  expect(serverMatch(group!, group!.servers[0]!)).toEndWith("web-240-forms Forms closed");
});

test("a server with no port is filtered by the words its row shows", () => {
  const [group] = groupServers([server("api", "calm-marble", "web-231-search", { port: null })], new Map());
  expect(serverMatch(group!, group!.servers[0]!)).toStartWith("api no port calm-marble WEB-231 ");
});

test("an MR reads in the words rt cd uses", () => {
  expect(mrText(mr(412, "x", { pipeline: { status: "success" } as MRInfo["pipeline"] }))).toBe("!412 open  checks passed");
  expect(mrText(mr(398, "x", { state: "merged", pipeline: { status: "success" } as MRInfo["pipeline"] }))).toBe("!398 merged");
});
