# sdm picker tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt sdm connect`'s picker groups every resource by its StrongDM tags (environment, then carrier), colours risky access, and reads carrier names and resource overrides from two new team settings, `sdm.resources` and `sdm.carriers`.

**Architecture:** `lib/sdm/browse.ts` derives tier, carrier, domain and access from the catalog tags the scanner already parses. `lib/sdm/picker.ts` lays the rows out under `<Env> · <Carrier>` headers with extra cells, which `NavOption` gains through two optional fields that `navOptionsToRows` forwards to the Go picker. The enrichment map moves from `rt.sdmEnrichment` to `sdm.resources` through a setup migration, with the old key still read as a fallback.

**Tech Stack:** Bun + TypeScript (rt), zod settings registry in `packages/rt-client`, React console settings page (`apps/console`, vitest).

**Spec:** `docs/superpowers/specs/2026-10-07-sdm-picker-tags-design.md`

## Global Constraints

- This repo is public. Fixtures, comments, commit messages and the PR body use invented names only (`acme`, `globex`, `initech`). Never a real tenant, carrier, resource or employer name. Run `PURITY_BASE=origin/main scripts/repo-purity.sh` after `git add`, before each commit.
- Run `bun test` from the repo root (the worktree root), never from a subdirectory, so the HOME-isolating preload loads.
- `sdm.resources` and `sdm.carriers`: `scopes: ["team"]`, `merge: "replace"`, NO `default` (ownership latch).
- No colours or ANSI on the TS side; tones are names (`peach`, `coral`, `dim`, `faint`, `blue`).
- After touching `packages/rt-client/src`, run `bun run build` in `packages/rt-client` (stale `dist/` trap; `packages/rt-client/test/dist-freshness.test.ts` guards it).
- Under `apps/console`, run `bun run format:check` before committing.
- Comments only state constraints the code cannot show.
- Commit after each task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A resource with no tags at all (status-only rows the scanner folds in with `tags: []`) must still appear, in "Other", with its raw name and no crash.
2. A hyphenated tenant (`acme-perf`) must not be mistaken for `acme` when inferring a carrier from a name, and a name that matches two tenants takes the longer one.
3. A recent entry whose resource left the catalog still renders from its stored label, with no cells and no thrown error.
4. A team that already holds both `rt.sdmEnrichment` and `sdm.resources` is left untouched by the migration (never overwritten).
5. Rows from other pickers that use `NavOption` (no `cells`, no `match`) render byte-for-byte as before.

Each line has a test in the owning task (Tasks 3, 3, 5, 4, 5).

---

### Task 1: Registry rows for `sdm.resources` and `sdm.carriers`

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (after the `rt.sdmEnrichment` row, ~line 237)
- Modify: `packages/rt-client/src/settings/registry-schemas.ts` (~line 163)
- Modify: `packages/rt-client/src/settings/__tests__/schema-examples.ts` (~line 159)
- Modify: `packages/rt-client/src/settings/__tests__/registry.test.ts`
- Regenerate: `packages/rt-client/src/settings/schema.lock.json`

**Interfaces:**
- Produces: registry keys `sdm.resources` (value type `Record<string, { label?, tier?, production?, reasonSuggestion?, db? }>`) and `sdm.carriers` (`Record<string, { label: string }>`), readable as `Value<"sdm.resources">` / `Value<"sdm.carriers">` from `lib/settings/registry-schemas.ts`.

- [ ] **Step 1: Read the add-a-key checklist**

Read the "add a key" checklist in `docs/settings-architecture.md` and follow any step this plan does not list (it is the source of truth for registry changes).

- [ ] **Step 2: Write the failing registry tests**

In `packages/rt-client/src/settings/__tests__/registry.test.ts`, next to the `rt.sdmEnrichment` test (~line 146), add:

```ts
    test("sdm.resources and sdm.carriers are team maps with no default (ownership latch)", () => {
      for (const key of ["sdm.resources", "sdm.carriers"]) {
        const def = getDef(key);

        expect(def?.scopes).toEqual(["team", "org"]);
        expect(def?.type).toBe("object");
        expect(def?.merge).toBe("replace");
        expect(def?.default).toBeUndefined();
      }
    });
```

Add `"sdm.carriers"` and `"sdm.resources"` to the `suiteKeys` array in the "has exactly the 28 migrated:true keys and the 49 suite keys" test (~line 306) and bump `49` to `51` in its title and any count assertion in that test.

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test packages/rt-client/src/settings/__tests__/registry.test.ts`
Expected: FAIL (`def` undefined for `sdm.resources`, suite key list mismatch).

- [ ] **Step 4: Add the registry rows**

In `registry-defs.ts`, directly after the `rt.sdmEnrichment` row:

```ts
  // The sdm.* rows carry NO `default`: loadEnrichment's latch reads
  // `value === undefined` as "fall back to rt.sdmEnrichment, then the file".
  {
    key: "sdm.resources",
    type: "object",
    scopes: ["team"],
    merge: "replace",
    description: "Per-resource overrides for the rt sdm picker: resource name -> label/tier/production/reasonSuggestion/db. Team-only, since it names employer resources. Replaces rt.sdmEnrichment; the store value wins wholesale.",
  },
  {
    key: "sdm.carriers",
    type: "object",
    scopes: ["team"],
    merge: "replace",
    description: "Display names for StrongDM tenant tags in the rt sdm picker: tenant tag -> { label }. A tag with no entry shows capitalised. Team-only, since it names employer customers.",
  },
