import { spyOn } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
