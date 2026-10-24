import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { BlockError } from "../blocks/diagnostics.ts";
import { blockPropValues, compileBlockSkill, includeNamesIn, includeSitesIn, unclaimedBlockKeys, type BlockValues, type PropBindings } from "../compile-blocks.ts";
import { loadBlockTree } from "../blocks/tree.ts";
import { layeredFromManifest } from "../manifest-merge.ts";
import { loadAttachment, loadInclude, loadStepSource, type PluginRoots } from "../sources.ts";
import type { CompiledFile, PlannedAttachments, StepSource } from "../types.ts";
import type { BlockTree } from "../blocks/types.ts";
import { newTeamContext, type TeamContext } from "../team-params.ts";

const FIX = join(import.meta.dir, "fixtures", "blocks");
const MANIFEST = join(FIX, "mattstack-home", "repos", "my-repo", "skills.jsonc");
const VERB = { name: "mini", engine: "mini", description: "Run the mini widget step" };
const made: string[] = [];

afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rt-compile-blocks-"));
  made.push(dir);
  return dir;
}

function setup(): { roots: PluginRoots; mattstack: string; widgets: string } {
  const root = tmp();
  cpSync(FIX, root, { recursive: true });
  const mattstack = join(root, "plugins", "mattstack");
  const widgets = join(root, "pack");
  return { roots: { byName: { mattstack: { dir: mattstack, version: "1.0.0" }, widgets: { dir: widgets, version: "0.1.0" } }, list: [] }, mattstack, widgets };
}

function bindingsOf(text: string, path = MANIFEST): PropBindings {
  return { layered: layeredFromManifest(text).layered, manifest: { path, text } };
}

function valuesFor(step: StepSource, roots: PluginRoots, b: PropBindings, extra: { tree: BlockTree; plugin: string; version: string }[] = []): BlockValues {
  const trees = [{ tree: step.tree!, plugin: step.plugin, version: step.version }, ...extra];
  return blockPropValues(trees, b, (binding, prop) => loadAttachment(binding, prop, roots), new Set());
}

type MiniOpts = {
  manifest?: string;
  stageDir?: string | null;
  verbSides?: Record<string, "skills" | "attachments">;
  packRoot?: boolean;
  team?: TeamContext;
  verb?: typeof VERB;
  side?: "skills" | "attachments";
  loadIncludes?: boolean;
  packName?: string;
  prep?: (s: ReturnType<typeof setup>) => void;
  planned?: (s: ReturnType<typeof setup>) => PlannedAttachments;
};

function compileMini(opts: MiniOpts = {}) {
  const s = setup();
  opts.prep?.(s);
  const step = loadStepSource("mini", s.roots) as StepSource & { tree: BlockTree };
  const values = valuesFor(step, s.roots, bindingsOf(opts.manifest ?? readFileSync(MANIFEST, "utf8")));
  const result = compileBlockSkill(opts.verb ?? VERB, step, values, new Set(["mattstack:model-tiering"]), {
    stageDir: opts.stageDir ?? null,
    verbSides: opts.verbSides,
    side: opts.side,
    packRoot: opts.packRoot ? s.widgets : undefined,
    team: opts.team,
    loadInclude: opts.loadIncludes ? (name) => loadInclude(name, s.roots) : undefined,
    packName: opts.packName,
    plannedAttachments: opts.planned?.(s),
  });
  const skillMd = result.files.find((f) => f.path === "SKILL.md");
  return { ...s, result, skillMd: skillMd && "content" in skillMd ? skillMd.content : "" };
}

function diagnosticsOf(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    if (err instanceof BlockError) return err.diagnostics;
    throw err;
  }
  throw new Error("expected a BlockError");
}

