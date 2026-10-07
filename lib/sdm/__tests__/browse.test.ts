import { describe, test, expect } from "bun:test";
import { buildSdmConnections, carrierFromName, tierFromEnv } from "../browse.ts";

const RES = [
  { name: "acme-db-qa", type: "postgres", tags: [], standingAccess: true },
  { name: "acme-orphan-thing", type: "postgres", tags: [], standingAccess: false },
];
const ENR = { "acme-db-qa": { label: "acme qa", tier: "qa", db: { schema: "acme" } } };

describe("buildSdmConnections", () => {
  test("enriched resource gets nice label/tier/db and a stable key", () => {
    const c = buildSdmConnections(RES, ENR).find(x => x.sdmResource === "acme-db-qa")!;
    expect(c).toMatchObject({ key: "sdm:acme-db-qa", label: "acme qa", tier: "qa", db: { schema: "acme" } });
  });
  test("carries standingAccess from the scanned resource", () => {
    const conns = buildSdmConnections(RES, ENR);
    expect(conns.find(x => x.sdmResource === "acme-db-qa")!.standingAccess).toBe(true);
    expect(conns.find(x => x.sdmResource === "acme-orphan-thing")!.standingAccess).toBe(false);
  });
  test("unmapped resource shows raw name, no tier", () => {
    const c = buildSdmConnections(RES, ENR).find(x => x.sdmResource === "acme-orphan-thing")!;
    expect(c.label).toBe("acme-orphan-thing");
    expect(c.tier).toBeUndefined();
  });
});

const tagged = (name: string, tags: Record<string, string>) => ({
  name, type: "postgres", standingAccess: false,
  tags: Object.entries(tags).map(([k, v]) => `${k}=${v}`),
});

describe("tag-derived fields", () => {
  const CATALOG = [
    tagged("acme-qa-core-db-read", { env: "qa", tenant: "acme", domain: "core", access: "read" }),
    tagged("acme-perf-staging-core-db-read", { env: "staging", tenant: "acme-perf", domain: "core", access: "read" }),
    tagged("globex-prod-core-db-write", { env: "prod", tenant: "globex", domain: "core", access: "write" }),
    tagged("old-acme-qa", { env: "qa", domain: "core", access: "admin" }),
    tagged("old-acme-perf-thing", { env: "dev", domain: "core", access: "reader" }),
    tagged("mystery-db", { env: "labs", domain: "core", access: "read" }),
    { name: "status-only-db", type: "postgres", tags: [], standingAccess: true },
  ];
  const by = (name: string, carriers = {}) => buildSdmConnections(CATALOG, {}, carriers).find(c => c.sdmResource === name)!;

  test("tier comes from env: prod -> production, dev -> development, others as-is", () => {
    expect(by("globex-prod-core-db-write").tier).toBe("production");
    expect(by("old-acme-perf-thing").tier).toBe("development");
    expect(by("acme-qa-core-db-read").tier).toBe("qa");
    expect(by("mystery-db").tier).toBe("labs");
  });

  test("an enrichment tier overrides env", () => {
    const c = buildSdmConnections(CATALOG, { "acme-qa-core-db-read": { tier: "staging" } }).find(x => x.sdmResource === "acme-qa-core-db-read")!;
    expect(c.tier).toBe("staging");
  });

  test("carrier from the tenant tag, display name from the map, else capitalised", () => {
    expect(by("globex-prod-core-db-write", { globex: { label: "Globex Corp" } })).toMatchObject({ carrier: "Globex Corp", carrierTag: "globex", legacy: false });
    expect(by("acme-qa-core-db-read")).toMatchObject({ carrier: "Acme", carrierTag: "acme" });
  });

  test("no tenant tag: carrier inferred from the name, longest known tenant wins, row is legacy", () => {
    expect(by("old-acme-qa")).toMatchObject({ carrierTag: "acme", legacy: true });
    expect(by("old-acme-perf-thing")).toMatchObject({ carrierTag: "acme-perf", legacy: true });
  });

  test("no tenant tag and no known tenant in the name: carrier unset", () => {
    expect(by("mystery-db").carrier).toBeUndefined();
  });

  test("a resource with no tags at all keeps its raw name, no tier", () => {
    const c = by("status-only-db");
    expect(c.label).toBe("status-only-db");
    expect(c.tier).toBeUndefined();
    expect(c.carrier).toBeUndefined();
  });

  test("domain, access and env carried as-is; read and reader stay distinct", () => {
    expect(by("acme-qa-core-db-read")).toMatchObject({ env: "qa", domain: "core", access: "read" });
    expect(by("old-acme-perf-thing").access).toBe("reader");
  });

  test("label: enrichment label is custom; otherwise built from carrier, env, domain, access", () => {
    const enriched = buildSdmConnections(CATALOG, { "acme-qa-core-db-read": { label: "Acme main" } }).find(x => x.sdmResource === "acme-qa-core-db-read")!;
    expect(enriched).toMatchObject({ label: "Acme main", customLabel: true });
    expect(by("acme-qa-core-db-read")).toMatchObject({ label: "Acme qa core read", customLabel: false });
  });
});