```

Change the `rt.sdmEnrichment` row's description to start with `"Deprecated: replaced by sdm.resources, which the 2026-10-07-sdm-resources-key migration moves it to. "` followed by the existing text.

- [ ] **Step 5: Add the zod schemas**

In `registry-schemas.ts`, lift the enrichment entry into a const above the schema map (next to the other shared consts such as `presetEntry`):

```ts
const sdmResourceEntry = z.looseObject({
  label: z.string().optional(),
  tier: z.string().optional(),
  production: z.boolean().optional(),
  reasonSuggestion: z.string().optional(),
  db: z.looseObject({ database: z.string().optional(), schema: z.string().optional(), user: z.string().optional() }).optional(),
});
```

Replace the `rt.sdmEnrichment` entry with `"rt.sdmEnrichment": z.record(z.string(), sdmResourceEntry),` and add:

```ts
  "sdm.resources": z.record(z.string(), sdmResourceEntry).meta({ labels: { key: "resource", value: "override" } }),
  "sdm.carriers": z.record(z.string(), z.looseObject({ label: z.string() })).meta({ labels: { key: "tenant tag", value: "carrier" } }),
```

Check how other entries in this file attach JSON-schema extras such as `labels` (search the file for `labels`); if they use a different helper than `.meta`, use that helper instead.

- [ ] **Step 6: Add schema examples**

In `schema-examples.ts`, after `rt.sdmEnrichment`:

```ts
  "sdm.resources": {
    good: [{}, { "acme-staging-db": { label: "Staging DB", tier: "staging", production: false, reasonSuggestion: "debugging", db: { database: "app", schema: "public", user: "readonly" } } }],
    bad: [{ value: { "acme-staging-db": { production: "no" } }, path: ["acme-staging-db", "production"] }],
  },
  "sdm.carriers": {
    good: [{}, { acme: { label: "Acme Corp" } }],
    bad: [{ value: { acme: { label: 7 } }, path: ["acme", "label"] }],
  },
```

- [ ] **Step 7: Regenerate the schema lock**

Run: `bun run cli.ts settings schema lock`
Expected: `schema.lock.json` gains `sdm.resources` and `sdm.carriers`. If it prints drafts or asks for `storeVersion`, follow its `next` line.

- [ ] **Step 8: Run the tests**

Run: `bun test packages/rt-client/src/settings/__tests__/ commands/__tests__/settings-schema.test.ts`
Expected: PASS.

- [ ] **Step 9: Rebuild rt-client dist and commit**

```bash
(cd packages/rt-client && bun run build)
git add packages/rt-client/src/settings
PURITY_BASE=origin/main scripts/repo-purity.sh
git commit -m "settings: add sdm.resources and sdm.carriers team keys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Enrichment reads `sdm.resources` first; carrier names loader

**Files:**
- Modify: `lib/sdm/enrichment.ts`
- Modify: `lib/sdm/__tests__/enrichment.test.ts`
- Modify: `commands/sdm.ts` (`enrichmentCmd` doc comment ~line 630)

**Interfaces:**
- Consumes: registry keys from Task 1.
- Produces:
  - `type CarrierNames = Record<string, { label: string }>` (exported from `lib/sdm/enrichment.ts`)
  - `loadCarriers(): CarrierNames` — never throws, `{}` when unset or invalid.
  - `probeEnrichmentStore()` now returns the first of `sdm.resources`, `rt.sdmEnrichment` that is set.
  - `EnrichmentEntry` becomes `Value<"sdm.resources">[string]`.

- [ ] **Step 1: Write the failing tests**

Append to the `loadEnrichment` describe in `lib/sdm/__tests__/enrichment.test.ts`:

```ts
  test("sdm.resources wins over rt.sdmEnrichment and the file", () => {
    const p = write(`{ "file-only": { "label": "from file" } }`);
    writeStore(sharedStorePath("acme"), {
      "sdm.resources": { "acme-db-qa": { label: "new key" } },
      "rt.sdmEnrichment": { "acme-db-qa": { label: "old key" } },
    });

    expect(loadEnrichment(p)).toEqual({ "acme-db-qa": { label: "new key" } });
  });

  test("rt.sdmEnrichment still wins over the file when sdm.resources is unset", () => {
    const p = write(`{ "file-only": { "label": "from file" } }`);
    writeStore(sharedStorePath("acme"), { "rt.sdmEnrichment": { "acme-db-qa": { label: "old key" } } });

    expect(loadEnrichment(p)).toEqual({ "acme-db-qa": { label: "old key" } });
  });
```

Add a new describe below it:

