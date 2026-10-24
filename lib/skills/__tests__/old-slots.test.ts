import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, dirname, join } from "path";
import { parseBlockFile } from "../blocks/frontmatter.ts";
import { OLD_SLOT_ENGINES, findOldSlotKeys } from "../old-slots.ts";

const ATTACHMENTS = join(import.meta.dir, "..", "..", "..", "plugins", "mattstack", "attachments");

function engineIndexes(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...engineIndexes(path));
    else if (name === "index.block.md") out.push(path);
  }
  return out;
}

function replacedSlotsByEngine(): Map<string, { slots: string[]; dir: string }> {
  const out = new Map<string, { slots: string[]; dir: string }>();
  for (const file of engineIndexes(ATTACHMENTS)) {
    let frontmatter: Record<string, unknown>;
    try {
      frontmatter = parseBlockFile(readFileSync(file, "utf8"), file, "index").frontmatter;
    } catch (err) {
      throw new Error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const raw = frontmatter["replaced-slots"];
    if (!Array.isArray(raw)) continue;
    out.set(basename(dirname(file)), { slots: raw.map(String), dir: dirname(file) });
  }
  return out;
}

describe("findOldSlotKeys", () => {
  test("finds an old slot key and names its successor", () => {
    expect(findOldSlotKeys({ bindings: { "mattstack:work": { tiering: "mattstack:model-tiering" } } })).toEqual([
      { key: "mattstack:work", slot: "tiering", successor: "mattstack:work/sub-agent-tiering tiering", pipeline: null },
    ]);
  });

  test("finds an old slot key inside a pipeline object", () => {
    expect(findOldSlotKeys({ pipelines: { bugfix: { bindings: { "mattstack:stage-ship": { domain: "acme:ship-rules" } } } } })).toEqual([
      { key: "mattstack:stage-ship", slot: "domain", successor: null, pipeline: "bugfix" },
    ]);
  });

  test("ignores block-form keys and shepherdr's kept props", () => {
    expect(findOldSlotKeys({
      bindings: {
        "mattstack:work/sub-agent-tiering": { tiering: "mattstack:model-tiering" },
        "mattstack:shepherdr": { strategy: "acme:fan-out" },
      },
    })).toEqual([]);
  });

  test("treats domain as old on any engine and ignores other plugins and list pipelines", () => {
    expect(findOldSlotKeys({
      pipelines: { quick: ["mattstack:stage-plan"] },
      bindings: { "mattstack:widgets": { domain: "acme:rules" }, "acme:work": { tiering: "acme:x" } },
    })).toEqual([{ key: "mattstack:widgets", slot: "domain", successor: null, pipeline: null }]);
  });

  test("matches the engines", () => {
    const engines = replacedSlotsByEngine();
    expect(engines.size).toBeGreaterThan(0);
    for (const [engine, { slots, dir }] of engines) {
      const entry = OLD_SLOT_ENGINES[engine];
      expect(entry, `engine ${engine} lists replaced-slots but is not in the table`).toBeDefined();
      for (const slot of slots) {
        const known = slot === "domain" || slot in entry!.slots || entry!.kept.includes(slot);
        expect(known, `${engine} replaced-slot ${slot} is not in the table`).toBe(true);
      }
      expect(existsSync(join(dir, "domain-rules.block.md")), `${engine} domainRules`).toBe(entry!.domainRules);
    }
    for (const [engine, entry] of Object.entries(OLD_SLOT_ENGINES)) {
      const listed = engines.get(engine)?.slots;
      expect(listed, `table engine ${engine} has no replaced-slots`).toBeDefined();
      for (const slot of [...Object.keys(entry.slots), ...entry.kept]) {
        expect(listed!.includes(slot), `table slot ${engine} ${slot} is not in its replaced-slots`).toBe(true);
      }
      for (const successor of Object.values(entry.slots)) {
        const [key, prop] = successor.split(" ");
        const blockTail = key!.slice(`mattstack:${engine}/`.length);
        const file = join(engines.get(engine)!.dir, `${blockTail}.block.md`);
        const props = parseBlockFile(readFileSync(file, "utf8"), file, blockTail).props.map((p) => p.name);
        expect(props, `${successor} names a prop its block does not declare`).toContain(prop!);
      }
    }
  });
});
