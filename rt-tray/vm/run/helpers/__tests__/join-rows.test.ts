import { describe, expect, test } from "bun:test";
import { join } from "path";
import { JQ_DIR, runJq } from "./jq.ts";

const JOIN_ROWS = join(JQ_DIR, "join-rows.jq");

interface Row { id: string; status: string; detail: string; action: unknown }
const row = (id: string, status = "ready", detail = "", action: unknown = null): Row => ({ id, status, detail, action });
const RUN = { type: "run", label: "Retry", verb: ["setup", "apply"] };

function verdict(rows: Row[] | null): { kind: string; msg: string }[] {
  const status = rows === null ? {} : { contract: 1, groups: [{ id: "tools", title: "Tools", rows }] };
  return runJq(["-r", "-f", JOIN_ROWS], JSON.stringify(status))
    .trim()
    .split("\n")
    .map((l) => {
      const [kind = "", msg = ""] = l.split("\t");
      return { kind, msg };
    });
}
const bads = (rows: Row[] | null) => verdict(rows).filter((v) => v.kind === "bad").map((v) => v.msg);

const JOINED = [
  row("tool.plugins", "ready", "4 plugins installed"),
  row("access.team-repo", "ready", "github.com/o/mattstack-team-vmtest"),
  row("tool.fast-browser", "ready", "fast-browser 1.4.0"),
];

describe("join-rows.jq", () => {
  test("a bare joined team passes with no marketplace and no tracked repos", () => {
    expect(bads(JOINED)).toEqual([]);
    const msgs = verdict(JOINED).map((v) => v.msg);
    expect(msgs).toContain("team.marketplace: no row (the team declares no marketplace)");
    expect(msgs).toContain("access.repo.*: the team tracks no repos");
  });

  test("team plugins that did not install fail, naming the detail", () => {
    const rows = [row("tool.plugins", "needs-you", "disabled: acme@acme"), ...JOINED.slice(1)];
    expect(bads(rows)).toEqual(["tool.plugins: needs-you, wanted ready (team plugins installed): disabled: acme@acme"]);
  });

  test("a missing team-repo row fails", () => {
    expect(bads(JOINED.filter((r) => r.id !== "access.team-repo"))).toEqual(["access.team-repo: no row (the joined team repo is reachable)"]);
  });

  test("a declared marketplace must be ready", () => {
    expect(bads([...JOINED, row("team.marketplace", "missing", "not added", RUN)])).toEqual(["team.marketplace: missing, wanted ready: not added"]);
    expect(bads([...JOINED, row("team.marketplace", "ready", "acme")])).toEqual([]);
  });

  test("a tracked repo is ready, or a partial that says why and offers the next step", () => {
    const rows = [
      ...JOINED,
      row("access.repo.github-com-o-a", "ready", "cloned"),
      row("access.repo.github-com-o-b", "needs-you", "your account cannot see o/b", RUN),
      row("access.repo.github-com-o-c", "skipped", "archived upstream"),
    ];
    expect(bads(rows)).toEqual([]);
    expect(verdict(rows).map((v) => v.msg)).toContain("access.repo.github-com-o-b: partial, needs-you: your account cannot see o/b");
  });

  test("a repo row with no detail, no action or still checking is not a clear partial", () => {
    const rows = [
      ...JOINED,
      row("access.repo.github-com-o-a", "error", "clone failed"),
      row("access.repo.github-com-o-b", "needs-you", "", RUN),
      row("access.repo.github-com-o-c", "checking", "cloning", RUN),
    ];
    expect(bads(rows)).toEqual([
      'access.repo.github-com-o-a: error with no clear next step: "clone failed"',
      'access.repo.github-com-o-b: needs-you with no clear next step: ""',
      'access.repo.github-com-o-c: checking with no clear next step: "cloning"',
    ]);
  });

  test("a status with no rows at all fails once", () => {
    expect(bads(null)).toEqual(["rt setup status --json carried no rows"]);
  });
});
