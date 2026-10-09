/**
 * The harness a compiled skill is written for. One canonical source compiles
 * once per target: a target supplies the native instruction fragments that
 * `{{harness:<fragment>}}` places, the capabilities a source may require, and
 * how a path to one of the skill's own files is spelled.
 *
 * A target is fixed at build time. Nothing here reads what is installed or a
 * user's setting, so the same sources give the same artifact on every machine.
 */

import { existsSync, readFileSync } from "fs";
import { join, relative } from "path";
import type { HarnessId, Outcome } from "../../packages/rt-client/src/agent-integrations.ts";
import { stripFrontmatter, type PluginRoots } from "./sources.ts";

/**
 * What a compiled skill can lean on in its host. A source names the ones its
 * workflow cannot run without in `metadata.harness-requires`.
 */
export const SKILL_CAPABILITIES = ["native-question-tool", "skill-resources", "subagents", "background-wait"] as const;
export type SkillCapability = (typeof SKILL_CAPABILITIES)[number];

export type FragmentSpan = { path: string; start: number; end: number };

export type SkillTarget = {
  harness: HarnessId;
  capabilities: readonly SkillCapability[];
  fragments: Record<string, string>;
  /** Where each fragment came from, so a compiled seam maps back to its file; fixture fragments have none. */
  fragmentSpans?: Record<string, FragmentSpan>;
  /** Native tool names this host does not have: a compiled body naming one is reported, never rewritten. */
  foreignTools: readonly string[];
  resourcePath(relativePath: string): Outcome<string>;
};

export const SKILL_DIR_TOKEN = "${CLAUDE_SKILL_DIR}";

/** Directory a generated target root records its harness in; a root without one holds Claude output. */
export const TARGET_MARKER = "skills-target.json";

export const DEFAULT_HARNESS = "claude";

type TargetDef = {
  capabilities: readonly SkillCapability[];
  foreignTools: readonly string[];
  resourcePath(relativePath: string): Outcome<string>;
};

function checkedRelative(relativePath: string): Outcome<string> {
  if (relativePath.startsWith("/") || relativePath.startsWith("~") || relativePath.includes("\0")) {
    return { ok: false, error: { code: "invalid", message: `"${relativePath}" is not a path inside the skill` } };
  }
  return { ok: true, data: relativePath };
}

const TARGETS: Record<string, TargetDef> = {
  claude: {
    capabilities: ["native-question-tool", "skill-resources", "subagents", "background-wait"],
    foreignTools: [],
    resourcePath: (rel) => {
      const checked = checkedRelative(rel);
      if (!checked.ok) return checked;
      return { ok: true, data: rel === "" ? SKILL_DIR_TOKEN : `${SKILL_DIR_TOKEN}/${rel}` };
    },
  },
  // Codex reads a path in a skill relative to that skill's own folder, and has
  // no variable naming the folder.
  codex: {
    capabilities: ["skill-resources"],
    foreignTools: ["AskUserQuestion"],
    resourcePath: (rel) => {
      const checked = checkedRelative(rel);
      if (!checked.ok) return checked;
      return { ok: true, data: rel === "" ? "." : rel };
    },
  },
};

export function knownHarnesses(): string[] {
  return Object.keys(TARGETS);
}

const FRAGMENT_HEADING_RE = /^## ([a-z][a-z0-9-]*)\s*$/;

/**
 * A harness attachment's fragments: each `## <name>` section, up to the next
 * one, with surrounding blank lines dropped. Text before the first section is
 * the file's own explanation and places nowhere.
 */