```ts
describe("loadCarriers", () => {
  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "car-home-")));
  });

  test("unset -> {}", () => {
    expect(loadCarriers()).toEqual({});
  });

  test("reads the team map", () => {
    writeStore(sharedStorePath("acme"), { "sdm.carriers": { globex: { label: "Globex Corp" } } });

    expect(loadCarriers()).toEqual({ globex: { label: "Globex Corp" } });
  });

  test("an invalid value -> {} (never throws)", () => {
    writeStore(sharedStorePath("acme"), { "sdm.carriers": ["nope"] });

    expect(loadCarriers()).toEqual({});
  });
});
```

Update the import line to `import { loadCarriers, loadEnrichment, stripJsonc } from "../enrichment.ts";`. If the existing warn test in this file (`ignoring "rt.sdmEnrichment"`, ~line 95) sets `setWarningLog`, copy its before/after warning reset into the new describe so no warning leaks.

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/sdm/__tests__/enrichment.test.ts`
Expected: FAIL (`loadCarriers` not exported; first new test returns the old key's value).

- [ ] **Step 3: Implement**

In `lib/sdm/enrichment.ts`, replace the `EnrichmentEntry` type, `SETTING_KEY` and `probeEnrichmentStore` with:

```ts
export type EnrichmentEntry = Value<"sdm.resources">[string];
export type CarrierNames = Record<string, { label: string }>;

const ENRICHMENT_KEYS = ["sdm.resources", "rt.sdmEnrichment"] as const;

function probeKey<T>(key: string): T | undefined {
  try {
    return getSetting<T>(key).value;
  } catch (err) {
    const message = (err as Error).message;
    warn("sdm", `ignoring "${key}" -- ${message}`, {
      show: { title: "Your sdm settings are being ignored", hint: message.split("\n")[0], next: out.cmd("rt settings check") },
    });
    return undefined;
  }
}

/**
 * The ownership-latch probe: `undefined` means neither key is set and the
 * legacy file stays authoritative. `sdm.resources` outranks the deprecated
 * `rt.sdmEnrichment` for a team whose owner has not run the migration.
 */
