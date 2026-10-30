import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupForm, type FormDeps } from "../setup-form.ts";
import { fakeProbes } from "../../lib/setup/__tests__/fakes.ts";
import { capturePlain } from "./helpers/json-line.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

class ExitSentinel extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

function deps() {
  const lines: string[] = [];
  const d: FormDeps = {
    probes: fakeProbes({ home: "/fake-home" }),
    secrets: { has: async () => null },
    json: (v) => lines.push(JSON.stringify(v)),
    exit: (code) => {
      throw new ExitSentinel(code);
    },
    orgs: () => [],
  };
  return { d, lines };
}

async function exitCode(fn: () => Promise<void>): Promise<number | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    if (err instanceof ExitSentinel) return err.code;
    throw err;
  }
}

let quiet: CapturedOut;
beforeEach(() => {
  quiet = capturePlain();
});
afterEach(() => quiet.restore());

describe("rt setup form", () => {
  test("--section macos --json prints the envelope with only the macos section", async () => {
    const t = deps();
    expect(await exitCode(() => setupForm(["--section", "macos", "--json"], {}, t.d))).toBeUndefined();
    expect(t.lines).toHaveLength(1);
    const body = JSON.parse(t.lines[0]!);
    expect(body).toMatchObject({ contract: 1, at: "2026-01-01T00:00:00.000Z" });
    expect(body.sections.macos).toHaveLength(3);
    expect(body.sections).not.toHaveProperty("connect");
  });

  test("an unknown section is a usage error", async () => {
    const t = deps();
    expect(await exitCode(() => setupForm(["--section", "elsewhere", "--json"], {}, t.d))).toBe(2);
    expect(JSON.parse(t.lines[0]!).error).toMatchObject({ code: "bad-section" });
    const human = deps();
    expect(await exitCode(() => setupForm(["--section", "elsewhere"], {}, human.d))).toBe(2);
    expect(quiet.stderr()).toStartWith("Pick a part of setup");
  });

  test("human output prints one line per row", async () => {
    const t = deps();
    await setupForm(["--section", "macos"], {}, t.d);
    const lines = quiet.stdout().trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Full Disk Access");
    expect(lines[2]).toContain("Fancy URLs");
  });
});