describe("compileBlockSkill", () => {
  test("the mini tree compiles to one SKILL.md with depth-set headings and no placeholders", () => {
    const { result, skillMd } = compileMini();

    expect(result.diagnostics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(skillMd.startsWith('---\nname: "mini"\ndescription: "Run the mini widget step"\nallowed-tools:\n')).toBe(true);
    expect(skillMd).toContain('  - "Bash(${CLAUDE_SKILL_DIR}/parts/rules/lint.sh)"\n');
    expect(skillMd).toContain(
      '  compiled: "mattstack@1.0.0 + widgets:mini-rules/fast@0.1.0 + mattstack:model-tiering@1.0.0 + mattstack:style-floor@1.0.0"\n',
    );
    expect(skillMd).toContain("<!-- compiled by rt skills compile");
    expect(skillMd.split("\n").filter((l) => l.startsWith("#"))).toEqual(["# mini", "## Run the step", "### Check the result", "## Ask the gate", "## Notes"]);
    expect(skillMd).not.toContain("{{");
    expect(skillMd).toContain("<!-- part: prop:mini.rules binding=widgets:mini-rules/fast version=0.1.0 path=attachments/mini-rules/fast.md lines=1-2 -->\nFollow the fast widget rules.\nRun ${CLAUDE_SKILL_DIR}/parts/rules/lint.sh first.");
  });

  test("the pack's empty tiering falls back to its default, a public skill bound by reference", () => {
    const { skillMd } = compileMini();
    expect(skillMd).toContain("Prop tiering is bound to `mattstack:model-tiering` (mattstack:model-tiering@1.0.0) -- invoke that skill when this flow needs it.");
  });

  test("a per-file value's sibling files vendor under parts/<prop>; no block file is vendored", () => {
    const { result } = compileMini({
      prep: ({ mattstack }) => {
        mkdirSync(join(mattstack, "attachments", "pipeline", "mini", "scripts"), { recursive: true });
        writeFileSync(join(mattstack, "attachments", "pipeline", "mini", "scripts", "go.sh"), "echo go\n");
      },
    });
    expect(result.files.map((f) => f.path)).toEqual(["SKILL.md", "scripts/go.sh", "parts/rules/lint.sh"]);
  });

  test("a block's own ${CLAUDE_SKILL_DIR} paths move to the stage dir; prop values keep their parts path", () => {
    const { skillMd } = compileMini({
      stageDir: "${CLAUDE_SKILL_DIR}/../../attachments/mini",
      prep: ({ mattstack }) => {
        const run = join(mattstack, "attachments", "pipeline", "mini", "run", "index.block.md");
        writeFileSync(run, readFileSync(run, "utf8").replace("Do the work for the widget.", "Run ${CLAUDE_SKILL_DIR}/scripts/go.sh for the widget."));
      },
    });
    expect(skillMd).toContain("Run ${CLAUDE_SKILL_DIR}/../../attachments/mini/scripts/go.sh for the widget.");
    expect(skillMd).toContain("Run ${CLAUDE_SKILL_DIR}/../../attachments/mini/parts/rules/lint.sh first.");
  });

  test("two values vendoring the same file to one place are refused, naming both sources", () => {
    const manifest = '{ "bindings": { "mattstack:mini": { "rules": "widgets:mini-rules/fast" } }, "layered": { "mattstack:mini": { "rules": [{ "layer": "base:acme", "value": "widgets:more-rules" }, { "layer": "pack", "value": "widgets:mini-rules/fast" }] } } }';
    const { result } = compileMini({
      manifest,
      prep: ({ widgets }) => {
        mkdirSync(join(widgets, "attachments", "more-rules"), { recursive: true });
        writeFileSync(join(widgets, "attachments", "more-rules", "SKILL.md"), '---\nname: more-rules\nmetadata:\n  provides: "mini-rules@1"\n---\n\nMore rules.\n');
        writeFileSync(join(widgets, "attachments", "more-rules", "lint.sh"), "echo other\n");
      },
    });
    expect(result.files).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ file: "attachments/pipeline/mini/index.block.md", code: "vendor-collision" });
    expect(result.diagnostics[0]!.message).toMatch(/more-rules\/lint\.sh and .*mini-rules\/lint\.sh would both vendor to parts\/rules\/lint\.sh/);
  });

  test("a render problem comes back as structured diagnostics with no files", () => {
    const { result } = compileMini({
      prep: ({ mattstack }) => {
        const gate = join(mattstack, "attachments", "pipeline", "mini", "gate.block.md");
        writeFileSync(gate, readFileSync(gate, "utf8").replace("{{props.tiering}}", "See {{props.tiering}} here."));
      },
    });
    expect(result.files).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["bad-marker"]);
  });

  test("a fill reaching another attachment by a hand-typed path fails with hand-typed-path and a pack.path fix", () => {
    const { result } = compileMini({
      packRoot: true,
      prep: ({ widgets }) => {
        mkdirSync(join(widgets, "attachments", "capture-evidence"), { recursive: true });
        writeFileSync(join(widgets, "attachments", "capture-evidence", "SKILL.md"), "evidence\n");
        writeFileSync(join(widgets, "attachments", "mini-rules", "fast.md"), "Follow the fast widget rules.\nRead ../../attachments/capture-evidence/SKILL.md first.\n");
      },
    });
    expect(result.files).toEqual([]);
    expect(result.diagnostics).toEqual([{
      file: "attachments/mini-rules/fast.md",
      line: 2,
      col: 6,
      code: "hand-typed-path",
      message: "hand-typed path ../../attachments/capture-evidence/SKILL.md breaks when its target moves; write {{pack.path:capture-evidence/SKILL.md}} instead",
      fix: { length: 43, text: "{{pack.path:capture-evidence/SKILL.md}}" },
    }]);
  });

  describe("pack.path takes a team value", () => {
    const teamWith = (params: Record<string, string>) => newTeamContext({ plugin: "widgets", version: "0.1.0", params, sections: {} }, new Set(["widgets"]));
    const gatesFill = (body: string) => ({ widgets }: ReturnType<typeof setup>) => {
      mkdirSync(join(widgets, "attachments", "widgets-gates"), { recursive: true });
      writeFileSync(join(widgets, "attachments", "widgets-gates", "SKILL.md"), "gates\n");
      writeFileSync(join(widgets, "attachments", "mini-rules", "fast.md"), body);
    };

    test("a fill's {{pack.path:{{team.<key>}}/<file>}} compiles to the attachment the team names", () => {
      const { result, skillMd } = compileMini({ packRoot: true, team: teamWith({ "gates-fill": "widgets-gates" }), prep: gatesFill("Read {{pack.path:{{team.gates-fill}}/SKILL.md}} first.\n") });
      expect(result.diagnostics).toEqual([]);
      expect(skillMd).toContain("Read ${CLAUDE_SKILL_DIR}/references/widgets-gates/SKILL.md first.");
      expect(result.files).toContainEqual({ path: "references/widgets-gates/SKILL.md", content: "gates\n" });
    });

    test("a team value naming a missing attachment fails with pack.path's own error", () => {
      expect(() => compileMini({ packRoot: true, team: teamWith({ "gates-fill": "gone-gates" }), prep: gatesFill("Read {{pack.path:{{team.gates-fill}}/SKILL.md}} first.\n") })).toThrow(
        "widgets:mini-rules/fast: {{pack.path:gone-gates/SKILL.md}} -- gone-gates is not a directory under attachments/ or skills/",
      );
    });

    test("a hand-typed path picking its attachment by team value gets a fix that compiles", () => {
      const team = teamWith({ "gates-fill": "widgets-gates" });
      const hand = "Read ../../attachments/{{team.gates-fill}}/SKILL.md first.\n";
      const { result } = compileMini({ packRoot: true, team, prep: gatesFill(hand) });
      expect(result.files).toEqual([]);
      expect(result.diagnostics).toMatchObject([{ code: "hand-typed-path", fix: { length: 46, text: "{{pack.path:{{team.gates-fill}}/SKILL.md}}" } }]);
      const fix = result.diagnostics[0]!.fix!;
      const fixed = hand.slice(0, 5) + fix.text + hand.slice(5 + fix.length);
      const again = compileMini({ packRoot: true, team: teamWith({ "gates-fill": "widgets-gates" }), prep: gatesFill(fixed) });
      expect(again.result.diagnostics).toEqual([]);
      expect(again.skillMd).toContain("${CLAUDE_SKILL_DIR}/references/widgets-gates/SKILL.md");
    });

    test("with no team value the hand-typed path gets no fix", () => {
      const { result } = compileMini({ packRoot: true, team: teamWith({}), prep: gatesFill("Read ../../attachments/{{team.gates-fill}}/SKILL.md first.\n") });
      expect(result.diagnostics).toMatchObject([{ code: "hand-typed-path" }]);
      expect(result.diagnostics[0]!.fix).toBeUndefined();
    });
  });

  describe("team sections and values take pack.path", () => {
    const teamWith = (params: Record<string, string>, sections: Record<string, string> = {}) =>
      newTeamContext({ plugin: "widgets", version: "0.1.0", params, sections }, new Set(["widgets"]));
    const gates = (body: string) => ({ widgets }: ReturnType<typeof setup>) => {
      mkdirSync(join(widgets, "attachments", "widgets-gates"), { recursive: true });
      writeFileSync(join(widgets, "attachments", "widgets-gates", "SKILL.md"), "gates\n");
      mkdirSync(join(widgets, "attachments", "provision"), { recursive: true });
      writeFileSync(join(widgets, "attachments", "provision", "SKILL.md"), "provision\n");
      writeFileSync(join(widgets, "attachments", "mini-rules", "fast.md"), body);
    };
    const contentOf = (files: CompiledFile[], path: string) => {
      const file = files.find((f) => f.path === path);
      return file && "content" in file ? file.content : undefined;
    };

    test("a section's pack.path renders into the built skill's references/ and copies the unit", () => {
      const team = teamWith({}, { gates: "Read {{pack.path:widgets-gates/SKILL.md}} first.\n" });
      const { result, skillMd } = compileMini({ packRoot: true, team, prep: gates("Rules:\n{{team.section:gates}}\n") });
      expect(result.diagnostics).toEqual([]);
      expect(skillMd).toContain("Read ${CLAUDE_SKILL_DIR}/references/widgets-gates/SKILL.md first.");
      expect(contentOf(result.files, "references/widgets-gates/SKILL.md")).toBe("gates\n");
    });

    test("a param value's pack.path resolves where it lands", () => {
      const team = teamWith({ provision: "{{pack.path:provision/SKILL.md}}" });
      const { result, skillMd } = compileMini({ packRoot: true, team, prep: gates("Provision with {{team.provision}}.\n") });
      expect(result.diagnostics).toEqual([]);
      expect(skillMd).toContain("Provision with ${CLAUDE_SKILL_DIR}/references/provision/SKILL.md.");
      expect(contentOf(result.files, "references/provision/SKILL.md")).toBe("provision\n");
    });

    test("a section spliced into a base attachment copied into references/ resolves from that copy", () => {
      const team = teamWith({}, { gates: "Read {{pack.path:widgets-gates/SKILL.md}} first.\n" });
      const { result } = compileMini({
        packRoot: true,
        team,
        prep: (s) => {
          gates("See {{pack.path:acme-kit/SKILL.md}}.\n")(s);
          mkdirSync(join(s.widgets, "..", "acme-kit"), { recursive: true });
          writeFileSync(join(s.widgets, "..", "acme-kit", "SKILL.md"), "Kit.\n{{team.section:gates}}\n");
        },
        planned: (s) => Object.assign(new Map([["acme-kit", new Set(["SKILL.md"])]]), { sources: new Map([["acme-kit", { dir: join(s.widgets, "..", "acme-kit"), base: "acme-base" }]]) }),
      });
      expect(result.diagnostics).toEqual([]);
      expect(contentOf(result.files, "references/acme-kit/SKILL.md")).toBe("Kit.\nRead ${CLAUDE_SKILL_DIR}/references/widgets-gates/SKILL.md first.\n");
      expect(contentOf(result.files, "references/widgets-gates/SKILL.md")).toBe("gates\n");
    });
  });

  describe("a built skill reads its own rendered references", () => {
    const unit = (widgets: string, name: string, files: Record<string, string>) => {
      for (const [rel, text] of Object.entries(files)) {
        mkdirSync(join(widgets, "attachments", name, rel, ".."), { recursive: true });
        writeFileSync(join(widgets, "attachments", name, rel), text);
      }
    };
    const withFill = (body: string, units: Record<string, Record<string, string>>) => ({ widgets }: ReturnType<typeof setup>) => {
      for (const [name, files] of Object.entries(units)) unit(widgets, name, files);
      writeFileSync(join(widgets, "attachments", "mini-rules", "fast.md"), body);
    };
    const contentOf = (files: CompiledFile[], path: string) => {
      const file = files.find((f) => f.path === path);
      return file && "content" in file ? file.content : undefined;
    };
    const references = (files: CompiledFile[]) => files.map((f) => f.path).filter((p) => p.startsWith("references/"));
    const GATES = { "SKILL.md": "gates\n" };
    const READ_GATES = "Read {{pack.path:widgets-gates/SKILL.md}} first.\n";

    test("two built skills that pack.path one file each get their own rendered copy", () => {
      const prep = withFill(READ_GATES, { "widgets-gates": GATES });
      const one = compileMini({ packRoot: true, prep });
      const two = compileMini({ packRoot: true, prep, verb: { ...VERB, name: "mini-two" } });
      for (const { result, skillMd } of [one, two]) {
        expect(result.diagnostics).toEqual([]);
        expect(skillMd).toContain("Read ${CLAUDE_SKILL_DIR}/references/widgets-gates/SKILL.md first.");
        expect(references(result.files)).toEqual(["references/widgets-gates/SKILL.md"]);
        expect(contentOf(result.files, "references/widgets-gates/SKILL.md")).toBe("gates\n");
      }
    });

    test("a stage reads its copy under its own folder", () => {
      const { result, skillMd } = compileMini({
        packRoot: true,
        side: "attachments",
        stageDir: "${CLAUDE_SKILL_DIR}/../../attachments/mini",
        prep: withFill(READ_GATES, { "widgets-gates": GATES }),
      });
      expect(result.diagnostics).toEqual([]);
      expect(skillMd).toContain("Read ${CLAUDE_SKILL_DIR}/../../attachments/mini/references/widgets-gates/SKILL.md first.");
      expect(references(result.files)).toEqual(["references/widgets-gates/SKILL.md"]);
    });

    test("a copied file's pack.path copies that unit into the same references and renders to its path", () => {
      const { result } = compileMini({
        packRoot: true,
        prep: withFill(READ_GATES, {
          "widgets-gates": { "SKILL.md": "Follow {{pack.path:widgets-conventions/SKILL.md}}.\n", "scripts/check.sh": "echo check\n" },
          "widgets-conventions": { "SKILL.md": "Conventions. Back to {{pack.path:widgets-gates/SKILL.md}}.\n" },
        }),
      });
      expect(result.diagnostics).toEqual([]);
      expect(references(result.files)).toEqual(["references/widgets-gates/SKILL.md", "references/widgets-gates/scripts/check.sh", "references/widgets-conventions/SKILL.md"]);
      expect(contentOf(result.files, "references/widgets-gates/SKILL.md")).toBe("Follow ${CLAUDE_SKILL_DIR}/references/widgets-conventions/SKILL.md.\n");
      expect(contentOf(result.files, "references/widgets-conventions/SKILL.md")).toBe("Conventions. Back to ${CLAUDE_SKILL_DIR}/references/widgets-gates/SKILL.md.\n");
      expect(result.files.find((f) => f.path === "references/widgets-gates/scripts/check.sh")).toMatchObject({ copyFrom: expect.stringContaining("attachments/widgets-gates/scripts/check.sh") });
    });

    test("a copied python3 command renders to the script's copy", () => {
      const { result } = compileMini({
        packRoot: true,
        prep: withFill(READ_GATES, {
          "widgets-gates": { "SKILL.md": "Run `python3 {{pack.path:capture-evidence/backend-db.py}} --env qa`.\n" },
          "capture-evidence": { "SKILL.md": "evidence\n", "backend-db.py": "print('{{not a placeholder}}')\n" },
        }),
      });
      expect(result.diagnostics).toEqual([]);
      expect(contentOf(result.files, "references/widgets-gates/SKILL.md")).toBe("Run `python3 ${CLAUDE_SKILL_DIR}/references/capture-evidence/backend-db.py --env qa`.\n");
      expect(references(result.files)).toContain("references/capture-evidence/backend-db.py");
      expect(references(result.files)).toContain("references/capture-evidence/SKILL.md");
    });

    test("no copied markdown file keeps a {{", () => {
      const { result } = compileMini({
        packRoot: true,
        verbSides: { ship: "skills" },
        loadIncludes: true,
        prep: withFill(READ_GATES, {
          "widgets-gates": {
            "SKILL.md": "Then read {{verb.path:ship}}.\n\n{{include:style-floor}}\n",
            "notes/deep.md": "Up to {{verb.path:ship}} and {{pack.path:widgets-gates/SKILL.md}}.\n",
          },
        }),
      });
      expect(result.diagnostics).toEqual([]);
      const copies = result.files.filter((f) => f.path.startsWith("references/") && f.path.endsWith(".md"));
      expect(copies.map((f) => f.path)).toEqual(["references/widgets-gates/SKILL.md", "references/widgets-gates/notes/deep.md"]);
      for (const copy of copies) expect(contentOf(result.files, copy.path)).not.toContain("{{");
      expect(contentOf(result.files, "references/widgets-gates/SKILL.md")).toStartWith("Then read ../../../ship/SKILL.md.\n\n<!-- part: include:style-floor");
      expect(contentOf(result.files, "references/widgets-gates/SKILL.md")).toContain("Write short sentences.");
      expect(contentOf(result.files, "references/widgets-gates/notes/deep.md")).toBe("Up to ../../../../ship/SKILL.md and ${CLAUDE_SKILL_DIR}/references/widgets-gates/SKILL.md.\n");
    });

    test("a copied prop value's own ${CLAUDE_SKILL_DIR} points at its copy, and its inlined parts path is unchanged", () => {
      const pointAtRules = ({ mattstack }: ReturnType<typeof setup>) => {
        const run = join(mattstack, "attachments", "pipeline", "mini", "run", "index.block.md");
        writeFileSync(run, readFileSync(run, "utf8").replace("Do the work for the widget.", "Do the work; the rules are in {{pack.path:mini-rules/fast.md}}."));
      };
      const pub = compileMini({ packRoot: true, prep: pointAtRules });
      expect(pub.result.diagnostics).toEqual([]);
      expect(pub.skillMd).toContain("the rules are in ${CLAUDE_SKILL_DIR}/references/mini-rules/fast.md.");
      expect(pub.skillMd).toContain("Run ${CLAUDE_SKILL_DIR}/parts/rules/lint.sh first.");
      expect(contentOf(pub.result.files, "references/mini-rules/fast.md")).toBe("Follow the fast widget rules.\nRun ${CLAUDE_SKILL_DIR}/references/mini-rules/lint.sh first.\n");
      expect(references(pub.result.files)).toContain("references/mini-rules/lint.sh");

      const stage = compileMini({ packRoot: true, side: "attachments", stageDir: "${CLAUDE_SKILL_DIR}/../../attachments/mini", prep: pointAtRules });
      expect(stage.skillMd).toContain("Run ${CLAUDE_SKILL_DIR}/../../attachments/mini/parts/rules/lint.sh first.");
      expect(contentOf(stage.result.files, "references/mini-rules/fast.md")).toBe(
        "Follow the fast widget rules.\nRun ${CLAUDE_SKILL_DIR}/../../attachments/mini/references/mini-rules/lint.sh first.\n",
      );
    });

    test("a copied file names its own siblings under its copy", () => {
      const { result } = compileMini({
        packRoot: true,
        prep: withFill(READ_GATES, { "widgets-gates": { "SKILL.md": "Run `bash ${CLAUDE_SKILL_DIR}/scripts/x.sh`.\n", "scripts/x.sh": "echo x\n" } }),
      });
      expect(result.diagnostics).toEqual([]);
      expect(contentOf(result.files, "references/widgets-gates/SKILL.md")).toBe("Run `bash ${CLAUDE_SKILL_DIR}/references/widgets-gates/scripts/x.sh`.\n");
      expect(references(result.files)).toContain("references/widgets-gates/scripts/x.sh");
    });

    test("a copied file renders like a base attachment: other braces pass through as text", () => {
      const { result } = compileMini({ packRoot: true, prep: withFill(READ_GATES, { "widgets-gates": { "SKILL.md": "Keep {{slot:x}} and ${{ secrets.TOKEN }} here.\n" } }) });
      expect(result.diagnostics).toEqual([]);
      expect(contentOf(result.files, "references/widgets-gates/SKILL.md")).toBe("Keep {{slot:x}} and ${{ secrets.TOKEN }} here.\n");
    });

    test("a copied file refuses a placeholder whose value depends on the skill reading it", () => {
      const refused = (text: string) => () => compileMini({ packRoot: true, prep: withFill(READ_GATES, { "widgets-gates": { "SKILL.md": text } }) });
      expect(refused("ok\nRun {{stage.dir}}/x.sh.\n")).toThrow(
        "attachments/widgets-gates/SKILL.md: {{stage.dir}} -- its value depends on the skill reading it, so a file copied into a built skill's references/ cannot carry it (line 2)",
      );
      for (const raw of ["{{stage.fields}}", "{{pipeline.stages}}", "{{pipeline.table}}", "{{run-list.pipelines}}", "{{work-type}}", "{{run-start.flags}}", "{{compiled-from}}"]) {
        expect(refused(`${raw}\n`)).toThrow(`attachments/widgets-gates/SKILL.md: ${raw} -- its value depends on the skill reading it`);
      }
      expect(refused("Hi {{team.x}}.\n")).toThrow("attachments/widgets-gates/SKILL.md: {{team.x}} -- team markers only resolve in base pack text (line 1)");
      expect(refused("{{include:gone-floor}}\n")).toThrow('attachments/widgets-gates/SKILL.md: include "gone-floor" is not a loaded attachment');
      expect(refused("See {{include:style-floor}} here.\n")).toThrow("attachments/widgets-gates/SKILL.md: {{include:style-floor}} must be alone on its line (line 1)");
    });

    test("a copied file's {{pack.name}} needs the pack's plugin name", () => {
      const prep = withFill(READ_GATES, { "widgets-gates": { "SKILL.md": "Invoke {{pack.name}}:ship.\n" } });
      expect(() => compileMini({ packRoot: true, prep })).toThrow("attachments/widgets-gates/SKILL.md: {{pack.name}} -- the pack has no .claude-plugin/plugin.json name to give it");
      const { result } = compileMini({ packRoot: true, prep, packName: "widgets" });
      expect(contentOf(result.files, "references/widgets-gates/SKILL.md")).toBe("Invoke widgets:ship.\n");
    });

    test("a missing source in a copy fails with pack.path's error", () => {
      expect(() => compileMini({
        packRoot: true,
        prep: withFill(READ_GATES, { "widgets-gates": { "SKILL.md": "See {{pack.path:gone-kit/SKILL.md}}.\n" } }),
      })).toThrow("attachments/widgets-gates/SKILL.md: {{pack.path:gone-kit/SKILL.md}} -- gone-kit is not a directory under attachments/ or skills/");
    });

    describe("a copied file's links to other units", () => {
      const KITS = { "other-kit": { "SKILL.md": "other\n" } };

      test("an attachment copy linking a sibling unit by hand fails with hand-typed-path and a pack.path fix", () => {
        const gates = "---\nname: gates\n---\nRead ../other-kit/SKILL.md first.\n";
        const { result } = compileMini({ packRoot: true, prep: withFill(READ_GATES, { ...KITS, "widgets-gates": { "SKILL.md": gates } }) });
        expect(result.files).toEqual([]);
        expect(result.diagnostics).toEqual([{
          file: "attachments/widgets-gates/SKILL.md",
          line: 4,
          col: 6,
          code: "hand-typed-path",
          message: "hand-typed path ../other-kit/SKILL.md breaks when its target moves; write {{pack.path:other-kit/SKILL.md}} instead",
          fix: { length: 21, text: "{{pack.path:other-kit/SKILL.md}}" },
        }]);

        const fixed = gates.replace("../other-kit/SKILL.md", "{{pack.path:other-kit/SKILL.md}}");
        const again = compileMini({ packRoot: true, prep: withFill(READ_GATES, { ...KITS, "widgets-gates": { "SKILL.md": fixed } }) });
        expect(again.result.diagnostics).toEqual([]);
        expect(contentOf(again.result.files, "references/widgets-gates/SKILL.md")).toContain("Read ${CLAUDE_SKILL_DIR}/references/other-kit/SKILL.md first.");
        expect(references(again.result.files)).toContain("references/other-kit/SKILL.md");
      });

      test("every spelling that leaves the unit is caught in a copy, nested files counted from their own depth", () => {
        const { result } = compileMini({
          packRoot: true,
          prep: withFill(READ_GATES, {
            ...KITS,
            "widgets-gates": {
              "SKILL.md": "See ../../attachments/other-kit/SKILL.md.\n",
              "notes/deep.md": "See ../../other-kit/SKILL.md and ${CLAUDE_SKILL_DIR}/../../attachments/other-kit/SKILL.md.\n",
            },
          }),
        });
        expect(result.files).toEqual([]);
        expect(result.diagnostics.map((d) => [d.file, d.code, d.fix?.text])).toEqual([
          ["attachments/widgets-gates/SKILL.md", "hand-typed-path", "{{pack.path:other-kit/SKILL.md}}"],
          ["attachments/widgets-gates/notes/deep.md", "hand-typed-path", "{{pack.path:other-kit/SKILL.md}}"],
          ["attachments/widgets-gates/notes/deep.md", "hand-typed-path", "{{pack.path:other-kit/SKILL.md}}"],
        ]);
      });

      test("links inside the unit stay clean", () => {
        const { result } = compileMini({
          packRoot: true,
          prep: withFill(READ_GATES, {
            "widgets-gates": { "SKILL.md": "See ./a.md and notes/deep.md.\n", "a.md": "a\n", "notes/deep.md": "Run ../scripts/x.sh, then ../a.md.\n", "scripts/x.sh": "echo x\n" },
          }),
        });
        expect(result.diagnostics).toEqual([]);
        expect(result.warnings).toEqual([]);
      });

      const withSkill = (files: Record<string, string>, extra: Record<string, Record<string, string>> = {}) => (s: ReturnType<typeof setup>) => {
        withFill("Read {{pack.path:widgets-guide/SKILL.md}} first.\n", extra)(s);
        for (const [rel, text] of Object.entries(files)) {
          mkdirSync(join(s.widgets, "skills", "widgets-guide", rel, ".."), { recursive: true });
          writeFileSync(join(s.widgets, "skills", "widgets-guide", rel), text);
        }
      };

      test("a hand-authored skill's copy warns for each link that no longer resolves, and still compiles", () => {
        const { result } = compileMini({
          packRoot: true,
          prep: withSkill({ "SKILL.md": "Read ../widgets-other/SKILL.md and ${CLAUDE_SKILL_DIR}/../../attachments/other-kit/SKILL.md.\n" }, KITS),
        });
        expect(result.diagnostics).toEqual([]);
        expect(contentOf(result.files, "references/widgets-guide/SKILL.md")).toBeDefined();
        expect(result.warnings).toEqual([
          "skills/widgets-guide/SKILL.md: ../widgets-other/SKILL.md does not resolve from its copy in references/widgets-guide/",
          "skills/widgets-guide/SKILL.md: ${CLAUDE_SKILL_DIR}/../../attachments/other-kit/SKILL.md does not resolve from its copy in references/widgets-guide/",
        ]);
      });

      test("a hand-authored skill's copy keeps quiet about links inside it", () => {
        const { result } = compileMini({
          packRoot: true,
          prep: withSkill({ "SKILL.md": "See ./a.md.\n", "a.md": "a\n", "notes/deep.md": "Run ../scripts/x.sh.\n", "scripts/x.sh": "echo x\n" }),
        });
        expect(result.diagnostics).toEqual([]);
        expect(result.warnings).toEqual([]);
      });
    });

    test("a pack.path into a block tree is refused, since its blocks would ship unrendered", () => {
      const tree = { "SKILL.md": "gates\n", "index.block.md": "---\nid: gates\n---\n# Gates\n\n{{props.rule}}\n" };
      expect(() => compileMini({ packRoot: true, prep: withFill(READ_GATES, { "widgets-gates": tree }) })).toThrow(
        "{{pack.path:widgets-gates/SKILL.md}} -- attachments/widgets-gates holds a block tree (index.block.md); a file copied into a built skill's references/ ships as written, so its blocks would reach the agent unrendered",
      );
      const nested = { "SKILL.md": "gates\n", "deep/index.block.md": "---\nid: deep\n---\n# Deep\n" };
      expect(() => compileMini({ packRoot: true, prep: withFill(READ_GATES, { "widgets-gates": nested }) })).toThrow("attachments/widgets-gates holds a block tree (deep/index.block.md)");
    });

    test("a copy that would land on an engine's own references file is a vendor collision", () => {
      const { result } = compileMini({
        packRoot: true,
        prep: (s) => {
          withFill(READ_GATES, { "widgets-gates": GATES })(s);
          const own = join(s.mattstack, "attachments", "pipeline", "mini", "references", "widgets-gates");
          mkdirSync(own, { recursive: true });
          writeFileSync(join(own, "SKILL.md"), "the engine's own\n");
        },
      });
      expect(result.files).toEqual([]);
      expect(result.diagnostics).toMatchObject([{ code: "vendor-collision" }]);
      expect(result.diagnostics[0]!.message).toContain("would both vendor to references/widgets-gates/SKILL.md");
    });
  });

  test("a hand-typed path on a fill's indented first line is placed at its real column", () => {
    const { result } = compileMini({
      packRoot: true,
      prep: ({ widgets }) => {
        mkdirSync(join(widgets, "attachments", "capture-evidence"), { recursive: true });
        writeFileSync(join(widgets, "attachments", "capture-evidence", "SKILL.md"), "evidence\n");
        writeFileSync(join(widgets, "attachments", "mini-rules", "fast.md"), "\n   Read ../../attachments/capture-evidence/SKILL.md first.\n");
      },
    });
    expect(result.diagnostics).toMatchObject([{ file: "attachments/mini-rules/fast.md", line: 2, col: 9, code: "hand-typed-path" }]);
  });

  test("an engine block naming a compiled verb by a hand-typed path fails with a verb.path fix", () => {
    const { result } = compileMini({
      verbSides: { ship: "skills" },
      prep: ({ mattstack }) => {
        const run = join(mattstack, "attachments", "pipeline", "mini", "run", "index.block.md");
        writeFileSync(run, readFileSync(run, "utf8").replace("Do the work for the widget.", "Then read ../ship/SKILL.md."));
      },
    });
    expect(result.files).toEqual([]);
    expect(result.diagnostics).toMatchObject([
      { file: "attachments/pipeline/mini/run/index.block.md", line: 7, col: 11, code: "hand-typed-path", fix: { length: 16, text: "{{verb.path:ship}}" } },
    ]);
  });

  test("the stage dir rewrite emits ../../attachments paths, which the rule never sees", () => {
    const { result } = compileMini({ stageDir: "${CLAUDE_SKILL_DIR}/../../attachments/mini" });
    expect(result.diagnostics).toEqual([]);
  });
});