export function parseFragments(text: string, srcPath: string): Outcome<{ fragments: Record<string, string>; spans: Record<string, FragmentSpan> }> {
  const { body, bodyStartLine } = stripFrontmatter(text);
  const lines = body.split("\n");
  const fragments: Record<string, string> = {};
  const spans: Record<string, FragmentSpan> = {};
  let current: { name: string; from: number } | null = null;
  const close = (end: number) => {
    if (!current) return;
    let from = current.from;
    let to = end;
    while (from < to && lines[from]!.trim() === "") from++;
    while (to > from && lines[to - 1]!.trim() === "") to--;
    fragments[current.name] = lines.slice(from, to).join("\n");
    spans[current.name] = { path: srcPath, start: bodyStartLine + from, end: bodyStartLine + Math.max(from, to - 1) };
  };
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i]!.match(FRAGMENT_HEADING_RE);
    if (!heading) continue;
    close(i);
    const name = heading[1]!;
    if (name in fragments) {
      return { ok: false, error: { code: "invalid", message: `${srcPath}: fragment "${name}" is declared twice (line ${bodyStartLine + i})` } };
    }
    current = { name, from: i + 1 };
  }
  close(lines.length);
  return { ok: true, data: { fragments, spans } };
}

/**
 * Each harness's fragments file. Claude's is never `claude.md`: on a
 * case-insensitive disk Claude Code loads that name as a CLAUDE.md memory
 * file for anyone working in the folder.
 */
const FRAGMENT_FILES: Record<string, string> = { claude: "claude-code.md", codex: "codex.md" };

/** The canonical fragments file for a harness, inside the mattstack plugin root. */
export function harnessFragmentsPath(mattstackDir: string, harness: HarnessId): string {
  return join(mattstackDir, "attachments", "harness", FRAGMENT_FILES[harness] ?? `${harness}.md`);
}

/**
 * `roots` names the mattstack plugin whose harness attachment supplies the
 * fragments; a plugin without that attachment gives a target with none, and
 * a source that places one then fails to compile. `fragments` replaces the
 * attachment outright.
 */
export async function resolveHarnessTarget(
  harness: HarnessId,
  opts: { roots?: PluginRoots; fragments?: Record<string, string> } = {},
): Promise<Outcome<SkillTarget>> {
  const def = TARGETS[harness];
  if (!def) {
    return { ok: false, error: { code: "unsupported", message: `There is no skill target for ${harness}. Known targets: ${knownHarnesses().join(", ")}` } };
  }
  let fragments: Record<string, string> = {};
  let fragmentSpans: Record<string, FragmentSpan> | undefined;
  if (opts.fragments) {
    fragments = { ...opts.fragments };
  } else {
    const mattstack = opts.roots?.byName.mattstack;
    const file = mattstack ? harnessFragmentsPath(mattstack.dir, harness) : null;
    if (mattstack && file && existsSync(file)) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch (err) {
        return { ok: false, error: { code: "transient", message: `${file} could not be read: ${(err as Error).message}` } };
      }
      const parsed = parseFragments(text, relative(mattstack.dir, file));
      if (!parsed.ok) return parsed;
      fragments = parsed.data.fragments;
      fragmentSpans = parsed.data.spans;
    }
  }
  return {
    ok: true,
    data: {
      harness,
      capabilities: def.capabilities,
      fragments,
      ...(fragmentSpans && { fragmentSpans }),
      foreignTools: def.foreignTools,
      resourcePath: def.resourcePath,
    },
  };
}

/** What a compile with no target produces: the Claude artifact it always produced, with no fragments. */
export const LEGACY_CLAUDE_TARGET: SkillTarget = {
  harness: DEFAULT_HARNESS,
  capabilities: TARGETS.claude!.capabilities,
  fragments: {},
  foreignTools: [],
  resourcePath: TARGETS.claude!.resourcePath,
};

/** The source's `${CLAUDE_SKILL_DIR}` spelling is the Claude target's own, so Claude output keeps every byte of it. */
export function keepsLegacyTokens(target: SkillTarget): boolean {
  return target.harness === DEFAULT_HARNESS;
}