export function probeEnrichmentStore(): Record<string, EnrichmentEntry> | undefined {
  for (const key of ENRICHMENT_KEYS) {
    const value = probeKey<Record<string, EnrichmentEntry>>(key);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function loadCarriers(): CarrierNames {
  return probeKey<CarrierNames>("sdm.carriers") ?? {};
}
```

Keep the existing warn title text if a test pins it: run the existing tests; if `"Your sdm enrichment setting is being ignored"` is asserted, keep that exact title for the enrichment keys and use `"Your sdm carrier names are being ignored"` for `sdm.carriers` (pass the title into `probeKey` as a second argument).

Update the module doc comment's first paragraph to name `sdm.resources` (then `rt.sdmEnrichment`) as the store keys. Update `enrichmentCmd`'s doc comment in `commands/sdm.ts` the same way (`rt.sdmEnrichment` -> `sdm.resources`).

- [ ] **Step 4: Run tests**

Run: `bun test lib/sdm/__tests__/enrichment.test.ts lib/sdm/__tests__/enrichment-cmd.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sdm/enrichment.ts lib/sdm/__tests__/enrichment.test.ts commands/sdm.ts
PURITY_BASE=origin/main scripts/repo-purity.sh
git commit -m "sdm: read sdm.resources before rt.sdmEnrichment, load carrier names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Derive tier, carrier, domain and access from tags

**Files:**
- Modify: `lib/sdm/browse.ts`
- Modify: `lib/sdm/__tests__/browse.test.ts`
- Modify: `commands/sdm.ts:435` (pass carriers)

**Interfaces:**
- Consumes: `CarrierNames`, `loadCarriers` from Task 2.
- Produces (exported from `lib/sdm/browse.ts`):
  - `SdmConnection` gains `carrier?: string`, `carrierTag?: string`, `env?: string`, `domain?: string`, `access?: string`, `legacy?: boolean`, `customLabel?: boolean`.
  - `buildSdmConnections(resources: SdmResource[], enrichment: Record<string, EnrichmentEntry>, carriers?: CarrierNames): SdmConnection[]`
  - `carrierFromName(name: string, known: string[]): string | undefined`
  - `tierFromEnv(env: string | undefined): string | undefined`

- [ ] **Step 1: Write the failing tests**

Append to `lib/sdm/__tests__/browse.test.ts`:

```ts
import { carrierFromName, tierFromEnv } from "../browse.ts";

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

describe("carrierFromName", () => {
  test("matches whole dash segments only", () => {
    expect(carrierFromName("acmeco-qa", ["acme"])).toBeUndefined();
    expect(carrierFromName("x-acme-qa", ["acme"])).toBe("acme");
  });
  test("longest match wins", () => {
    expect(carrierFromName("acme-perf-db", ["acme", "acme-perf"])).toBe("acme-perf");
  });
});

describe("tierFromEnv", () => {
  test("maps dev/prod, passes others, undefined stays undefined", () => {
    expect(tierFromEnv("dev")).toBe("development");
    expect(tierFromEnv("prod")).toBe("production");
    expect(tierFromEnv("training")).toBe("training");
    expect(tierFromEnv(undefined)).toBeUndefined();
  });
});
```

Move the new `import` line to the top of the file next to the existing import.

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/sdm/__tests__/browse.test.ts`
Expected: FAIL (exports missing).

- [ ] **Step 3: Implement**

Replace the body of `lib/sdm/browse.ts` below the imports with:

```ts
import type { CarrierNames, EnrichmentEntry } from "./enrichment.ts";

export interface SdmConnection {
  key: string;
  label: string;
  sdmResource: string;
  tier?: string;
  production?: boolean;
  reasonSuggestion?: string;
  db?: { database?: string; schema?: string; user?: string };
  /** Connectable without an access request (carried from the scan). */
  standingAccess?: boolean;
  carrier?: string;
  carrierTag?: string;
  env?: string;
  domain?: string;
  access?: string;
  /** No tenant tag: an older resource whose carrier, if any, came from its name. */
  legacy?: boolean;
  /** The label came from enrichment rather than the tags. */
  customLabel?: boolean;
}

const ENV_TIER: Record<string, string> = { dev: "development", prod: "production" };

export function tierFromEnv(env: string | undefined): string | undefined {
  return env === undefined ? undefined : (ENV_TIER[env] ?? env);
}

function tagMap(tags: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const tag of tags) {
    const eq = tag.indexOf("=");
    if (eq > 0) map[tag.slice(0, eq)] = tag.slice(eq + 1);
  }
  return map;
}

export function carrierFromName(name: string, known: string[]): string | undefined {
  const padded = `-${name}-`;
  let best: string | undefined;
  for (const tenant of known) {
    if (padded.includes(`-${tenant}-`) && (best === undefined || tenant.length > best.length)) best = tenant;
  }
  return best;
}

function carrierLabel(tag: string, carriers: CarrierNames): string {
  return carriers[tag]?.label || tag.charAt(0).toUpperCase() + tag.slice(1);
}

export function buildSdmConnections(
  resources: SdmResource[],
  enrichment: Record<string, EnrichmentEntry>,
  carriers: CarrierNames = {},
): SdmConnection[] {
  const tagsOf = new Map(resources.map(r => [r.name, tagMap(r.tags)]));
  const known = [...new Set([...tagsOf.values()].map(t => t.tenant).filter((t): t is string => !!t))];
  return resources
    .map(r => {
      const e = enrichment[r.name];
      const tags = tagsOf.get(r.name)!;
      const carrierTag = tags.tenant ?? carrierFromName(r.name, known);
      const carrier = carrierTag === undefined ? undefined : carrierLabel(carrierTag, carriers);
      const built = carrier === undefined ? r.name : [carrier, tags.env, tags.domain, tags.access].filter(Boolean).join(" ");
      const label = e?.label ?? built;
      return {
        key: `sdm:${r.name}`,
        label,
        sdmResource: r.name,
        tier: e?.tier ?? tierFromEnv(tags.env),
        production: e?.production ?? false,
        reasonSuggestion: e?.reasonSuggestion ?? `investigating ${label} data`,
        db: e?.db,
        standingAccess: r.standingAccess,
        carrier,
        carrierTag,
        env: tags.env,
        domain: tags.domain,
        access: tags.access,
        legacy: tags.tenant === undefined,
        customLabel: e?.label !== undefined,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
```

Keep the existing `import type { SdmResource } from "./scan.ts";` and update the module doc comment: a resource with no enrichment entry still gets a row, with its tier, carrier and label from its StrongDM tags.

In `commands/sdm.ts` (~line 435), change:

```ts
  const connections = buildSdmConnections(resources, loadEnrichment());
```

to

```ts
  const connections = buildSdmConnections(resources, loadEnrichment(), loadCarriers());
```

and add `loadCarriers` to that file's existing import from `../lib/sdm/enrichment.ts`.

- [ ] **Step 4: Run tests**

Run: `bun test lib/sdm/__tests__/browse.test.ts lib/sdm/__tests__/`
Expected: PASS. The old test "unmapped resource shows raw name, no tier" still passes (its resources have no tags).

- [ ] **Step 5: Commit**

```bash
git add lib/sdm/browse.ts lib/sdm/__tests__/browse.test.ts commands/sdm.ts
PURITY_BASE=origin/main scripts/repo-purity.sh
git commit -m "sdm: derive tier, carrier, domain and access from catalog tags

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Migration `2026-10-07-sdm-resources-key`

**Files:**
- Create: `lib/setup/migrations/sdm-resources-key.ts`
- Create: `lib/setup/migrations/__tests__/sdm-resources-key.test.ts` (if `lib/setup/migrations/__tests__/` does not exist, put it where `retire-switchboard-url`'s test lives: `git grep -l retireSwitchboardUrlMigration -- '*test*'`)
- Modify: `lib/setup/migrations/index.ts`
- Modify: `lib/setup/__tests__/*` only if a test pins the `MIGRATIONS` id list (`git grep -n "retire-switchboard-url" -- lib/setup/__tests__`)

**Interfaces:**
- Consumes: registry keys from Task 1.
- Produces: `sdmResourcesKeyMigration: MigrationDef` with id `"2026-10-07-sdm-resources-key"`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { seedOrg } from "../../../../packages/rt-client/test/org-fixture.ts";
import { sdmResourcesKeyMigration } from "../sdm-resources-key.ts";
import type { ApplyContext } from "../../apply.ts";

const ENR = { "acme-db-qa": { label: "Acme QA" } };
const run = () => sdmResourcesKeyMigration.run({} as ApplyContext);
const store = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

describe("2026-10-07-sdm-resources-key", () => {
  beforeEach(() => {
    process.env.HOME = realpathSync(mkdtempSync(join(tmpdir(), "sdm-mig-")));
  });

  const roles = { admins: [], teams: { gadgets: { owners: ["me"] }, widgets: { owners: ["someone-else"] } } };

  test("moves rt.sdmEnrichment to sdm.resources in a team this Mac owns", async () => {
    const { teamStores } = seedOrg({ username: "me", roles, roster: [{ username: "me", teams: ["gadgets"] }], teams: { gadgets: { "rt.sdmEnrichment": ENR } } });

    const result = await run();

    expect(result.state).toBe("done");
    const after = store(teamStores.gadgets!);
    expect(after["sdm.resources"]).toEqual(ENR);
    expect(after["rt.sdmEnrichment"]).toBeUndefined();
  });

  test("leaves a team this Mac does not own alone", async () => {
    const { teamStores } = seedOrg({ username: "me", roles, roster: [{ username: "me", teams: ["gadgets"] }], teams: { widgets: { "rt.sdmEnrichment": ENR } } });

    const result = await run();

    expect(result.state).toBe("skipped");
    expect(store(teamStores.widgets!)["rt.sdmEnrichment"]).toEqual(ENR);
  });

  test("never overwrites a team that already has sdm.resources", async () => {
    const kept = { "acme-db-qa": { label: "Already moved" } };
    const { teamStores } = seedOrg({ username: "me", roles, roster: [{ username: "me", teams: ["gadgets"] }], teams: { gadgets: { "rt.sdmEnrichment": ENR, "sdm.resources": kept } } });

    const result = await run();

    expect(result.state).toBe("skipped");
    expect(store(teamStores.gadgets!)["sdm.resources"]).toEqual(kept);
    expect(store(teamStores.gadgets!)["rt.sdmEnrichment"]).toEqual(ENR);
  });

  test("no org on this Mac -> skipped", async () => {
    expect((await run()).state).toBe("skipped");
  });
});
```

The stores are JSONC; if `setSetting` writes comments, parse with `parseStoreText` from `packages/rt-client/src/settings/stores.ts` (`.global`) instead of `JSON.parse`. If `setSetting` tries to run a team sync in the test, copy whatever stub the existing team-write tests use (`git grep -n "seedOrg" -- lib/team/__tests__ | head`).

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/setup/migrations/__tests__/sdm-resources-key.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`lib/setup/migrations/sdm-resources-key.ts`:

```ts
import { currentOrg, listTeamFolders, readStore } from "../../../packages/rt-client/src/settings/stores.ts";
import { orgSettingsPath, teamSettingsPath } from "../../../packages/rt-client/src/settings/paths.ts";
import { SettingsOwnershipRefusal, setSetting, unsetSetting } from "../../settings/write.ts";
import type { MigrationDef } from "./index.ts";

const OLD = "rt.sdmEnrichment";
const NEW = "sdm.resources";

export const sdmResourcesKeyMigration: MigrationDef = {
  id: "2026-10-07-sdm-resources-key",
  title: "Move your team's StrongDM labels to their new setting",
  async run() {
    const org = currentOrg();
    if (org === null) return { state: "skipped", detail: "This Mac is in no org" };
    const stores = [
      { scope: "org" as const, opts: {}, file: orgSettingsPath(org) },
      ...listTeamFolders(org).map(team => ({ scope: "team" as const, opts: { team }, file: teamSettingsPath(org, team) })),
    ];
    let moved = 0;
    for (const { scope, opts, file } of stores) {
      const values = readStore(file).global;
      if (!(OLD in values) || NEW in values) continue;
      try {
        setSetting(NEW, values[OLD], scope, opts);
        unsetSetting(OLD, scope, opts);
        moved++;
      } catch (err) {
        if (err instanceof SettingsOwnershipRefusal) continue;
        throw err;
      }
    }
    return moved > 0
      ? { state: "done", detail: `Moved StrongDM labels for ${moved} ${moved === 1 ? "team" : "teams"}` }
      : { state: "skipped", detail: "No StrongDM labels to move on this Mac" };
  },
};
```

If `lib/settings/write.ts` does not re-export `SettingsOwnershipRefusal`, import it from `../../../packages/rt-client/src/settings/write.ts`.

In `lib/setup/migrations/index.ts`, import it and append `sdmResourcesKeyMigration` as the last entry of `MIGRATIONS`.

- [ ] **Step 4: Run tests**

Run: `bun test lib/setup/migrations/ lib/setup/__tests__/`
Expected: PASS. If a setup snapshot test (`commands/__tests__/setup-copy.test.ts`) changes only because the migration list grew, update it deliberately with `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` and read the diff.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/migrations commands/__tests__
PURITY_BASE=origin/main scripts/repo-purity.sh
git commit -m "setup: migrate rt.sdmEnrichment to sdm.resources

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Picker plumbing and the tag layout

**Files:**
- Modify: `lib/navigate.ts:13-21` (`NavOption`)
- Modify: `lib/pick-wrappers.ts:141-159` (`navOptionsToRows`)
- Modify: `lib/sdm/picker.ts`
- Modify: `lib/sdm/__tests__/picker.test.ts`
- Test: the existing `lib/__tests__/pick-wrappers*.test.ts` (find with `git ls-files lib | grep -i pick-wrappers`)

**Interfaces:**
- Consumes: `SdmConnection` fields from Task 3.
- Produces:
  - `NavOption.cells?: { text: string; tone?: string; bold?: boolean }[]`
  - `NavOption.match?: string`
  - `buildPickerOptions(connections, recents, connectedResources?)` (same signature) returning the new layout.

- [ ] **Step 1: Write the failing plumbing test**

In the pick-wrappers test file (or a new `lib/__tests__/nav-options-rows.test.ts` that drives `runNavPicker` through `installFakePick` the way `lib/sdm/__tests__/picker.test.ts` does), add:

```ts
test("navOptionsToRows: cells append segments, match overrides the label, tone reaches the label", async () => {
  const fake = installFakePick({ select: "a" });
  await runNavPicker({
    options: [
      { value: "a", label: "core", tone: "blue", match: "acme qa core", cells: [{ text: "write", tone: "peach" }] },
      { value: "b", label: "plain", hint: "h" },
    ],
    message: "m",
  });
  const rows = fake.lastRows();
  expect(rows[0]).toMatchObject({
    match: "acme qa core",
    left: [{ text: "core", bold: true, column: true, tone: "blue" }, { text: "  write", tone: "peach" }],
  });
  expect(rows[1]).toEqual({ value: "b", match: "plain", left: [{ text: "plain", bold: true, column: true }, { text: "  h", tone: "dim" }] });
});
```

Read `lib/ui/pick-fake.ts` first and use its real API for "select this value" and "read the rows it was given"; rename `select`/`lastRows` to match. The second row pins Review Focus 5 (an option with no `cells`/`match` is unchanged).

- [ ] **Step 2: Run to verify failure**

Run: `bun test <that test file>`
Expected: FAIL (no `match`, no tone, no cells).

- [ ] **Step 3: Implement the plumbing**

`lib/navigate.ts`, inside `NavOption`:

```ts
  /** Extra segments drawn after the label (and hint), in order. */
  cells?: { text: string; tone?: string; bold?: boolean }[];
  /** The text the filter ranks; the label when absent. */
  match?: string;
```

`lib/pick-wrappers.ts`, in `navOptionsToRows`, replace the row-building lines with:

```ts
    const left: PickSegment[] = [{ text: o.label, bold: true, column: true, ...(o.tone ? { tone: o.tone } : {}) }];
    if (o.hint) left.push({ text: `  ${o.hint}`, tone: "dim" });
    for (const cell of o.cells ?? []) left.push({ text: `  ${cell.text}`, ...(cell.tone ? { tone: cell.tone } : {}), ...(cell.bold ? { bold: true } : {}) });
    // Filtering sees the label (or the option's own match text) only; the hint
    // and cells are display.
    rows.push({ value: o.value, match: o.match ?? o.label, left, ...(group ? { group } : {}) });
```

Then check nothing else sets `NavOption.tone` and would suddenly colour its label: `git grep -n "tone" -- lib/navigate.ts lib/sdm commands | grep -v PickSegment`. Only `lib/sdm/picker.ts` is expected; it is rewritten next.

Run the plumbing test: PASS. Commit:

```bash
git add lib/navigate.ts lib/pick-wrappers.ts lib/__tests__
PURITY_BASE=origin/main scripts/repo-purity.sh
git commit -m "navigate: NavOption cells and match, label tone reaches the picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Write the failing layout tests**

In `lib/sdm/__tests__/picker.test.ts`, add a tagged-connection helper and a describe:

```ts
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
```

The existing tests in this file stay; update only these two expectations if they fail for the new layout and the new layout is what the spec says:
- "unknown tiers group after known ones": with no carrier the headers are still `["Staging", "sandbox"]`.
- "tierless connections land in an Other group": replace `expect(options[1]!.hint).toContain("example-x")` with `expect(options[1]!.cells!.map(c => c.text).join(" ")).toContain("example-x")`.

- [ ] **Step 5: Run to verify failure**

Run: `bun test lib/sdm/__tests__/picker.test.ts`
Expected: FAIL on the new describe.

- [ ] **Step 6: Implement the layout**

Rewrite `lib/sdm/picker.ts` below the imports (keep `TIER_LABELS`, `TIER_ORDER`, `MAX_RECENT_ROWS`, `CONNECTED_TONE`, and the dedup-by-resource logic):

```ts
const ACCESS_ORDER = ["read", "reader", "write", "admin"];
const ACCESS_TONE: Record<string, string> = { write: "peach", admin: "coral" };

const tierLabel = (tier: string) => TIER_LABELS[tier] ?? tier;

function header(c: SdmConnection): string {
  if (!c.tier) return "Other";
  return c.carrier ? `${tierLabel(c.tier)} · ${c.carrier}` : tierLabel(c.tier);
}

function tierRank(tier: string | undefined): number {
  if (!tier) return Number.MAX_SAFE_INTEGER;
  const i = TIER_ORDER.indexOf(tier);
  return i === -1 ? TIER_ORDER.length : i;
}

function compareGroups(a: SdmConnection, b: SdmConnection): number {
  return tierRank(a.tier) - tierRank(b.tier)
    || (a.tier ?? "").localeCompare(b.tier ?? "")
    || Number(a.carrier === undefined) - Number(b.carrier === undefined)
    || (a.carrier ?? "").localeCompare(b.carrier ?? "");
}

function accessRank(access: string | undefined): number {
  const i = access === undefined ? -1 : ACCESS_ORDER.indexOf(access);
  return i === -1 ? ACCESS_ORDER.length : i;
}

function compareRows(a: SdmConnection, b: SdmConnection): number {
  return Number(a.domain !== "core") - Number(b.domain !== "core")
    || (a.domain ?? "").localeCompare(b.domain ?? "")
    || accessRank(a.access) - accessRank(b.access)
    || Number(a.legacy ?? false) - Number(b.legacy ?? false)
    || a.label.localeCompare(b.label);
}

function firstColumn(c: SdmConnection): string {
  return c.customLabel || !c.domain ? c.label : c.domain;
}

function matchText(c: SdmConnection): string {
  return [c.carrier, c.tier ? tierLabel(c.tier) : undefined, c.env, c.domain, c.access, c.sdmResource]
    .filter(Boolean).join(" ");
}

/**
 * Left gutter marks connection state at a glance: a filled dot = a live tunnel
 * right now, a check = standing access (connect with no access request),
 * blank = on-demand (connecting will prompt for an access request).
 */
function gutter(connected: boolean, standingAccess: boolean): string {
  return connected ? "● " : standingAccess ? "✓ " : "  ";
}

interface Widths { access: number; resource: number }

function cellsFor(c: SdmConnection, w: Widths): NonNullable<NavOption["cells"]> {
  const access = c.access ?? "";
  const tone = ACCESS_TONE[access];
  const cells: NonNullable<NavOption["cells"]> = [
    { text: access.padEnd(w.access), ...(tone ? { tone, bold: true } : {}) },
    { text: c.sdmResource.padEnd(w.resource), tone: "dim" },
  ];
  if (c.legacy && c.carrier) cells.push({ text: "old", tone: "faint" });
  return cells;
}

function row(c: SdmConnection, first: string, live: boolean, w: Widths): NavOption {
  return {
    value: c.key,
    label: `${gutter(live, c.standingAccess ?? false)}${first}`,
    cells: cellsFor(c, w),
    match: matchText(c),
    ...(live ? { tone: CONNECTED_TONE } : {}),
  };
}

export function buildPickerOptions(
  connections: SdmConnection[],
  recents: RecentEntry[],
  connectedResources: Set<string> = new Set(),
): NavOption[] {
  const options: NavOption[] = [];
  const isLive = (sdmResource: string) => connectedResources.has(sdmResource);
  const widths: Widths = {
    access: Math.max(0, ...connections.map(c => (c.access ?? "").length)),
    resource: Math.max(0, ...connections.map(c => c.sdmResource.length)),
  };

  // A connection's stable identity is its sdmResource, not its key: recents
  // recorded under older models carry stale keys/labels for the same resource.
  const byResource = new Map(connections.map(c => [c.sdmResource, c]));

  const recentRows = recents.slice(0, MAX_RECENT_ROWS);
  const recentResources = new Set(recentRows.map(r => r.sdmResource));
  if (recentRows.length > 0) {
    options.push(navSeparator("Recent"));
    for (const r of recentRows) {
      const cur = byResource.get(r.sdmResource);
      if (!cur) {
        options.push({ value: r.key, label: `${gutter(isLive(r.sdmResource), false)}${r.label}`, hint: r.tier ? `${r.sdmResource}  ${r.tier}` : r.sdmResource });
        continue;
      }
      const lead = cur.carrier && cur.tier ? `${cur.carrier} ${tierLabel(cur.tier)}` : undefined;
      const first = cur.customLabel || !lead ? firstColumn(cur) : `${lead}  ${firstColumn(cur)}`;
      options.push(row(cur, first, isLive(cur.sdmResource), widths));
    }
  }

  const rest = connections.filter(c => !recentResources.has(c.sdmResource));
  const groups = new Map<string, SdmConnection[]>();
  for (const c of [...rest].sort((a, b) => compareGroups(a, b) || compareRows(a, b))) {
    const h = header(c);
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h)!.push(c);
  }
  for (const [h, group] of groups) {
    options.push(navSeparator(h));
    for (const c of group) options.push(row(c, firstColumn(c), isLive(c.sdmResource), widths));
  }
  return options;
}
```

Remove the old `TIER_TONE` map and the old `row` function. Update the module doc comment: Recent first, then one group per environment and carrier, rows showing domain, access and resource.

- [ ] **Step 7: Run tests**

Run: `bun test lib/sdm/__tests__/ lib/__tests__/`
Expected: PASS. Fix the two pre-existing tests only as Step 4 describes.

- [ ] **Step 8: Commit**

```bash
git add lib/sdm/picker.ts lib/sdm/__tests__/picker.test.ts
PURITY_BASE=origin/main scripts/repo-purity.sh
git commit -m "sdm: group picker by environment and carrier, colour write and admin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: StrongDM group in console settings

**Files:**
- Modify: `apps/console/src/app/settings/groups.ts`
- Modify: `apps/console/src/app/settings/groups.test.ts`

**Interfaces:**
- Consumes: registry keys from Task 1 (console reads them through rt-client; rebuild `packages/rt-client` dist if not done).

- [ ] **Step 1: Write the failing test**

In `groups.test.ts`, add (adapt the import of `GROUPS` / helper to what the file already imports):

```ts
it('puts the sdm keys and rt.sdmEnrichment in the StrongDM group', () => {
  const strongdm = GROUPS.find(g => g.id === 'strongdm');
  expect(strongdm?.label).toBe('StrongDM');
  for (const key of ['sdm.resources', 'sdm.carriers', 'rt.sdmEnrichment'])
    expect(GROUPS.filter(g => g.match(key)).map(g => g.id)).toEqual(['strongdm']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run console:test`
Expected: FAIL (no `strongdm` group; `rt.sdmEnrichment` in `daemon`).

- [ ] **Step 3: Implement**

In `groups.ts`, remove `sdmEnrichment$|` from the daemon group's regex, and add after the `commands` group:

```ts
  {
    id: 'strongdm',
    label: 'StrongDM',
    tier: 'rt',
    blurb:
      'Carrier names and per-resource overrides for the rt sdm connection picker.',
    match: key => key.startsWith('sdm.') || key === 'rt.sdmEnrichment',
  },
```

- [ ] **Step 4: Run the console gates**

Run: `bun run console:test && bun run console:typecheck && bun run console:lint && (cd apps/console && bun run format:check)`
Expected: all PASS. If `groups.test.ts` pins the group order or count, update it to include `strongdm` after `commands`.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/app/settings
PURITY_BASE=origin/main scripts/repo-purity.sh
git commit -m "console: StrongDM settings group for sdm.* keys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs and UI validation

**Files:**
- Modify: `docs/strongdm.md` (~line 57)
- Modify: `website/docs/rt/guides/strongdm.mdx` (~line 57)

- [ ] **Step 1: Update the docs**

In both files, replace the `rt.sdmEnrichment` instructions with: overrides live in the team key `sdm.resources` (same map shape), carrier display names in `sdm.carriers` (`{ "<tenant tag>": { "label": "<name>" } }`), both editable in console settings under StrongDM or with `rt settings set sdm.carriers '<json>' --scope team`. Say that `rt setup update` moves an existing `rt.sdmEnrichment` to `sdm.resources` on the Mac of the team's owner, and that the picker now groups every resource by its StrongDM `env` and `tenant` tags with no setup. Use `acme` in every example.

- [ ] **Step 2: Run the docs gate**

Run: `bun run docs:check` (if the script exists; `grep docs:check package.json`)
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/strongdm.md website/docs/rt/guides/strongdm.mdx
PURITY_BASE=origin/main scripts/repo-purity.sh
git commit -m "docs: sdm.resources and sdm.carriers, tag-grouped picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Validate the picker in a real pane (controller does this, not a subagent)**

This step reads the real StrongDM catalog, which is fine locally; nothing from it goes into the repo or the PR. From the worktree root in a herdr pane: `bun run cli.ts sdm connect`, screenshot the picker, and compare it with board A in `~/Documents/sdm picker.pen` (headers, column alignment, peach/coral access, `old` markers, Recent rows). Type `qa write` and confirm the filter finds write rows. Press esc. Say plainly what differs from the board.

- [ ] **Step 5: Validate the console group (controller)**

Through Fast Browser, open console settings (URL from `deck list`; the worktree's console needs `bun run console:build` and a dev server, or check on main after merge), filter to StrongDM, screenshot both `sdm.carriers` and `sdm.resources` forms in light and dark. Say plainly what looks wrong.

- [ ] **Step 6: Full gates before the PR**

Run: `bun run test` (or the targeted suites if the full unit suite is too slow locally: `bun test lib/sdm lib/setup packages/rt-client/src/settings lib/__tests__ commands/__tests__/settings-schema.test.ts`), `bun run typecheck`, `PURITY_BASE=origin/main scripts/repo-purity.sh`.
Expected: PASS.