describe("blockPropValues", () => {
  test("a binding to a block the tree does not have is missing-block at the manifest key", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const text = '{\n  "bindings": {\n    "mattstack:mini/nope": { "rules": "x:y" }\n  }\n}\n';
    expect(() => valuesFor(step, roots, bindingsOf(text))).toThrow(/skills\.jsonc:\d+:\d+: .*block "mini\/nope"/);
    expect(diagnosticsOf(() => valuesFor(step, roots, bindingsOf(text)))).toEqual([
      { file: MANIFEST, line: 3, col: 5, code: "missing-block", message: 'binding "mattstack:mini/nope": mattstack:mini has no block "mini/nope"' },
    ]);
  });

  test("a prop the block does not declare is unknown-prop at the prop key", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const text = '{\n  "bindings": {\n    "mattstack:mini/gate": {\n      "style": "mattstack:style-floor"\n    }\n  }\n}\n';
    expect(diagnosticsOf(() => valuesFor(step, roots, bindingsOf(text)))).toEqual([
      { file: MANIFEST, line: 4, col: 7, code: "unknown-prop", message: 'binding "mattstack:mini/gate": block "mini/gate" declares no prop "style"' },
    ]);
  });

  test("a v1 binding to a slot the engine replaced is old-slot-binding, naming the engine and listing its props", () => {
    const mattstack = join(import.meta.dir, "..", "..", "..", "plugins", "mattstack");
    const roots: PluginRoots = { byName: { mattstack: { dir: mattstack, version: "1.0.0" } }, list: [] };
    const step = loadStepSource("ship", roots);
    const text = '{\n  "bindings": {\n    "mattstack:ship": { "domain": "w:x" }\n  }\n}\n';
    const [d, ...rest] = diagnosticsOf(() => valuesFor(step, roots, bindingsOf(text)));
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ file: MANIFEST, line: 3, col: 25, code: "old-slot-binding" });
    expect(d!.message).toStartWith('"mattstack:ship" no longer has slot "domain", bound by this pack; its props are: ');
    expect(d!.message).toContain("ship/flow/domain-fast-checks.rules (add)");
  });

  test("an old slot key the org base bound names the base pack as the layer that bound it", () => {
    const mattstack = join(import.meta.dir, "..", "..", "..", "plugins", "mattstack");
    const roots: PluginRoots = { byName: { mattstack: { dir: mattstack, version: "1.0.0" } }, list: [] };
    const step = loadStepSource("ship", roots);
    const text =
      '{\n  "bindings": { "mattstack:ship": { "domain": "w:y" } },\n' +
      '  "layered": { "mattstack:ship": { "domain": [{ "layer": "base:acme-base", "value": "w:x" }, { "layer": "pack", "value": "w:y" }] } }\n}\n';
    const [d, ...rest] = diagnosticsOf(() => valuesFor(step, roots, bindingsOf(text)));
    expect(rest).toEqual([]);
    expect(d!.code).toBe("old-slot-binding");
    expect(d!.message).toStartWith('"mattstack:ship" no longer has slot "domain", bound by the org base pack acme-base and this pack; its props are: ');
  });

  test("an old slot key the override layer bound names the overrides file", () => {
    const mattstack = join(import.meta.dir, "..", "..", "..", "plugins", "mattstack");
    const roots: PluginRoots = { byName: { mattstack: { dir: mattstack, version: "1.0.0" } }, list: [] };
    const step = loadStepSource("ship", roots);
    const text =
      '{\n  "bindings": { "mattstack:ship": { "domain": "w:y" } },\n' +
      '  "layered": { "mattstack:ship": { "domain": [{ "layer": "override", "value": "w:y" }] } }\n}\n';
    const [d] = diagnosticsOf(() => valuesFor(step, roots, bindingsOf(text)));
    expect(d!.message).toStartWith('"mattstack:ship" no longer has slot "domain", bound by your overrides file (~/.mattstack/user/skills/overrides.jsonc); its props are: ');
    expect(d!.message).not.toContain("the repo override");
  });

  test("a value that loads nothing is fill-missing at that layer's value, naming the binding key", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const text = '{\n  "bindings": { "mattstack:mini": { "rules": "widgets:mini-rules/slow" } },\n  "layered": { "mattstack:mini": { "rules": [\n    { "layer": "base:acme", "value": "widgets:mini-rules/fast" },\n    { "layer": "pack", "value": "widgets:mini-rules/slow" }\n  ] } }\n}\n';
    const [d, ...rest] = diagnosticsOf(() => valuesFor(step, roots, bindingsOf(text)));
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ file: MANIFEST, line: 5, col: 33, code: "fill-missing" });
    expect(d!.message).toStartWith('binding "mattstack:mini" rules (from pack): loadAttachment: prop "rules": binding "widgets:mini-rules/slow": no file at ');
  });

  test("a bad value from a pipeline's own section is placed in that section", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const text = '{\n  "pipelines": { "feature": {\n    "bindings": { "mattstack:mini": { "rules": "widgets:mini-rules/a/b" } }\n  } }\n}\n';
    const b: PropBindings = { layered: {}, pipelineLayered: layeredFromManifest(text).pipelineLayered.feature, pipeline: "feature", manifest: { path: MANIFEST, text } };
    expect(diagnosticsOf(() => valuesFor(step, roots, b))[0]).toMatchObject({ line: 3, col: 48, code: "bad-value" });
  });

  test("a pipeline section's key naming a missing block is missing-block at its own line", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const text = '{\n  "bindings": { "mattstack:mini": { "rules": "widgets:mini-rules/fast" } },\n  "pipelines": { "feature": {\n    "stages": ["mattstack:mini"],\n    "bindings": {\n      "mattstack:mini/nope": { "rules": "widgets:mini-rules/fast" }\n    }\n  } }\n}\n';
    const { layered, pipelineLayered } = layeredFromManifest(text);
    const b: PropBindings = { layered, pipelineLayered: pipelineLayered.feature, pipeline: "feature", manifest: { path: MANIFEST, text } };
    expect(diagnosticsOf(() => valuesFor(step, roots, b))).toEqual([
      { file: MANIFEST, line: 6, col: 7, code: "missing-block", message: 'binding "mattstack:mini/nope": mattstack:mini has no block "mini/nope"' },
    ]);
  });

  test("a typo key in a pipeline section is checked even when no stage copy compiles that section", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const text = '{\n  "bindings": {},\n  "pipelines": { "feature": {\n    "stages": ["mattstack:mini"],\n    "bindings": {\n      "mattstack:mini/gaet": { "tiering": "" },\n      "mattstack:mini/gate": { "tiring": "" }\n    }\n  } }\n}\n';
    const b: PropBindings = { layered: {}, pipelineSections: layeredFromManifest(text).pipelineLayered, manifest: { path: MANIFEST, text } };
    expect(diagnosticsOf(() => valuesFor(step, roots, b))).toEqual([
      { file: MANIFEST, line: 6, col: 7, code: "missing-block", message: 'binding "mattstack:mini/gaet": mattstack:mini has no block "mini/gaet"' },
      { file: MANIFEST, line: 7, col: 32, code: "unknown-prop", message: 'binding "mattstack:mini/gate": block "mini/gate" declares no prop "tiring"' },
    ]);
  });

  test("a block key, top level or pipeline section, whose tree nothing loaded is missing-block at its key", () => {
    const text = '{\n  "bindings": { "mattstack:mini/gate": { "a": "" }, "mattstack:gate-protocl/ask": { "a": "" }, "mattstack:plain": { "a": "" } },\n  "pipelines": { "feature": {\n    "stages": ["mattstack:mini"],\n    "bindings": {\n      "mattstack:stage-x/flow": { "a": "" }\n    }\n  } }\n}\n';
    const { layered, pipelineLayered } = layeredFromManifest(text);
    const b: PropBindings = { layered, pipelineSections: pipelineLayered, manifest: { path: MANIFEST, text } };
    expect(unclaimedBlockKeys(b, new Set(["mattstack:mini"]))).toEqual([
      { file: MANIFEST, line: 2, col: 53, code: "missing-block", message: 'binding "mattstack:gate-protocl/ask" names a block of mattstack:gate-protocl, which no compiled verb loads' },
      { file: MANIFEST, line: 6, col: 7, code: "missing-block", message: 'binding "mattstack:stage-x/flow" names a block of mattstack:stage-x, which no compiled verb loads' },
    ]);
  });

  test("an unclaimed key only the default or a base layer bound is not this pack's to fix", () => {
    const text =
      "// provenance (binding <- layer):\n" +
      "//   mattstack:stage-x/flow a <- default\n" +
      "//   mattstack:stage-y/flow a <- base:acme-base\n" +
      "//   mattstack:stage-z/flow a <- override\n" +
      '{\n  "bindings": {\n' +
      '    "mattstack:stage-x/flow": { "a": "" },\n' +
      '    "mattstack:stage-y/flow": { "a": "" },\n' +
      '    "mattstack:stage-z/flow": { "a": "" },\n' +
      '    "mattstack:gate-protocl/ask": { "a": "" },\n' +
      '    "mattstack:stage-w/flow": { "a": "" }\n' +
      "  },\n" +
      '  "layered": { "mattstack:stage-w/flow": { "a": [{ "layer": "base:acme-base", "value": "" }, { "layer": "pack", "value": "" }] } }\n' +
      "}\n";
    const b: PropBindings = { layered: layeredFromManifest(text).layered, manifest: { path: MANIFEST, text } };
    expect(unclaimedBlockKeys(b, new Set(["mattstack:mini"])).map((d) => d.message)).toEqual([
      'binding "mattstack:stage-z/flow" names a block of mattstack:stage-z, which no compiled verb loads',
      'binding "mattstack:gate-protocl/ask" names a block of mattstack:gate-protocl, which no compiled verb loads',
      'binding "mattstack:stage-w/flow" names a block of mattstack:stage-w, which no compiled verb loads',
    ]);
  });

  test("a binding whose value breaks the prop's contract is contract-mismatch at the manifest value", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const text = readFileSync(MANIFEST, "utf8").replace('"mattstack:mini/gate": { "tiering": "" }', '"mattstack:mini/gate": { "tiering": "widgets:mini-rules/fast" }');
    expect(diagnosticsOf(() => valuesFor(step, roots, bindingsOf(text)))).toEqual([
      expect.objectContaining({ file: MANIFEST, line: 14, col: 41, code: "contract-mismatch" }),
    ]);
  });

  test("every block gets its values, defaults included", () => {
    const { roots } = setup();
    const step = loadStepSource("mini", roots);
    const values = valuesFor(step, roots, bindingsOf(readFileSync(MANIFEST, "utf8")));
    expect([...values.keys()]).toEqual(["mini", "mini/run", "mini/run/guard", "mini/run/check", "mini/gate", "mini/notes"]);
    expect(values.get("mini/gate")!.get("tiering")).toMatchObject({ fromDefault: true });
    expect(values.get("mini")!.get("rules")!.sources.map((s) => s.fill.binding)).toEqual(["widgets:mini-rules/fast"]);
  });
});

