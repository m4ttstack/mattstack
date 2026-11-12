import { spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadBlockTree } from "../blocks/tree.ts";
import { isInlined, type CompileSkillOpts } from "../compile.ts";
import { compileBlockSkill, type BlockValues } from "../compile-blocks.ts";
import type { AttachmentSource, CompileResult, StepSource, VerbDef } from "../types.ts";
import * as out from "../../ui/out.ts";
import { captureOut, type CapturedOut } from "../../ui/__tests__/capture-out.ts";

let active: CapturedOut | null = null;

/**
 * What a skills command printed, as plain text: console and stream writes
 * alike, with the human gate closed. One at a time; restore() closes it.
 */
export function captureSkills(): CapturedOut {
  const io = captureOut({ console: true });
  out.__test__.reset();
  out.__test__.setHuman(() => false);
  const capture: CapturedOut = {
    ...io,
    restore: () => {
      active = null;
      io.restore();
    },
  };
  active = capture;
  return capture;
}

/**
 * Expected errors print a failure and process.exit instead of throwing a
 * stack. process.exit is mocked to throw a sentinel so the test process
 * lives; `errors` is every stderr line the call wrote. A second console.error
 * spy here would unhook the open capture's own, so this reads that capture
 * when one is open.
 */
export async function runExpectingCleanExit(fn: () => Promise<void>): Promise<{ exitCode: number | undefined; errors: string[] }> {
  const own = active ? null : captureSkills();
  const io = active!;
  const before = io.errLines().length;
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  try {
    await fn();
    return { exitCode: undefined, errors: io.errLines().slice(before) };
  } catch {
    const exitCode = exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
    return { exitCode, errors: io.errLines().slice(before) };
  } finally {
    exitSpy.mockRestore();
    own?.restore();
  }
}

type PropDecl = { contract?: string; required?: boolean };

/**
 * A one-block engine: `text` is the root's text below its frontmatter, and
 * each prop is declared on the root as `replace`, with `default: ""` unless
 * required. The root sits at skills/pipeline/<name>/index.block.md.
 */
export function oneBlockEngine(text: string, opts: { name?: string; props?: Record<string, PropDecl>; allowedTools?: string[]; stepFiles?: string[]; stageMeta?: StepSource["stageMeta"] } = {}): StepSource {
  const name = opts.name ?? "watch-ci";
  const props = Object.entries(opts.props ?? {});
  const fm = [
    "---",
    `name: ${name}`,
    'description: "engine"',
    "type: pipeline-step",
    ...(props.length > 0 ? ["props:"] : []),
    ...props.flatMap(([prop, d]) => [`  ${prop}:`, "    merge: replace", ...(d.required ? [] : ['    default: ""']), ...(d.contract ? [`    contract: "${d.contract}"`] : [])]),
    "---",
    "",
  ];
  const dir = mkdtempSync(join(tmpdir(), "rt-compile-engine-"));
  writeFileSync(join(dir, "index.block.md"), `${fm.join("\n")}\n${text}\n`);
  const tree = loadBlockTree(dir, { idPrefix: name, relRoot: `skills/pipeline/${name}` });
  return {
    name,
    plugin: "mattstack",
    version: "1.2.0",
    dir: `/plugins/mattstack/skills/pipeline/${name}`,
    srcPath: `skills/pipeline/${name}/index.block.md`,
    bodyStartLine: tree.root.bodyStartLine,
    allowedTools: opts.allowedTools ?? [],
    stepFiles: opts.stepFiles ?? [],
    stageMeta: opts.stageMeta ?? null,
    description: "",
    tree,
  };
}

/** Each bound prop takes its one fill from the pack layer, inlined or referenced the way compile decides. */
export function rootPropValues(step: StepSource, fills: Record<string, AttachmentSource | null>, internalRoster = new Set<string>()): BlockValues {
  const root = step.tree.root;
  const props = new Map(root.props.map((spec) => {
    const fill = fills[spec.name] ?? null;
    const sources = fill ? [{ layer: "pack", fill, mode: isInlined(fill, internalRoster) ? ("inline" as const) : ("reference" as const) }] : [];
    return [spec.name, { spec, sources, fromDefault: fill === null }];
  }));
  return new Map([[root.id, props]]);
}

export function compileOneBlock(v: VerbDef, step: StepSource, fills: Record<string, AttachmentSource | null>, roster: Set<string>, opts: CompileSkillOpts = {}): CompileResult {
  return compileBlockSkill(v, step, rootPropValues(step, fills, opts.internalRoster), roster, opts);
}

const twoVerbEngine = (name: string) =>
  `---\nname: ${name}\ndescription: "${name} things"\ntype: pipeline-step\nprops:\n  domain:\n    merge: replace\n    default: ""\n    contract: "domain@1"\n  guide:\n    merge: replace\n    default: ""\n    contract: "guide@1"\n---\n\nDo ${name}.\n\n{{props.domain}}\n\n{{props.guide}}\n`;

function writeTo(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/**
 * An acme pack 0.4.11 compiled against mattstack 1.0.0: two public verbs,
 * alpha and beta, each with a prop inlining the pack's own fill and a prop
 * bound by reference to the pack's own public skill, no pipeline and no
 * pointer keys. `made` collects the temp dirs for the caller to remove.
 */
export function seedTwoVerbPack(made: string[]): { packDir: string; flags: string[] } {
  const tmp = (prefix: string) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    made.push(dir);
    return dir;
  };
  const mattstackDir = tmp("rt-two-verb-mattstack-");
  const engines = join(mattstackDir, "plugins", "mattstack");
  writeTo(join(engines, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.0.0" }));
  for (const name of ["alpha", "beta"]) writeTo(join(engines, "skills", "pipeline", name, "index.block.md"), twoVerbEngine(name));

  const packDir = tmp("rt-two-verb-pack-");
  setTwoVerbPackVersion(packDir, "0.4.11");
  writeTo(join(packDir, "pack", "stubs.jsonc"), JSON.stringify({
    verbs: { alpha: { engine: "alpha", description: "Use for alpha." }, beta: { engine: "beta", description: "Use for beta." } },
  }));
  writeTo(join(packDir, "attachments", "policy", "SKILL.md"), `---\nname: policy\ndescription: "acme policy"\nmetadata:\n  provides: "domain@1"\n---\n\nFollow the acme policy.\n`);
  writeTo(join(packDir, "skills", "guide", "SKILL.md"), `---\nname: guide\ndescription: "Use when an acme flow needs the guide."\nmetadata:\n  provides: "guide@1"\n---\n\nRead the acme guide.\n`);

  const manifest = join(tmp("rt-two-verb-manifest-"), "skills.jsonc");
  writeTo(manifest, JSON.stringify({ bindings: { "mattstack:alpha": { domain: "acme:policy", guide: "acme:guide" }, "mattstack:beta": { domain: "acme:policy", guide: "acme:guide" } } }));
  return { packDir, flags: ["--pack", "acme", "--pack-dir", packDir, "--mattstack-dir", mattstackDir, "--manifest", manifest] };
}

export function setTwoVerbPackVersion(packDir: string, version: string): void {
  writeTo(join(packDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version }));
}
