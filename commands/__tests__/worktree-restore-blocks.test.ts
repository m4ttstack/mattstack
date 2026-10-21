import { describe, expect, test } from "bun:test";
import { restoreBlocks } from "../worktree.ts";
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

  test("a restore with nothing to set up prints only its result line", () => {
    const text = renderPlain(restoreBlocks({ restored: true, path: "/pool/lupin", tree: "lupin" }));

    expect(text).toBe("[ok] lupin restored  /pool/lupin\n");
    expect(text).not.toContain("setting up");
  });
});
