import { describe, expect, test } from "bun:test";
import { row, type Group } from "../contract.ts";
import { regroupTools } from "../regroup.ts";

const r = (id: string) => row({ id, kind: "tool", title: id, why: "w", required: false, status: "ready", detail: "" });

function plan(toolIds: string[], macIds: string[] = ["perm.fda"]): Group[] {
  return [
    { id: "mac", title: "Your Mac", rows: macIds.map(r) },
    { id: "accounts", title: "Accounts", rows: [r("account.gitlab")] },
    { id: "access", title: "Access", rows: [r("access.team")] },
    { id: "tools", title: "Tools", rows: toolIds.map(r) },
  ];
}

const ids = (groups: Group[], id: string) => groups.find((g) => g.id === id)?.rows.map((x) => x.id);

describe("regroupTools", () => {
  test("splits the tools rows into four named groups, keeping their order", () => {
    const out = regroupTools(plan([
      "tool.herdr", "tool.claude", "tool.fast-browser", "tool.fast-browser-extension", "tool.editor", "tool.chrome",
      "tool.chrome-signin", "tool.proxy", "tool.state-backup", "tool.team.doppler", "tool.plugins", "skills.writing-style",
      "pack.acme", "tool.linear-mcp", "repos.root", "tool.rt", "tool.rt-link", "tool.legacy-dirs", "tool.intercepts",
      "tool.app", "tool.vsix", "tool.extension", "tool.shell", "tool.daemon", "tool.flavor", "home.backup", "team.sync",
      "team.marketplace", "team.one-per-machine", "org.folder", "org.layout", "org.sparse", "org.branch", "board.team-fields",
    ]));
    expect(out.map((g) => [g.id, g.title])).toEqual([
      ["mac", "Your Mac"], ["accounts", "Accounts"], ["access", "Access"],
      ["agents", "Agents and editors"], ["browser", "Browser"], ["rt", "rt on this Mac"], ["team", "Team and backup"],
    ]);
    expect(ids(out, "agents")).toEqual([
      "tool.herdr", "tool.claude", "tool.editor", "tool.plugins", "skills.writing-style", "pack.acme", "tool.linear-mcp",
      "tool.vsix", "tool.extension",
    ]);
    expect(ids(out, "browser")).toEqual(["tool.fast-browser", "tool.fast-browser-extension", "tool.chrome", "tool.chrome-signin"]);
    expect(ids(out, "rt")).toEqual([
      "tool.proxy", "repos.root", "tool.rt", "tool.rt-link", "tool.legacy-dirs", "tool.intercepts", "tool.app",
      "tool.shell", "tool.daemon", "tool.flavor",
    ]);
    expect(ids(out, "team")).toEqual([
      "tool.state-backup", "tool.team.doppler", "home.backup", "team.sync", "team.marketplace", "team.one-per-machine",
      "org.folder", "org.layout", "org.sparse", "org.branch", "board.team-fields",
    ]);
  });

  test("the Mission Control shortcut is a macOS setting, so it joins Your Mac", () => {
    const out = regroupTools(plan(["tool.mission-control", "tool.rt"]));
    expect(ids(out, "mac")).toEqual(["perm.fda", "tool.mission-control"]);
  });

  test("a row no group claims stays under Tools, so nothing is ever dropped", () => {
    const out = regroupTools(plan(["tool.rt", "tools.group-error", "tool.brand-new"]));
    expect(ids(out, "tools")).toEqual(["tools.group-error", "tool.brand-new"]);
    expect(out.map((g) => g.id)).toEqual(["mac", "accounts", "access", "rt", "tools"]);
  });

  test("with no Your Mac group to join, the Mission Control row stays under Tools", () => {
    const out = regroupTools([{ id: "tools", title: "Tools", rows: [r("tool.mission-control"), r("tool.rt")] }]);
    expect(out.map((g) => g.id)).toEqual(["rt", "tools"]);
    expect(ids(out, "tools")).toEqual(["tool.mission-control"]);
  });

  test("an empty group is left out", () => {
    const out = regroupTools(plan(["tool.rt"]));
    expect(out.map((g) => g.id)).toEqual(["mac", "accounts", "access", "rt"]);
  });

  test("every row survives the split exactly once", () => {
    const before = plan(["tool.herdr", "tool.mission-control", "tool.rt", "home.backup", "tool.chrome", "tool.unknown"]);
    const after = regroupTools(before);
    const flat = (gs: Group[]) => gs.flatMap((g) => g.rows.map((x) => x.id)).sort();
    expect(flat(after)).toEqual(flat(before));
  });
});
