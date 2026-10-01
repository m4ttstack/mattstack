/**
 * `rt settings explain` is agent-safe through rt_verb, which always appends
 * --json and parses stdout as one JSON value: the --json branch must print
 * exactly one envelope and no tree.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { settingsExplain } from "../settings-keys.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

describe("rt settings explain", () => {
  const origHome = process.env.HOME;
  let home: string;
  let cap: ReturnType<typeof captureOut>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-explain-cli-")));
    process.env.HOME = home;
    cap = captureOut();
    out.__test__.setHuman(() => false);
  });

  afterEach(() => {
    cap.restore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("--json prints exactly one parseable envelope with every scope rung", async () => {
    await settingsExplain(["rt.worktrees", "--json"]);

    expect(cap.lines()).toHaveLength(1);
    const payload = JSON.parse(cap.stdout());
    expect(payload.ok).toBe(true);
    expect(payload.key).toBe("rt.worktrees");
    expect(payload.rows.map((r: { scope: string }) => r.scope)).toEqual(["default", "team", "user", "machine"]);
    expect(payload.rows[0]).toMatchObject({ scope: "default", present: true, value: { onDeck: 0 } });
  });

  test("without --json prints the human tree instead", async () => {
    await settingsExplain(["rt.worktrees"]);

    const lines = cap.stdout().split("\n");
    expect(lines.some((l) => l.includes("rt.worktrees"))).toBe(true);
    expect(lines.some((l) => l.startsWith("{"))).toBe(false);
  });
});
