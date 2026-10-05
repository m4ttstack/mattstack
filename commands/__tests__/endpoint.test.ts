import { describe, expect, test } from "bun:test";
import { buildLookupOutput, parseEndpointLookupArgs, parseEndpointReleaseArgs } from "../endpoint.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";

describe("parseEndpointReleaseArgs", () => {
  test("worktree first, no role", () => {
    expect(parseEndpointReleaseArgs(["/path/wt"])).toEqual({ worktree: "/path/wt", role: undefined, roleInvalid: false });
  });

  test("--json before the worktree, no role", () => {
    expect(parseEndpointReleaseArgs(["--json", "/path/wt"])).toEqual({ worktree: "/path/wt", role: undefined, roleInvalid: false });
  });

  test("worktree then --role", () => {
    expect(parseEndpointReleaseArgs(["/path/wt", "--role", "web"])).toEqual({ worktree: "/path/wt", role: "web", roleInvalid: false });
  });

  test("--role before the worktree", () => {
    expect(parseEndpointReleaseArgs(["--role", "web", "/path/wt"])).toEqual({ worktree: "/path/wt", role: "web", roleInvalid: false });
  });

  test("--role with no following value is flagged invalid, not treated as omitted", () => {
    expect(parseEndpointReleaseArgs(["/path/wt", "--role"])).toEqual({
      worktree: "/path/wt",
      role: undefined,
      roleInvalid: true,
    });
  });

  test("--role followed by --json (option-like) is flagged invalid, not treated as a role value", () => {
    expect(parseEndpointReleaseArgs(["/path/wt", "--role", "--json"])).toEqual({
      worktree: "/path/wt",
      role: undefined,
      roleInvalid: true,
    });
  });
});

describe("parseEndpointLookupArgs", () => {
  test("role only", () => {
    expect(parseEndpointLookupArgs(["backend"])).toEqual({ role: "backend", path: undefined, pathInvalid: false });
  });

  test("--json is not a role", () => {
    expect(parseEndpointLookupArgs(["--json", "backend"])).toEqual({ role: "backend", path: undefined, pathInvalid: false });
  });

  test("--path before the role", () => {
    expect(parseEndpointLookupArgs(["--path", "/wt/seamus", "backend"])).toEqual({
      role: "backend",
      path: "/wt/seamus",
      pathInvalid: false,
    });
  });

  test("--path after the role", () => {
    expect(parseEndpointLookupArgs(["backend", "--path", "/wt/seamus"])).toEqual({
      role: "backend",
      path: "/wt/seamus",
      pathInvalid: false,
    });
  });

  test("inline --path=<dir> is accepted, before or after the role", () => {
    expect(parseEndpointLookupArgs(["backend", "--path=/wt/seamus"])).toEqual({
      role: "backend",
      path: "/wt/seamus",
      pathInvalid: false,
    });
    expect(parseEndpointLookupArgs(["--path=/wt/seamus", "backend"])).toEqual({
      role: "backend",
      path: "/wt/seamus",
      pathInvalid: false,
    });
  });

  test("inline --path= with an empty value is flagged invalid, not treated as omitted", () => {
    expect(parseEndpointLookupArgs(["backend", "--path="])).toEqual({ role: "backend", path: undefined, pathInvalid: true });
  });

  test("--path with no following value is flagged invalid, not treated as omitted", () => {
    expect(parseEndpointLookupArgs(["backend", "--path"])).toEqual({ role: "backend", path: undefined, pathInvalid: true });
  });

  test("--path followed by --json (option-like) is flagged invalid, not treated as a path value", () => {
    expect(parseEndpointLookupArgs(["backend", "--path", "--json"])).toEqual({
      role: "backend",
      path: undefined,
      pathInvalid: true,
    });
  });
});

