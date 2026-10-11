import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { onlyDefault, registryDefault, storedValue, unwritten } from "../presence.ts";
import { setSetting, setSettingsNoticeSink } from "../write.ts";

const REPO = "gitlab.example.com/acme/widgets";

describe("presence", () => {
  const origHome = process.env.HOME;
  let home: string;
  let previousSink: ReturnType<typeof setSettingsNoticeSink>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-presence-")));
    process.env.HOME = home;
    previousSink = setSettingsNoticeSink(() => {});
  });

  afterEach(() => {
    setSettingsNoticeSink(previousSink);
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("storedValue reads a store's value and treats the registry default as nobody's choice", () => {
    expect(storedValue("rt.cron")).toBeUndefined();
    setSetting("rt.cron", { triggers: [] }, "machine");
    expect(storedValue("rt.cron")).toEqual({ triggers: [] });
    expect(storedValue("no.such.key")).toBeUndefined();
  });

  test("onlyDefault reads provenance, never the value", () => {
    expect(onlyDefault({ provenance: [] })).toBe(true);
    expect(onlyDefault({ provenance: [{ scope: "default", file: null }] })).toBe(true);
    expect(onlyDefault({ provenance: [{ scope: "default", file: null }, { scope: "user", file: "/u" }] })).toBe(false);
  });

  test("a key nobody set is unwritten, with or without a registry default", () => {
    expect(unwritten("rt.cron")).toBe(true);
    expect(unwritten("rt.dopplerTemplate", { repoIdentity: REPO })).toBe(true);
  });

  test("a store value makes the key written, globally and per repo", () => {
    setSetting("rt.cron", { triggers: [] }, "machine");
    expect(unwritten("rt.cron")).toBe(false);
    setSetting("rt.dopplerTemplate", [{ path: "env", project: "web", config: "dev" }], "machine", { repoIdentity: REPO });
    expect(unwritten("rt.dopplerTemplate", { repoIdentity: REPO })).toBe(false);
    expect(unwritten("rt.dopplerTemplate", { repoIdentity: "gitlab.example.com/acme/gadgets" })).toBe(true);
  });

  test("registryDefault hands back a copy", () => {
    const first = registryDefault<{ triggers: unknown[] }>("rt.cron");
    first.triggers.push("changed");
    expect(registryDefault<unknown>("rt.cron")).toEqual({ triggers: [] });
    expect(registryDefault("rt.dopplerTemplate")).toBeUndefined();
    expect(() => registryDefault("no.such.key")).toThrow('unknown setting "no.such.key"');
  });
});
