import { describe, expect, test } from "bun:test";
import { isRunTree } from "../command-router.ts";

const identity = "remote:gitlab.com%2Facme%2Fwidgets";
const deps = {
  findTreeByPath: (p: string) => (p === "/pool/widgets/alder" ? { repoName: identity, tree: "alder" } : null),
  repoIndex: () => ({ [identity]: "/src/widgets", "path:%2Fsrc%2Fscratch": "/src/scratch" }),
};

describe("isRunTree", () => {
  test("a registered tree matches a run keyed by its repo's slug", () => {
    expect(isRunTree("/pool/widgets/alder", "gitlab.com-acme-widgets", deps)).toBe(true);
  });
  test("the main checkout matches a run keyed by its repo's slug", () => {
    expect(isRunTree("/src/widgets", "gitlab.com-acme-widgets", deps)).toBe(true);
  });
  test("a run keyed by the serialized identity still matches", () => {
    expect(isRunTree("/pool/widgets/alder", identity, deps)).toBe(true);
    expect(isRunTree("/src/scratch", "path:%2Fsrc%2Fscratch", deps)).toBe(true);
  });
  test("another repo's slug, or an unregistered path, does not match", () => {
    expect(isRunTree("/pool/widgets/alder", "gitlab.com-acme-gadgets", deps)).toBe(false);
    expect(isRunTree("/elsewhere", "gitlab.com-acme-widgets", deps)).toBe(false);
  });
});
