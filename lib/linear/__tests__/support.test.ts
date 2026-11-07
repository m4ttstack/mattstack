import { describe, expect, test } from "bun:test";
import { createSupportIssue, LinearSupportError, renderSupportBody, type SupportIssueInput } from "../support.ts";

const input: SupportIssueInput = {
  kind: "bug",
  title: "Board crashes",
  problem: "It crashes on open.",
  idea: "Guard the null.",
  acceptance: ["opens", "no crash"],
  source: { person: "Sam", date: "2026-11-06", room: "#help" },
};

type Call = { body: any; headers: any };

function fakeFetch(responses: unknown[], calls: Call[] = []): typeof fetch {
  let i = 0;
  return (async (_url: unknown, init: any) => {
    calls.push({ body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify(responses[i++]), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("support client", () => {
  test("renderSupportBody matches the section order", () => {
    const body = renderSupportBody(input);
    const order = ["## Problem", "## Fix", "## Acceptance", "## Source"].map((h) => body.indexOf(h));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body).toContain("- opens");
    expect(body).toContain("Bug report from a Slack chat with Sam in #help on 2026-11-06");
    expect(renderSupportBody({ ...input, kind: "feature" })).toContain("Feature request from a Slack chat");
  });

  test("a 400 with an errors body carries Linear's message", async () => {
    const f = (async () => new Response(JSON.stringify({ errors: [{ message: "bad input" }] }), { status: 400 })) as unknown as typeof fetch;
    const err = await createSupportIssue(input, { apiKey: "k", fetchImpl: f }).catch((e) => e);
    expect(err).toBeInstanceOf(LinearSupportError);
    expect(err.message).toBe("bad input");
  });

  test("a non-JSON body throws LinearSupportError", async () => {
    const f = (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch;
    const err = await createSupportIssue(input, { apiKey: "k", fetchImpl: f }).catch((e) => e);
    expect(err).toBeInstanceOf(LinearSupportError);
    expect(err.message).toBe("Linear API 502");
  });

  test("issueCreate sends the rendered body and returns identifier, title, url", async () => {
    const calls: Call[] = [];
    const f = fakeFetch(
      [
        { data: { teams: { nodes: [{ id: "team-1" }] } } },
        { data: { issueCreate: { success: true, issue: { identifier: "SUPPORT-7", title: "Board crashes", url: "https://linear.app/x/SUPPORT-7" } } } },
      ],
      calls,
    );
    const out = await createSupportIssue(input, { apiKey: "k", fetchImpl: f });
    expect(out).toEqual({ id: "SUPPORT-7", title: "Board crashes", url: "https://linear.app/x/SUPPORT-7" });
    expect(calls[1]!.body.variables.input.teamId).toBe("team-1");
    expect(calls[1]!.body.variables.input.description).toBe(renderSupportBody(input));
    expect(calls[1]!.headers.Authorization).toBe("k");
  });

  test("a key that sees no team, or more than one, is refused before any issue is made", async () => {
    for (const [nodes, count] of [[[], "no team"], [[{ id: "team-1" }, { id: "team-2" }], "2 teams"]] as const) {
      const calls: Call[] = [];
      const err = await createSupportIssue(input, { apiKey: "k", fetchImpl: fakeFetch([{ data: { teams: { nodes } } }], calls) }).catch((e) => e);
      expect(err).toBeInstanceOf(LinearSupportError);
      expect(err.message).toContain(count);
      expect(calls).toHaveLength(1);
    }
  });

  test("a GraphQL error throws LinearSupportError with Linear's message", async () => {
    const f = fakeFetch([{ errors: [{ message: "nope nope" }] }]);
    const err = await createSupportIssue(input, { apiKey: "secret-key", fetchImpl: f }).catch((e) => e);
    expect(err).toBeInstanceOf(LinearSupportError);
    expect(err.message).toContain("nope nope");
    expect(err.message).not.toContain("secret-key");
  });

  test("a timeout throws LinearSupportError", async () => {
    const f = (async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as typeof fetch;
    const err = await createSupportIssue(input, { apiKey: "k", fetchImpl: f }).catch((e) => e);
    expect(err).toBeInstanceOf(LinearSupportError);
  });
});