describe("production flag and empty tag values", () => {
  const prod = [tagged("globex-prod-db", { env: "prod", tenant: "globex" })];
  test("tag-derived production tier sets production; enrichment false wins", () => {
    expect(buildSdmConnections(prod, {})[0]!.production).toBe(true);
    expect(buildSdmConnections(prod, { "globex-prod-db": { production: false } })[0]!.production).toBe(false);
  });
  test("a blank scaffold entry falls back to the tags and keeps the production guard", () => {
    const c = buildSdmConnections(prod, { "globex-prod-db": { label: "", tier: "" } })[0]!;
    expect(c).toMatchObject({ tier: "production", label: "Globex prod", customLabel: false, production: true });
  });
  test("an empty tenant value is ignored: carrier inferred, row legacy", () => {
    const rs = [tagged("globex-prod-db", { tenant: "globex" }), tagged("old-globex-qa", { tenant: "" })];
    const c = buildSdmConnections(rs, {}).find(x => x.sdmResource === "old-globex-qa")!;
    expect(c).toMatchObject({ carrierTag: "globex", legacy: true });
  });
});

describe("org-prefixed legacy names", () => {
  test("a legacy row picks the later carrier even when the prefix is a tenant elsewhere", () => {
    const rs = [
      tagged("initech-core-db", { tenant: "initech" }),
      tagged("acme-core-db", { tenant: "acme" }),
      tagged("initech-acme-qa-read-only", { env: "qa" }),
    ];
    const c = buildSdmConnections(rs, {}).find(x => x.sdmResource === "initech-acme-qa-read-only")!;
    expect(c).toMatchObject({ carrierTag: "acme", legacy: true });
  });
});

describe("carrierFromName", () => {
  test("matches whole dash segments only", () => {
    expect(carrierFromName("acmeco-qa", ["acme"])).toBeUndefined();
    expect(carrierFromName("x-acme-qa", ["acme"])).toBe("acme");
  });
  test("the tenant named latest wins over an org-wide prefix", () => {
    expect(carrierFromName("initech-acme-qa-read-only", ["initech", "acme"])).toBe("acme");
  });
  test("same position: longest match wins", () => {
    expect(carrierFromName("acme-perf-db", ["acme", "acme-perf"])).toBe("acme-perf");
  });
});

describe("tierFromEnv", () => {
  test("maps dev/prod, passes others, undefined stays undefined", () => {
    expect(tierFromEnv("dev")).toBe("development");
    expect(tierFromEnv("prod")).toBe("production");
    expect(tierFromEnv("training")).toBe("training");
    expect(tierFromEnv(undefined)).toBeUndefined();
    expect(tierFromEnv("constructor")).toBe("constructor");
  });
});