describe("tree includes", () => {
  test("an include site on an indented first text line counts the indent in its col", () => {
    const dir = tmp();
    writeFileSync(join(dir, "index.block.md"), "---\n---\n\n# host\n\n  {{include:gate-protocol}}\n");
    expect(includeSitesIn(loadBlockTree(dir, { idPrefix: "host", relRoot: "a" }))).toEqual([
      { name: "gate-protocol", file: "a/index.block.md", line: 6, col: 3 },
    ]);
  });

  test("an included tree renders in place and its props vendor under parts/+<id>/<prop>", () => {
    const s = setup();
    const inc = join(s.mattstack, "attachments", "gate-protocol");
    mkdirSync(inc, { recursive: true });
    writeFileSync(join(inc, "index.block.md"), '---\nprops:\n  rules:\n    merge: add\n    default: ""\n---\n\n# Gate protocol\n\nAsk once. See ${CLAUDE_SKILL_DIR}/gate.sh.\n\n{{props.rules}}\n');
    writeFileSync(join(inc, "gate.sh"), "echo gate\n");
    const notes = join(s.mattstack, "attachments", "pipeline", "mini", "notes.block.md");
    writeFileSync(notes, `${readFileSync(notes, "utf8")}\n{{include:gate-protocol}}\n`);

    const step = loadStepSource("mini", s.roots) as StepSource & { tree: BlockTree };
    expect(includeNamesIn(step.tree)).toEqual(["gate-protocol"]);
    const gp = loadInclude("gate-protocol", s.roots);
    const text = '{ "bindings": { "mattstack:gate-protocol": { "rules": "widgets:mini-rules/fast" } } }';
    const values = valuesFor(step, s.roots, bindingsOf(text), [{ tree: gp.tree!, plugin: gp.plugin, version: gp.version }]);
    const result = compileBlockSkill(VERB, step, values, new Set(["mattstack:model-tiering"]), { includes: { "gate-protocol": gp } });
    const md = (result.files[0] as { content: string }).content;

    expect(result.diagnostics).toEqual([]);
    expect(md).toContain("### Gate protocol\n\nAsk once. See ${CLAUDE_SKILL_DIR}/parts/include-gate-protocol/gate.sh.");
    expect(md).toContain("Run ${CLAUDE_SKILL_DIR}/parts/+gate-protocol/rules/lint.sh first.");
    expect(result.files.map((f) => f.path)).toEqual(["SKILL.md", "parts/+gate-protocol/rules/lint.sh", "parts/include-gate-protocol/gate.sh"]);
  });

  test("a fill's include of a block-tree attachment renders the tree where the include line was", () => {
    const s = setup();
    const inc = join(s.mattstack, "attachments", "tone-lookup");
    mkdirSync(inc, { recursive: true });
    writeFileSync(join(inc, "index.block.md"), "---\n---\n\n# Tone lookup\n\nRead the tone from ${CLAUDE_SKILL_DIR}/tone.txt.\n");
    writeFileSync(join(inc, "tone.txt"), "plain\n");
    const fast = join(s.widgets, "attachments", "mini-rules", "fast.md");
    writeFileSync(fast, `${readFileSync(fast, "utf8")}\n{{include:tone-lookup}}\n`);

    const step = loadStepSource("mini", s.roots) as StepSource & { tree: BlockTree };
    const tl = loadInclude("tone-lookup", s.roots);
    expect(tl.tree).toBeDefined();
    const values = valuesFor(step, s.roots, bindingsOf(readFileSync(MANIFEST, "utf8")), [{ tree: tl.tree!, plugin: tl.plugin, version: tl.version }]);
    const result = compileBlockSkill(VERB, step, values, new Set(["mattstack:model-tiering"]), { includes: { "tone-lookup": tl } });
    const md = (result.files[0] as { content: string }).content;

    expect(result.diagnostics).toEqual([]);
    expect(md).toContain("Run ${CLAUDE_SKILL_DIR}/parts/rules/lint.sh first.\n");
    expect(md).toContain("Tone lookup\n\nRead the tone from ${CLAUDE_SKILL_DIR}/parts/include-tone-lookup/tone.txt.");
    expect(md).not.toContain("{{include:tone-lookup}}");
    expect(result.files.map((f) => f.path)).toContain("parts/include-tone-lookup/tone.txt");
  });

  test("a fill's include of a name that is no attachment is still refused", () => {
    const s = setup();
    const fast = join(s.widgets, "attachments", "mini-rules", "fast.md");
    writeFileSync(fast, `${readFileSync(fast, "utf8")}\n{{include:gone-lookup}}\n`);
    const step = loadStepSource("mini", s.roots) as StepSource & { tree: BlockTree };
    const values = valuesFor(step, s.roots, bindingsOf(readFileSync(MANIFEST, "utf8")));
    expect(() => compileBlockSkill(VERB, step, values, new Set(["mattstack:model-tiering"]), {})).toThrow('include "gone-lookup" is not a loaded attachment');
  });
});