const SKILL_DIR_REF_RE = /\$\{CLAUDE_SKILL_DIR\}(\/[^\s"'`)\]]*)?/g;
const CLAUDE_VAR_RE = /\$\{CLAUDE_[A-Z_]+\}/;

/**
 * Spells every `${CLAUDE_SKILL_DIR}` path the way the target reads a path to
 * the skill's own files, frontmatter rules included. Throws on a path the
 * target refuses, and on any other `${CLAUDE_*}` variable left behind, since
 * only Claude expands those.
 */
export function renderForTarget(text: string, target: SkillTarget, where: string): string {
  if (keepsLegacyTokens(target)) return text;
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const rendered = line.replace(SKILL_DIR_REF_RE, (_raw, tail?: string) => {
      const rel = tail ? tail.slice(1) : "";
      const path = target.resourcePath(rel);
      if (!path.ok) throw new Error(`${where}: line ${i + 1}: ${path.error.message} for the ${target.harness} target`);
      return path.data;
    });
    const left = rendered.match(CLAUDE_VAR_RE);
    if (left) throw new Error(`${where}: ${left[0]} at line ${i + 1} has no ${target.harness} spelling`);
    return rendered;
  }).join("\n");
}

/** The capabilities `requires` names that the target lacks, in the order named; an unknown name is always missing. */
export function missingCapabilities(requires: readonly string[], target: SkillTarget): string[] {
  return requires.filter((c, i) => requires.indexOf(c) === i && !(target.capabilities as readonly string[]).includes(c));
}

export function capabilityError(where: string, capability: string, target: SkillTarget): string {
  const known = (SKILL_CAPABILITIES as readonly string[]).includes(capability);
  return known
    ? `${where}: needs the "${capability}" capability, which the ${target.harness} target does not have`
    : `${where}: requires "${capability}", which is not a skill capability (known: ${SKILL_CAPABILITIES.join(", ")})`;
}

/** One warning per foreign native tool the text names. */
export function foreignToolWarnings(text: string, target: SkillTarget): string[] {
  return target.foreignTools
    .filter((tool) => new RegExp(`\\b${tool}\\b`).test(text))
    .map((tool) => `body names ${tool}, which the ${target.harness} target does not have`);
}

const SCRIPT_COMMENT_RE = /^\s*(#|\/\/)/;
const SCRIPT_EXTS = [".sh", ".bash", ".py", ".ts", ".js", ".mjs"];

export function isShippedScript(path: string): boolean {
  return SCRIPT_EXTS.some((e) => path.endsWith(e));
}

/**
 * Advisories for a file the target ships without rendering: a script runs
 * under the host's shell, where only Claude sets `${CLAUDE_*}`, so a live
 * line naming one breaks there. Comment lines are documentation.
 */
export function scriptAdvisories(text: string, path: string, target: SkillTarget): string[] {
  if (keepsLegacyTokens(target)) return [];
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (SCRIPT_COMMENT_RE.test(line)) return;
    const hit = line.match(CLAUDE_VAR_RE);
    if (hit) out.push(`${path}:${i + 1} uses ${hit[0]}, which the ${target.harness} target does not set`);
  });
  return out;
}

/** Space- or comma-separated string, or a YAML list. */
export function readRequires(frontmatter: Record<string, unknown>): string[] {
  const meta = frontmatter.metadata && typeof frontmatter.metadata === "object" ? (frontmatter.metadata as Record<string, unknown>) : {};
  const raw = meta["harness-requires"];
  if (typeof raw === "string") return raw.split(/[\s,]+/).filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean);
  return [];
}

/** The harness a generated root holds: its marker's, else Claude's when it holds anything at all. */
export function readTargetMarker(dir: string): Outcome<string | null> {
  const path = join(dir, TARGET_MARKER);
  if (!existsSync(path)) return { ok: true, data: null };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { harness?: unknown };
    if (typeof parsed.harness !== "string") return { ok: false, error: { code: "invalid", message: `${path} names no harness` } };
    return { ok: true, data: parsed.harness };
  } catch {
    return { ok: false, error: { code: "invalid", message: `${path} is not readable JSON` } };
  }
}

export function targetMarkerText(harness: HarnessId): string {
  return `${JSON.stringify({ harness }, null, 2)}\n`;
}
