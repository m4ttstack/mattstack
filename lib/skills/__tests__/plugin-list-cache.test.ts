import { describe, expect, it } from "bun:test";
import {
  cachedPluginList,
  PLUGIN_LIST_CACHE_TTL_MS,
  pluginListInputs,
  type PluginListCacheDeps,
} from "../plugin-list-cache.ts";
import type { PluginListEntry } from "../sources.ts";

const ENTRY: PluginListEntry = { id: "mattstack@mattstack", installPath: "/p/mattstack" };

function fakeDeps(stamps: Record<string, [number, number] | null>) {
  const files = new Map<string, string>();
  let clock = 1_000;
  let spawns = 0;
  const deps: PluginListCacheDeps = {
    now: () => clock,
    stamp: (p) => stamps[p] ?? null,
    read: (p) => files.get(p) ?? null,
    write: (p, body) => void files.set(p, body),
    list: () => {
      spawns++;
      return [ENTRY];
    },
  };
  return {
    deps,
    files,
    spawns: () => spawns,
    tick: (ms: number) => void (clock += ms),
  };
}

describe("cachedPluginList", () => {
  const inputs = ["/c/settings.json", "/c/plugins/installed_plugins.json"];

  it("spawns once and serves the next read from the cache", () => {
    const f = fakeDeps({ "/c/settings.json": [1, 10] });

    expect(cachedPluginList("/cache.json", inputs, f.deps)).toEqual([ENTRY]);
    expect(cachedPluginList("/cache.json", inputs, f.deps)).toEqual([ENTRY]);

    expect(f.spawns()).toBe(1);
  });

  it("spawns again once a stamped file changes", () => {
    const stamps: Record<string, [number, number] | null> = { "/c/settings.json": [1, 10] };
    const f = fakeDeps(stamps);

    cachedPluginList("/cache.json", inputs, f.deps);
    stamps["/c/plugins/installed_plugins.json"] = [2, 40];
    cachedPluginList("/cache.json", inputs, f.deps);

    expect(f.spawns()).toBe(2);
  });

  it("spawns again past the TTL even when nothing changed", () => {
    const f = fakeDeps({});

    cachedPluginList("/cache.json", inputs, f.deps);
    f.tick(PLUGIN_LIST_CACHE_TTL_MS);
    cachedPluginList("/cache.json", inputs, f.deps);

    expect(f.spawns()).toBe(2);
  });

  it("treats an unreadable cache file as a miss", () => {
    const f = fakeDeps({});
    f.files.set("/cache.json", "{not json");

    expect(cachedPluginList("/cache.json", inputs, f.deps)).toEqual([ENTRY]);
    expect(f.spawns()).toBe(1);
  });

  it("still answers when the cache cannot be written", () => {
    const f = fakeDeps({});
    f.deps.write = () => {
      throw new Error("read-only");
    };

    expect(cachedPluginList("/cache.json", inputs, f.deps)).toEqual([ENTRY]);
  });
});

describe("pluginListInputs", () => {
  it("stamps the bin, the user's plugin files, and every ancestor's project settings", () => {
    expect(pluginListInputs("/h/.claude", "/r/app", "/bin/claude")).toEqual([
      "/bin/claude",
      "/h/.claude/settings.json",
      "/h/.claude/plugins/installed_plugins.json",
      "/h/.claude/plugins/known_marketplaces.json",
      "/r/app/.claude/settings.json",
      "/r/app/.claude/settings.local.json",
      "/r/.claude/settings.json",
      "/r/.claude/settings.local.json",
      "/.claude/settings.json",
      "/.claude/settings.local.json",
    ]);
  });
});
