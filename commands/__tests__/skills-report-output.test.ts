import { expect, test } from "bun:test";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { checkBlocks, compositionBlocks, installedCacheBlocks, materializeBlocks, packsBlocks, type CheckPayload, type CompositionPayload } from "../skills.ts";

const base: CheckPayload = { pack: "acme", packDir: "/p", verbs: [], chainErrors: [], installed: null, drift: false, mcpLint: [], scriptLint: [], strictLint: false };

test("check lists each verb, names what moved, and gives the fix once", () => {
  const payload: CheckPayload = {
    ...base,
    drift: true,
    verbs: [
      { name: "watch-ci", status: "in-sync", staleFiles: [], orphanFiles: [], side: "skills" },
      { name: "ship", status: "stale", staleFiles: ["SKILL.md"], orphanFiles: ["old.md"], side: "skills", staleBecause: ["source", "fill"] },
      { name: "plan", status: "stale", staleFiles: ["SKILL.md"], orphanFiles: [], side: "skills" },
      { name: "review", status: "never-compiled", staleFiles: [], orphanFiles: [], side: "attachments" },
    ],
    installed: { plugin: "acme", marketplace: "beacon", version: "0.5.2", sourceVersion: "0.5.3", status: "lagging" },
  };
  expect(renderPlain(checkBlocks(payload, false))).toBe(
    [
      "[ok] watch-ci  current",
      "[out of date] ship  source, fill moved: SKILL.md, old.md (orphan)",
      "[out of date] plan  changed since the last compile: SKILL.md",
      "[out of date] review  never compiled",
      "  next: rt skills compile",
      "[out of date] The installed copy is behind the source  0.5.2 installed, 0.5.3 in the source",
      "  next: rt skills sync",
      "[ok] mcp lint  clean",
      "",
    ].join("\n"),
  );
});

test("a chain error is a failed line", () => {
  expect(renderPlain(checkBlocks({ ...base, chainErrors: ['stage "stage-ship" consumes "commits" that no earlier stage produces'] }, false))).toBe(
    '[failed] stage "stage-ship" consumes "commits" that no earlier stage produces\n[ok] mcp lint  clean\n',
  );
});

test("a hostile verb name cannot forge a status row", () => {
  const text = renderPlain(checkBlocks({ ...base, verbs: [{ name: "x\n[ok] forged", status: "never-compiled", staleFiles: [], orphanFiles: [], side: "skills" }] }, false));
  expect(text.split("\n").some((l) => l.startsWith("[ok] forged"))).toBe(false);
  expect(text).toContain("[out of date] x [ok] forged  never compiled\n");
});

test("a pack that is not installed here is pending, not failed", () => {
  expect(renderPlain(installedCacheBlocks({ plugin: "acme", marketplace: "beacon", version: null, sourceVersion: "0.5.3", status: "missing" }))).toBe(
    "[not yet] This pack is not installed here  acme@beacon\n  next: rt skills sync\n",
  );
  expect(installedCacheBlocks({ plugin: "acme", marketplace: "beacon", version: "0.5.3", sourceVersion: "0.5.3", status: "current" })).toEqual([]);
});

test("no packs is a line and a note", () => {
  expect(renderPlain(packsBlocks([]))).toBe("[not yet] No packs found\n  note: A pack is a plugin from a directory marketplace that has a surface file.\n");
});

test("packs are a table that carries each folder", () => {
  expect(renderPlain(packsBlocks([{ name: "acme", dir: "/z/packs/acme", layout: "team" }]))).toBe("Pack  Layout  Folder\nacme  team    /z/packs/acme\n");
});

test("composition is one tree per verb, with engine errors as failed lines", () => {
  const slot = { contract: "c@1", required: true, fillSourcePath: null, fillVersion: null, registered: null, inlined: null };
  const payload: CompositionPayload = {
    pack: "acme",
    packDir: "/p",
    manifestPath: null,
    verbs: [
      {
        name: "watch-ci",
        engine: "watch-ci",
        engineRef: "mattstack:watch-ci",
        plugin: "mattstack",
        description: "Watch CI",
        public: true,
        sourcePath: null,
        artifactPath: "/p/skills/watch-ci",
        includes: [],
        slots: [
          { ...slot, name: "domain", boundTo: "acme:watch-ci-domain", layer: "team" },
          { ...slot, name: "forge", boundTo: null, layer: null },
        ],
      },
      { name: "ship", engine: "ship", engineRef: null, plugin: null, description: "Ship", public: false, sourcePath: null, artifactPath: "/p/attachments/ship", includes: [], slots: [], engineError: "engine not found" },
    ],
    fills: [],
    binders: [],
    pipelines: {},
  };
  expect(renderPlain(compositionBlocks(payload))).toBe(
    ["Pack acme", "watch-ci  mattstack:watch-ci, public", "  - domain  acme:watch-ci-domain  team", "  - forge   not bound", "[failed] ship  engine not found", "Fills: 0", "Binders: 0", ""].join("\n"),
  );
});

test("materialize rows: written, nothing declared, failed, and a skip", () => {
  expect(
    renderPlain(
      materializeBlocks({
        skipped: false,
        repos: [
          { name: "widgets", path: "/r/widgets", ok: true, detail: "wrote 1 pack file", migrated: "/h/widgets/skills.jsonc.migrated", pruned: ["/h/widgets/old.stale"] },
          { name: "gadgets", path: "/r/gadgets", ok: false, noManifest: true, detail: "no team declares gitlab.example.com/acme/gadgets" },
          { name: "sprockets", path: "/r/sprockets", ok: false, detail: "EACCES: permission denied" },
        ],
      } as Parameters<typeof materializeBlocks>[0]),
    ),
  ).toBe(
    [
      "[ok] widgets  wrote 1 pack file",
      "  note: Renamed the old merged file to /h/widgets/skills.jsonc.migrated",
      "  note: Set aside 1 stale bindings file: /h/widgets/old.stale",
      "[skipped] gadgets  no team declares gitlab.example.com/acme/gadgets",
      "[failed] sprockets  EACCES: permission denied",
      "",
    ].join("\n"),
  );
  expect(renderPlain(materializeBlocks({ skipped: true, reason: "engine-pack-missing: install the mattstack plugin first", repos: [] }))).toBe(
    "[skipped] Nothing was written  engine-pack-missing: install the mattstack plugin first\n",
  );
});