describe("buildLookupOutput", () => {
  const ctx = { role: "portal", repoName: "repo-tools", toplevel: "/wt/seamus", indexPath: "/repo/main" };
  const base = { claimed: true, port: 4001, url: "http://localhost:4001", running: true };

  test("running and owned: json carries worktree with main:false, plain names the worktree, no warnings", () => {
    const data = {
      ...base,
      worktree: { path: "/wt/seamus", name: "seamus" },
      listener: { pid: 55, command: "node", cwd: "/wt/seamus/apps/web", ownsClaim: true },
    };
    const { payload, blocks } = buildLookupOutput(data, ctx);
    expect(payload).toMatchObject({ ok: true, claimed: true, port: 4001, worktree: { path: "/wt/seamus", name: "seamus", main: false } });
    const plain = renderPlain(blocks);
    expect(plain).toContain("[running] http://localhost:4001  running");
    expect(plain).toContain("worktree: seamus");
    expect(plain).not.toContain("is held outside this worktree");
    expect(plain).not.toContain("[warning] This is the main checkout");
  });

  test("a foreign listener is called out, loudly", () => {
    const data = {
      ...base,
      worktree: { path: "/wt/seamus", name: "seamus" },
      listener: { pid: 99, command: "node", cwd: "/wt/dobby", ownsClaim: false },
    };
    const { payload, blocks } = buildLookupOutput(data, ctx);
    expect(payload).toMatchObject({ listener: { pid: 99, ownsClaim: false } });
    const plain = renderPlain(blocks);
    expect(plain).toContain("[warning] Port 4001 is held outside this worktree  pid 99, node");
    expect(plain).toContain("pid 99");
    expect(plain).toContain("[failed] http://localhost:4001  another process holds this port");
  });

  test("an unattributable listener is flagged as unverified, not as foreign", () => {
    const data = {
      ...base,
      worktree: { path: "/wt/seamus", name: "seamus" },
      listener: { pid: 99, command: "node", cwd: null, ownsClaim: null },
    };
    const plain = renderPlain(buildLookupOutput(data, ctx).blocks);
    expect(plain).toContain("[warning] rt could not tell which worktree owns port 4001  pid 99, node");
    expect(plain).not.toContain("is held outside this worktree");
  });

  test("running via pid with nothing listening reads as not listening yet", () => {
    const data = { ...base, worktree: { path: "/wt/seamus", name: null }, listener: null };
    const plain = renderPlain(buildLookupOutput(data, ctx).blocks);
    expect(plain).toContain("[not yet] http://localhost:4001  the process is up but not listening yet");
    expect(plain).toContain("worktree: seamus");
  });

  test("invoked from the canonical main checkout: json main:true and a plain warning", () => {
    const mainCtx = { ...ctx, toplevel: "/repo/main" };
    const data = { ...base, worktree: { path: "/repo/main", name: null }, listener: null };
    const { payload, blocks } = buildLookupOutput(data, mainCtx);
    expect(payload).toMatchObject({ worktree: { path: "/repo/main", name: null, main: true } });
    expect(renderPlain(blocks)).toContain("[warning] This is the main checkout\n");
  });

  test("an old daemon response without worktree/listener still renders, worktree from the CLI's own resolution", () => {
    const { payload, blocks } = buildLookupOutput({ ...base, running: false }, ctx);
    expect(payload).toMatchObject({ worktree: { path: "/wt/seamus", name: null, main: false }, listener: null });
    const plain = renderPlain(blocks);
    expect(plain).toContain("[off] http://localhost:4001  claimed, not running");
    expect(plain).toContain("worktree: seamus");
  });

  test("no claim: plain says so and still reports worktree context", () => {
    const data = { claimed: false, port: null, url: null, running: false, worktree: { path: "/wt/seamus", name: "seamus" }, listener: null };
    const { payload, blocks } = buildLookupOutput(data, ctx);
    expect(payload).toMatchObject({ claimed: false, worktree: { path: "/wt/seamus", name: "seamus", main: false } });
    const plain = renderPlain(blocks);
    expect(plain).toContain("[off] No claim for the portal role  repo-tools");
    expect(plain).toContain("worktree: seamus");
  });
});

test("a listener in an unrelated directory is only identified as outside this worktree", () => {
  const data = {
    claimed: true, port: 4001, url: "http://localhost:4001", running: true,
    worktree: { path: "/wt/seamus", name: "seamus" },
    listener: { pid: 99, command: "node", cwd: "/unrelated/server", ownsClaim: false },
  };
  const { payload, blocks } = buildLookupOutput(data, { role: "web", repoName: "repo-tools", toplevel: "/wt/seamus", indexPath: "/repo/main" });
  expect(payload).toEqual({ ok: true, ...data, worktree: { path: "/wt/seamus", name: "seamus", main: false } });
  expect(renderPlain(blocks)).toContain("[warning] Port 4001 is held outside this worktree  pid 99, node");
  expect(renderPlain(blocks)).not.toContain("another worktree");
});
