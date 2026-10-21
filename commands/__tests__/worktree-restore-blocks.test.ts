import { describe, expect, test } from "bun:test";
import { provisionBlocks, restoreBlocks } from "../worktree.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";

describe("restoreBlocks", () => {
  test("queued setup names its steps and the command that waits for them", () => {
    const text = renderPlain(restoreBlocks({
      restored: true, path: "/pool/lupin", tree: "lupin", readyPending: true, readySteps: ["pnpm install", "make env"],
    }));

    expect(text).toContain("/pool/lupin");
    expect(text).toContain("Still setting up in the background");
    expect(text).toContain("pnpm install, make env");
    expect(text).toContain("rt worktree await-ready lupin");
  });

  test("a restore that named its repo names it in the wait command too", () => {
    const text = renderPlain(restoreBlocks(
      { restored: true, path: "/pool/lupin", tree: "lupin", readyPending: true, readySteps: ["pnpm install"] },
      "gitlab.com/acme/app",
    ));

    expect(text).toContain("rt worktree await-ready lupin --repo gitlab.com/acme/app");
  });

  test("a restore with nothing to set up prints only its result line", () => {
    const text = renderPlain(restoreBlocks({ restored: true, path: "/pool/lupin", tree: "lupin" }));

    expect(text).toBe("[ok] lupin restored  /pool/lupin\n");
    expect(text).not.toContain("setting up");
  });
});

describe("provisionBlocks", () => {
  const pending = { tree: "lupin", path: "/pool/lupin", branch: "b", branchState: "new", readyPending: true, readySteps: ["pnpm install"] };

  test("a provision that named its repo names it in the wait command too", () => {
    expect(renderPlain(provisionBlocks(pending, "gitlab.com/acme/app"))).toContain("rt worktree await-ready lupin --repo gitlab.com/acme/app");
  });

  test("a provision from inside its repo prints the bare wait command", () => {
    const text = renderPlain(provisionBlocks(pending));
    expect(text).toContain("rt worktree await-ready lupin");
    expect(text).not.toContain("--repo");
  });
});
