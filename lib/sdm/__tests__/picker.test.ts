import { afterEach, describe, test, expect } from "bun:test";
import { installFakePick } from "../../ui/pick-fake.ts";
import { runNavPicker } from "../../navigate.ts";
import { buildPickerOptions } from "../picker.ts";
import type { SdmConnection } from "../browse.ts";
import type { RecentEntry } from "../state.ts";

const conn = (id: string, tier?: string): SdmConnection => ({
  label: id, sdmResource: `example-${id}`, tier, key: `demo:${id}`,
});
const recent = (id: string): RecentEntry => ({
  key: `demo:${id}`, label: id, sdmResource: `example-${id}`, lastConnectedAt: "2026-07-01T00:00:00.000Z",
});

describe("buildPickerOptions", () => {
  test("recents first, then tiers in canonical order, no duplicate rows", () => {
    const options = buildPickerOptions(
      [conn("p", "production"), conn("s", "staging"), conn("d", "development"), conn("q", "qa")],
      [recent("q")],
    );
    const labels = options.map(o => (o.separator ? `--${o.label}` : o.value));
    // q is promoted to Recent and dropped from the QA group (which then vanishes).
    expect(labels).toEqual([
      "--Recent", "demo:q",
      "--Development", "demo:d",
      "--Staging", "demo:s",
      "--Production", "demo:p",
    ]);
    // Every connection key appears exactly once across the whole list.
    const keys = options.filter(o => !o.separator).map(o => o.value);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("recents cap at 3; a 4th recent still appears once, in its tier", () => {
    const options = buildPickerOptions(
      [conn("a", "qa"), conn("b", "qa"), conn("c", "qa"), conn("d", "qa")],
      [recent("a"), recent("b"), recent("c"), recent("d")],
    );
    const keys = options.filter(o => !o.separator).map(o => o.value);
    expect(keys.filter(k => k === "demo:d")).toHaveLength(1);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("unknown tiers group after known ones, alphabetically", () => {
    const options = buildPickerOptions([conn("z", "sandbox"), conn("a", "staging")], []);
    const seps = options.filter(o => o.separator).map(o => o.label);
    expect(seps).toEqual(["Staging", "sandbox"]);
  });

  test("tierless connections land in an Other group", () => {
    const options = buildPickerOptions([conn("x")], []);
    expect(options[0]!.separator).toBe(true);
    expect(options[0]!.label).toBe("Other");
    expect(options[1]!.value).toBe("demo:x");
    expect(options[1]!.cells!.map(c => c.text).join(" ")).toContain("example-x");
  });

  test("a stale-key recent dedups against the catalog by resource, using the current label/key", () => {
    // Old-model recent: different key + stale label, but the SAME sdmResource
    // as a current catalog connection (the real-world dup bug).
    const staleRecent: RecentEntry = {
      key: "old:acme-db-qa", label: "acme-db-qa",
      sdmResource: "example-q", tier: "qa",
      lastConnectedAt: "2026-07-01T00:00:00.000Z",
    };
    const options = buildPickerOptions([conn("q", "qa")], [staleRecent]);
    const rows = options.filter(o => !o.separator);
    // Exactly one row for the resource (no duplicate) ...
    expect(rows).toHaveLength(1);
    // ... and it renders from the CURRENT catalog entry, not the stale recent.
    expect(rows[0]!.value).toBe("demo:q");
    expect(rows[0]!.label.trim()).toBe("q"); // label carries a state gutter now
    expect(options[0]!.label).toBe("Recent");
  });

  test("a recent whose resource left the catalog still shows, with its stored values", () => {
    const goneRecent: RecentEntry = {
      key: "old:gone", label: "Gone DB", sdmResource: "example-gone", tier: "qa",
      lastConnectedAt: "2026-07-01T00:00:00.000Z",
    };
    const options = buildPickerOptions([conn("q", "qa")], [goneRecent]);
    const recentIdx = options.findIndex(o => o.separator && o.label === "Recent");
    expect(options[recentIdx + 1]!.value).toBe("old:gone");
    expect(options[recentIdx + 1]!.label.trim()).toBe("Gone DB");
    // The unrelated catalog connection still appears in its tier.
    expect(options.some(o => o.value === "demo:q")).toBe(true);
  });

  test("gutter marks state: filled dot connected (blue), check standing, blank on-demand", () => {
    const standing = (id: string, tier: string): SdmConnection => ({ ...conn(id, tier), standingAccess: true });
    const onDemand = (id: string, tier: string): SdmConnection => ({ ...conn(id, tier), standingAccess: false });
    const options = buildPickerOptions(
      [standing("q", "qa"), standing("s", "staging"), onDemand("d", "development")],
      [],
      new Set(["example-q"]), // q has a live tunnel right now
    );
    const rows = options.filter(o => !o.separator);
    const q = rows.find(o => o.value === "demo:q")!;
    const s = rows.find(o => o.value === "demo:s")!;
    const d = rows.find(o => o.value === "demo:d")!;
    expect(q.label.startsWith("● ")).toBe(true);  // connected
    expect(s.label.startsWith("✓ ")).toBe(true);  // standing access, not connected
    expect(d.label.startsWith("  ")).toBe(true);  // on-demand
    expect(q.tone).toBe("blue");
    expect(s.tone).toBe("peach");
    expect(d.tone).toBe("mint");
  });

  test("a row names its tier's tone, and no option carries an escape sequence", () => {
    const options = buildPickerOptions([conn("p", "production"), conn("q", "qa"), conn("x")], []);
    const rows = options.filter(o => !o.separator);
    expect(rows.find(o => o.value === "demo:p")!.tone).toBe("coral");
    expect(rows.find(o => o.value === "demo:q")!.tone).toBe("pink");
    expect(rows.find(o => o.value === "demo:x")!.tone).toBeUndefined();
    expect(JSON.stringify(options)).not.toContain("\\u001b");
  });
});

const tc = (res: string, o: Partial<SdmConnection>): SdmConnection => ({
  key: `sdm:${res}`, label: res, sdmResource: res, customLabel: false, legacy: false, ...o,
});

describe("buildPickerOptions: tag layout", () => {
  const CONNS = [
    tc("globex-qa-core-db-read", { tier: "qa", carrier: "Globex", env: "qa", domain: "core", access: "read" }),
    tc("acme-qa-billing-db-write", { tier: "qa", carrier: "Acme", env: "qa", domain: "billing", access: "write" }),
    tc("acme-qa-core-db-admin", { tier: "qa", carrier: "Acme", env: "qa", domain: "core", access: "admin" }),
    tc("old-acme-qa", { tier: "qa", carrier: "Acme", env: "qa", domain: "core", access: "admin", legacy: true }),
    tc("acme-qa-core-db-read", { tier: "qa", carrier: "Acme", env: "qa", domain: "core", access: "read" }),
    tc("acme-qa-core-ro", { tier: "qa", carrier: "Acme", env: "qa", domain: "core", access: "reader" }),
    tc("orphan-qa-db", { tier: "qa", env: "qa", domain: "core", access: "read" }),
    tc("acme-prod-core-db-read", { tier: "production", carrier: "Acme", env: "prod", domain: "core", access: "read" }),
    tc("untagged", {}),
  ];
  const opts = () => buildPickerOptions(CONNS, []);
  const seps = () => opts().filter(o => o.separator).map(o => o.label);
  const rowsUnder = (header: string) => {
    const all = opts();
    const start = all.findIndex(o => o.separator && o.label === header);
    const next = all.findIndex((o, i) => i > start && o.separator);
    return all.slice(start + 1, next === -1 ? undefined : next);
  };

  test("headers: environment then carrier, carrier-less after, Other last", () => {
    expect(seps()).toEqual(["QA · Acme", "QA · Globex", "QA", "Production · Acme", "Other"]);
  });

  test("rows: core first, then access read < reader < write < admin, legacy after its twin", () => {
    expect(rowsUnder("QA · Acme").map(o => o.value)).toEqual([
      "sdm:acme-qa-core-db-read", "sdm:acme-qa-core-ro", "sdm:acme-qa-core-db-admin", "sdm:old-acme-qa", "sdm:acme-qa-billing-db-write",
    ]);
  });

  test("row cells: access tone, resource, old marker", () => {
    const [read, , admin, legacy] = rowsUnder("QA · Acme");
    expect(read!.label.trim()).toBe("core");
    expect(read!.cells![0]).toMatchObject({ text: expect.stringMatching(/^read\s*$/) });
    expect(read!.cells![0]!.tone).toBeUndefined();
    expect(admin!.cells![0]).toMatchObject({ tone: "coral", bold: true });
    expect(rowsUnder("QA · Acme")[4]!.cells![0]).toMatchObject({ tone: "peach", bold: true });
    expect(legacy!.cells!.at(-1)).toEqual({ text: "old", tone: "faint" });
    expect(read!.cells![1]).toMatchObject({ text: expect.stringContaining("acme-qa-core-db-read"), tone: "dim" });
  });

  test("access and resource columns are padded to one width across the list", () => {
    const rows = opts().filter(o => !o.separator && o.cells);
    expect(new Set(rows.map(r => r.cells![0]!.text.length)).size).toBe(1);
    expect(new Set(rows.map(r => r.cells![1]!.text.length)).size).toBe(1);
  });

  test("match carries carrier, environment, domain, access and resource", () => {
    const row = rowsUnder("QA · Acme")[0]!;
    expect(row.match).toBe("Acme QA qa core read acme-qa-core-db-read");
  });

  test("a custom label shows in the first column", () => {
    const o = buildPickerOptions([tc("acme-qa-core-db-read", { tier: "qa", carrier: "Acme", domain: "core", access: "read", label: "Main", customLabel: true })], []);
    expect(o[1]!.label.trim()).toBe("Main");
  });

  test("recent rows lead with carrier and environment", () => {
    const o = buildPickerOptions(CONNS, [{ key: "sdm:acme-qa-core-db-read", label: "x", sdmResource: "acme-qa-core-db-read", lastConnectedAt: "2026-07-01T00:00:00.000Z" }]);
    expect(o[0]!.label).toBe("Recent");
    expect(o[1]!.label.trim()).toBe("Acme QA  core");
  });

  test("a recent whose resource left the catalog renders from its stored label with no cells", () => {
    const o = buildPickerOptions(CONNS, [{ key: "sdm:gone", label: "Gone DB", sdmResource: "gone", tier: "qa", lastConnectedAt: "2026-07-01T00:00:00.000Z" }]);
    expect(o[1]!.label.trim()).toBe("Gone DB");
    expect(o[1]!.cells).toBeUndefined();
  });

  test("every connection appears exactly once", () => {
    const keys = opts().filter(o => !o.separator).map(o => o.value);
    expect(keys.sort()).toEqual(CONNS.map(c => c.key).sort());
  });
});

describe("the pick request", () => {
  let fake: ReturnType<typeof installFakePick> | undefined;
  afterEach(() => {
    fake?.restore();
    fake = undefined;
  });

  test("an sdm row reaches rt-ui as a bold label and a dim hint, and nothing else", async () => {
    fake = installFakePick([{ kind: "result", result: { action: "cancel", value: null, query: "" } }]);
    const options = buildPickerOptions(
      [{ ...conn("q", "qa"), standingAccess: true }, conn("d", "development")],
      [],
      new Set(["example-q"]),
    );
    await runNavPicker({ options, message: "sdm connections", breadcrumb: ["rt", "sdm", "connections"] });
    expect(fake.calls[0]!.request.rows).toEqual([
      { value: "demo:d", match: "  d", left: [{ text: "  d", bold: true, column: true }, { text: "  example-d  development", tone: "dim" }], group: "Development" },
      { value: "demo:q", match: "● q", left: [{ text: "● q", bold: true, column: true }, { text: "  example-q  qa", tone: "dim" }], group: "QA" },
    ]);
  });
});
