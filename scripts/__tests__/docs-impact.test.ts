import { expect, test } from "bun:test";
import { docsImpact, formatImpact } from "../lib/docs-impact.ts";

test("command changes point at the rt tab", () => {
  expect(docsImpact(["commands/sync.ts", "lib/command-tree-def.ts"])).toEqual([{ area: "rt" }]);
});

test("an app change points at its own page, gitq at its tab", () => {
  expect(docsImpact(["apps/board/src/x.ts", "apps/gitq/src/cli/main.ts"])).toEqual([
    { area: "apps", page: "website/docs/apps/board.mdx" },
    { area: "gitq" },
  ]);
});

test("plugins point at Skills; tray, setup, team and settings at Get started", () => {
  expect(docsImpact(["plugins/example-plugin/skills/example/SKILL.md"])).toEqual([{ area: "skills" }]);
  expect(docsImpact(["rt-tray/Sources/A.swift", "lib/setup/x.ts", "lib/team/y.ts", "packages/rt-client/src/settings/z.ts"])).toEqual([{ area: "start" }]);
});

test("a path that maps to no docs area adds nothing", () => {
  expect(docsImpact(["lib/daemon/x.ts", "README.md", "website/docs/rt/index.mdx", "apps/AGENTS.md"])).toEqual([]);
});

test("formatImpact names each area once, pages under it", () => {
  const out = formatImpact(docsImpact(["apps/deck/a.ts", "apps/board/b.ts", "commands/x.ts"]));
  expect(out).toBe(
    "docs to review:\n  apps: website/docs/apps/board.mdx, website/docs/apps/deck.mdx\n  rt: website/docs/rt/\n",
  );
  expect(formatImpact([])).toBe("docs to review: none\n");
});
