import { describe, test, expect } from "bun:test";
import { planBlocks, rowStatus, rowTitles } from "../plan-blocks.ts";
import type { Plan, Row } from "../contract.ts";
import { renderPlain } from "../../ui/out-plain.ts";

function row(r: Partial<Row> & Pick<Row, "id" | "title" | "status">): Row {
  return { kind: "tool", why: "x", required: true, optionalNote: null, detail: "", action: null, recheck: "on-change", ...r };
}

function plan(groups: Plan["groups"], extra: Partial<Plan> = {}): Plan {
  return { contract: 1, at: "2026-01-01T00:00:00.000Z", team: { slug: "", name: "", mode: "none" }, groups, canInstall: true, requiredMissing: [], finishBlockedBy: [], ...extra };
}

describe("rowStatus", () => {
  test("ready is done; invalid is the only failure; a row that could not be checked is a warning", () => {
    expect(rowStatus({ status: "ready", kind: "tool" })).toBe("done");
    expect(rowStatus({ status: "invalid", kind: "account" })).toBe("failed");
    expect(rowStatus({ status: "error", kind: "permission" })).toBe("warn");
  });

  test("a missing account or permission needs the person; a missing tool, access or info row is pending", () => {
    expect(rowStatus({ status: "missing", kind: "account" })).toBe("needs-you");
    expect(rowStatus({ status: "missing", kind: "permission" })).toBe("needs-you");
    expect(rowStatus({ status: "missing", kind: "tool" })).toBe("pending");
    expect(rowStatus({ status: "missing", kind: "access" })).toBe("pending");
    expect(rowStatus({ status: "missing", kind: "info" })).toBe("pending");
  });

  test("needs-you, skipped and checking map to their own states", () => {
    expect(rowStatus({ status: "needs-you", kind: "tool" })).toBe("needs-you");
    expect(rowStatus({ status: "skipped", kind: "tool" })).toBe("skipped");
    expect(rowStatus({ status: "checking", kind: "tool" })).toBe("pending");
  });
});

describe("planBlocks", () => {
  test("one section per group with a ready count, a line per row, the Install summary naming blockers by title", () => {
    const p = plan(
      [
        {
          id: "mac",
          title: "Your Mac",
          rows: [
            row({ id: "perm.fda", kind: "permission", title: "Full Disk Access", status: "missing", detail: "Not granted" }),
            row({ id: "tool.git", title: "Git", status: "ready", detail: "2.45" }),
          ],
        },
      ],
      { canInstall: false, requiredMissing: ["perm.fda"] },
    );
    expect(renderPlain(planBlocks(p, "plan"))).toBe(
      "Your Mac (1 of 2 ready)\n" +
        "[needs you] Full Disk Access  Not granted\n" +
        "[ok] Git  2.45\n" +
        "\n" +
        "[needs you] Install is waiting on  Full Disk Access\n",
    );
  });

  test("a ready plan ends in 'Install can run' and plan mode prints no Finish line", () => {
    const p = plan([{ id: "tools", title: "Tools", rows: [row({ id: "tool.git", title: "Git", status: "ready", detail: "2.45" })] }]);
    expect(renderPlain(planBlocks(p, "plan"))).toBe("Tools (1 of 1 ready)\n[ok] Git  2.45\n\n[ok] Install can run\n");
  });

  test("status mode adds the Finish line and a next callout under a missing account that has a connect verb", () => {
    const p = plan(
      [
        {
          id: "accounts",
          title: "Accounts",
          rows: [
            row({ id: "account.github", kind: "account", title: "GitHub", status: "missing", detail: "no GitHub account connected", action: { type: "connect", label: "Connect", integration: "github", fields: [] } }),
            row({ id: "account.linear", kind: "account", title: "Linear", status: "missing", detail: "no account connected" }),
          ],
        },
        { id: "tools", title: "Tools", rows: [row({ id: "tool.fast-browser-extension", title: "Fast Browser extension", status: "missing", detail: "Not loaded", finishGated: true })] },
      ],
      { canInstall: true, finishBlockedBy: ["tool.fast-browser-extension"] },
    );
    expect(renderPlain(planBlocks(p, "status"))).toBe(
      "Accounts (0 of 2 ready)\n" +
        "[needs you] GitHub  no GitHub account connected\n" +
        "  next: rt setup github connect\n" +
        "[needs you] Linear  no account connected\n" +
        "\n" +
        "Tools (0 of 1 ready)\n" +
        "[not yet] Fast Browser extension  Not loaded\n" +
        "\n" +
        "[ok] Install can run\n" +
        "[needs you] Finish is waiting on  Fast Browser extension\n",
    );
  });

  test("plan mode never prints the connect callout", () => {
    const p = plan([{ id: "accounts", title: "Accounts", rows: [row({ id: "account.github", kind: "account", title: "GitHub", status: "missing", detail: "x", action: { type: "connect", label: "Connect", integration: "github", fields: [] } })] }]);
    expect(renderPlain(planBlocks(p, "plan"))).not.toContain("next:");
  });

  test("a choose row's footnote is a note callout under its line", () => {
    const p = plan([
      {
        id: "tools",
        title: "Tools",
        rows: [
          row({
            id: "skills.writing-style",
            title: "Writing style",
            required: false,
            status: "needs-you",
            detail: "Not chosen yet",
            action: { type: "choose", label: "Choose style", verb: ["skills", "writing-style", "use"], options: [], footnote: "You can also choose from a terminal: rt skills writing-style use" },
          }),
        ],
      },
    ]);
    expect(renderPlain(planBlocks(p, "plan"))).toContain("[needs you] Writing style  Not chosen yet\n  note: You can also choose from a terminal: rt skills writing-style use\n");
  });

  test("a row that could not be checked draws as a warning, never a failure", () => {
    const p = plan([{ id: "access", title: "Access", rows: [row({ id: "access.forge", kind: "access", title: "Forge", status: "error", detail: "Could not reach the forge" })] }]);
    expect(renderPlain(planBlocks(p, "plan"))).toBe("Access (0 of 1 ready)\n[warning] Forge  Could not reach the forge\n\n[ok] Install can run\n");
  });

  test("a group with no rows prints nothing, not a bare title", () => {
    const p = plan([
      { id: "accounts", title: "Accounts", rows: [] },
      { id: "tools", title: "Tools", rows: [row({ id: "tool.git", title: "Git", status: "ready", detail: "2.45" })] },
    ]);
    expect(renderPlain(planBlocks(p, "plan"))).toBe("Tools (1 of 1 ready)\n[ok] Git  2.45\n\n[ok] Install can run\n");
  });

  test("an empty plan is only the Install summary", () => {
    expect(renderPlain(planBlocks(plan([]), "plan"))).toBe("[ok] Install can run\n");
  });

  test("rowTitles resolves ids to titles and keeps an unknown id as it is", () => {
    const p = plan([{ id: "mac", title: "Your Mac", rows: [row({ id: "perm.fda", title: "Full Disk Access", status: "ready" })] }]);
    expect(rowTitles(p, ["perm.fda", "ghost"])).toEqual(["Full Disk Access", "ghost"]);
  });
});
