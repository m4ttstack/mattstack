import { describe, expect, test } from "bun:test";
import { listAgentSafe } from "../../lib/command-tree-resolve.ts";
import { TREE } from "../../lib/command-tree-def.ts";
import { UserActionableError } from "../../lib/errors.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { devEnvelope, devSetupBlocks, devUpdateBlocks, failureBlocks } from "../dev.ts";

const AT = new Date("2026-10-06T15:00:00.000Z");

describe("rt dev", () => {
  test("neither verb is agent-safe", () => {
    expect(listAgentSafe(TREE).some((e) => e.path[0] === "dev")).toBe(false);
  });

  test("the tree has dev setup and dev update with plain descriptions", () => {
    const dev = TREE.dev!;
    expect(Object.keys(dev.subcommands!)).toEqual(["setup", "update"]);
    expect(dev.subcommands!.setup!.description).toBe("Set this Mac up to build mattstack from your own clone");
    expect(dev.subcommands!.update!.description).toBe("Update your tools and dev app");
  });

  test("setup summary names the way back and the Rebuild limit", () => {
    const text = renderPlain(devSetupBlocks({ kind: "done", clone: "/c/mattstack", stages: [{ status: "done", title: "Cloned mattstack" }] }));
    expect(text).toContain("open /Applications/mattstack.app");
    expect(text).toContain("Rebuild");
  });

  test("already set up points at update", () => {
    expect(renderPlain(devSetupBlocks({ kind: "already", clone: "/c/mattstack" }))).toContain("rt dev update");
  });

  test("update summary names the clone", () => {
    expect(renderPlain(devUpdateBlocks({ clone: "/c/mattstack", stages: [] }))).toContain("/c/mattstack");
  });

  test("--json envelopes are pinned", () => {
    const stages = [{ status: "done", title: "Your tools are ready", hint: "bun 1.4.2 · go 1.26.5" }];
    expect(devEnvelope({ ok: true, kind: "done", clone: "/c/mattstack", stages }, AT)).toMatchSnapshot();
    expect(devEnvelope({ ok: true, kind: "already", clone: "/c/mattstack", stages: [] }, AT)).toMatchSnapshot();
    expect(devEnvelope({ ok: true, clone: "/c/mattstack", stages }, AT)).toMatchSnapshot();
  });

  test("a policy refusal is a refused note with its next command", () => {
    const f = failureBlocks(
      new UserActionableError("dev-no-push-access", "You can't push to mattstack yet", {}, { why: "Ask the mattstack maintainers to add you as a collaborator.", next: "rt dev setup" }),
    );
    if (!f.note || f.status !== "refused") throw new Error("expected a refusal");
    const text = renderPlain(f.blocks);
    expect(text).toContain("You can't push to mattstack yet");
    expect(text).toContain("rt dev setup");
  });

  test("not logged in to GitHub is a refusal with the login command as next", () => {
    const f = failureBlocks(new UserActionableError("dev-gh-login", "You're not logged in to GitHub", {}, { why: "Pushing your branches needs it.", next: "gh auth login" }));
    if (!f.note || f.status !== "refused") throw new Error("expected a refusal");
    const text = renderPlain(f.blocks);
    expect(text).toStartWith("[refused] You're not logged in to GitHub");
    expect(text).toContain("gh auth login");
  });

  test.each([
    ["dev-no-repo-root", "This Mac has no repo folder chosen yet", "rt setup repo-root set <folder>"],
    ["dev-tool-missing", "go is not installed", "brew install go"],
    ["dev-clone-missing", "Your mattstack clone is gone", "rt dev setup"],
  ])("%s is a needs-you note with its next command, not a failure", (code, message, next) => {
    const f = failureBlocks(new UserActionableError(code, message, {}, { next }));
    if (!f.note || f.status !== "needs-you") throw new Error("expected a needs-you note");
    const text = renderPlain(f.blocks);
    expect(text).toStartWith(`[needs you] ${message}`);
    expect(text).not.toContain("[failed]");
    expect(text).toContain(next);
  });

  test("a failed access check is a failure, not a refusal", () => {
    expect(failureBlocks(new UserActionableError("dev-access-unreadable", "rt could not check your access", {})).note).toBe(false);
  });

  test("a failure shows the last lines of the child's output, with urls stripped", () => {
    const log = ["line 1", "line 2", "line 3", "line 4", "line 5", "fatal: could not read from https://user:tok@github.com/x.git", "line 7"].join("\n");
    const f = failureBlocks(new UserActionableError("dev-clone-failed", "Cloning mattstack failed", {}, { log }));
    if (f.note) throw new Error("expected a failure, not a note");
    expect(f.failure.title).toBe("Cloning mattstack failed");
    const text = renderPlain(f.after);
    expect(text).toContain("line 7");
    expect(text).not.toContain("line 1");
    expect(text).not.toContain("tok@");
  });
});
