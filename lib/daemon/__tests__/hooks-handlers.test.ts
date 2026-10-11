import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setSetting, setSettingsNoticeSink } from "../../settings/write.ts";
import { createHooksHandlers } from "../handlers/hooks.ts";
import type { HandlerContext } from "../handlers/types.ts";

function fakeCtx(
  repos: Record<string, string> = {},
): Pick<HandlerContext, "repoIndex" | "checkAndRepairHooksPath" | "startWatchingRepo"> {
  return {
    repoIndex: () => repos,
    checkAndRepairHooksPath: async () => true,
    startWatchingRepo: () => {},
  };
}

describe("hooks handlers — identity-only guard", () => {
  test("hooks:status refuses a bare display name, same as every other repo-keyed verb", async () => {
    const h = createHooksHandlers(fakeCtx());
    const res = await h["hooks:status"]!({ repo: "repo" }) as any;
    expect(res.ok).toBe(true);
    expect((res as { data: unknown }).data).toBeNull();
  });

  test("hooks:repair refuses a bare display name", async () => {
    const h = createHooksHandlers(fakeCtx());
    const res = await h["hooks:repair"]!({ repo: "repo" }) as any;
    expect(res.ok).toBe(true);
    expect((res as { repaired: boolean }).repaired).toBe(false);
  });

  test("hooks:watch refuses a bare display name and never starts a watch", async () => {
    let watched = false;
    const ctx = fakeCtx({ "path:%2Frepo": "/repo" });
    ctx.startWatchingRepo = () => { watched = true; };
    const h = createHooksHandlers(ctx);

    const res = await h["hooks:watch"]!({ repo: "repo" }) as any;

    expect(res.ok).toBe(true);
    expect(watched).toBe(false);
  });

  test("hooks:watch accepts a serialized identity and starts the watch", async () => {
    let watchedName: string | null = null;
    const ctx = fakeCtx({ "path:%2Frepo": "/repo" });
    ctx.startWatchingRepo = (repoName: string) => { watchedName = repoName; };
    const h = createHooksHandlers(ctx);

    const res = await h["hooks:watch"]!({ repo: "path:%2Frepo" }) as any;

    expect(res.ok).toBe(true);
    // Cast: TS narrows watchedName to null (its initializer) because the
    // mutating assignment lives in a closure it can't prove ran.
    expect(watchedName as string | null).toBe("path:%2Frepo");
  });
});

describe("hooks:status reads the setting", () => {
  const origHome = process.env.HOME;
  let home: string;
  let previousSink: ReturnType<typeof setSettingsNoticeSink>;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-hooks-status-")));
    process.env.HOME = home;
    previousSink = setSettingsNoticeSink(() => {});
  });
  afterEach(() => {
    setSettingsNoticeSink(previousSink);
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("hooks:status answers with the repo's resolved rt.hooks setting", async () => {
    setSetting("rt.hooks", { hooks: { "pre-push": false } }, "user", { repoIdentity: "example.com/org/repo" });
    const h = createHooksHandlers(fakeCtx());
    const res = (await h["hooks:status"]!({ repo: "remote:example.com%2Forg%2Frepo" })) as { ok: boolean; data: unknown };
    expect(res).toEqual({ ok: true, data: { enabled: true, hooks: { "pre-push": false } } });
  });

  test("hooks:status for a repo with no remote is null: it has no settings section", async () => {
    const h = createHooksHandlers(fakeCtx());
    expect(await h["hooks:status"]!({ repo: "path:%2Fsrc%2Frepo" })).toEqual({ ok: true, data: null });
  });
});
