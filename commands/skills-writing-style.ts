/**
 * rt skills writing-style -- show, list, choose, or start the voice for
 * prose posted under your name (MR descriptions, commit messages, replies).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveClaudeBin } from "../lib/claude-bin.ts";
import { homeGitDir } from "../lib/setup/steps/home.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, userErrorPayload } from "../lib/errors.ts";
import { execWithTimeout } from "../lib/setup/probes.ts";
import { setSetting } from "../lib/settings/write.ts";
import { isValidSkillId, presetById, resolveWritingStyle, WRITING_STYLE_KEY, WRITING_STYLE_SOURCE_LABEL, type ResolvedWritingStyle } from "../lib/skills/writing-style.ts";
import { isStyleUsable, linkPersonalSkills, listWritingStyles, parsePluginEntries, personalSkillsDir, pluginSkillRoots, readSkillInventory } from "../lib/skills/writing-style-sources.ts";
import type { CommandContext } from "../lib/command-tree.ts";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";

export interface WritingStyleDeps {
  home: () => string;
  now: () => Date;
  /** One --json line. Human output goes through show, note and fail. */
  print: (s: string) => void;
  show: (...blocks: Block[]) => void;
  note: (...blocks: Block[]) => void;
  fail: (f: out.FailureInput) => void;
  exit: (code: number) => never;
  isTTY: () => boolean;
  pick: (message: string, options: { value: string; label: string; hint?: string }[]) => Promise<string | null>;
  prompt: (message: string) => Promise<string | null>;
  pluginListStdout: () => Promise<string | null>;
  writeSetting: (key: string, value: unknown, scope: "user" | "team") => void;
  resolve: () => ResolvedWritingStyle;
}

export function realWritingStyleDeps(): WritingStyleDeps {
  return {
    home: () => process.env.HOME ?? "",
    now: () => new Date(),
    print: (s) => out.payload(`${s}\n`),
    show: (...blocks) => out.print(...blocks),
    note: (...blocks) => out.note(...blocks),
    fail: (f) => out.fail(f),
    exit: process.exit,
    isTTY: () => process.stdin.isTTY === true,
    pick: async (message, options) => {
      const { filterableSelect } = await import("../lib/pick-wrappers.ts");
      return filterableSelect({ message, options, stderr: true });
    },
    prompt: async (message) => {
      const { textInput } = await import("../lib/ui/prompts.ts");
      const v = await textInput({ message, stderr: true });
      return v.trim() === "" ? null : v.trim();
    },
    pluginListStdout: async () => {
      const res = await execWithTimeout([resolveClaudeBin() ?? "claude", "plugin", "list", "--json"], { timeoutMs: 15_000 });
      return res.code === 0 ? res.stdout : null;
    },
    writeSetting: (key, value, scope) => setSetting(key, value, scope),
    resolve: () => resolveWritingStyle(),
  };
}

function refuse(err: UserActionableError, json: boolean, deps: WritingStyleDeps, shown?: out.FailureInput): never {
  if (json) deps.print(JSON.stringify(userErrorPayload(err, deps.now())));
  else deps.fail(shown ?? { title: err.message });
  return deps.exit(2);
}

/** rt declining by rule (a name already taken): a refused note, never a failure. Same exit and --json as refuse. */
function decline(err: UserActionableError, json: boolean, deps: WritingStyleDeps, blocks: Block[]): never {
  if (json) deps.print(JSON.stringify(userErrorPayload(err, deps.now())));
  else deps.note(...blocks);
  return deps.exit(2);
}

const NO_HOME: out.FailureInput = { title: "Your home repo does not exist yet", next: out.cmd("rt setup") };

async function inventory(deps: WritingStyleDeps) {
  const stdout = await deps.pluginListStdout();
  return readSkillInventory(deps.home(), stdout === null ? null : parsePluginEntries(stdout));
}

export async function writingStyleShow(args: string[], _ctx: CommandContext = {}, deps: WritingStyleDeps = realWritingStyleDeps()): Promise<void> {
  const resolved = deps.resolve();
  if (args.includes("--json")) {
    deps.print(JSON.stringify(envelope({ skill: resolved.skill, source: resolved.source }, deps.now())));
    return;
  }
  deps.show(out.kv("Writing style", resolved.skill, WRITING_STYLE_SOURCE_LABEL[resolved.source]));
}

export async function writingStyleList(args: string[], _ctx: CommandContext = {}, deps: WritingStyleDeps = realWritingStyleDeps()): Promise<void> {
  const listing = listWritingStyles(await inventory(deps), deps.resolve());
  if (args.includes("--json")) {
    deps.print(JSON.stringify(envelope(listing, deps.now())));
    return;
  }
  const row = (o: { id: string; detail: string; installed: boolean; kind: string }) => [
    o.id === listing.current.skill ? out.strong(o.id) : o.id,
    out.dim(`${o.detail}${o.installed || o.kind === "preset" ? "" : " (not installed here)"}`),
    o.id === listing.current.skill ? "current" : "",
  ];
  const known = new Set([...listing.options, ...listing.suggestions].map((o) => o.id));
  deps.show(
    out.table([
      ...listing.options.map(row),
      ...(known.has(listing.current.skill) ? [] : [[out.strong(listing.current.skill), "", "current"]]),
      ...(listing.suggestions.length > 0 ? [{ group: "Also available (type the id)" }, ...listing.suggestions.map(row)] : []),
    ]),
  );
}

function parseUseArgs(args: string[]): { id: string | undefined; scope: string; json: boolean } {
  let scope = "user";
  let id: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") json = true;
    else if (a === "--scope") {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) { scope = next; i++; } else scope = "";
    } else if (a.startsWith("--scope=")) scope = a.slice("--scope=".length);
    else if (id === undefined) id = a;
  }
  return { id, scope, json };
}

export async function writingStyleUse(args: string[], _ctx: CommandContext = {}, deps: WritingStyleDeps = realWritingStyleDeps()): Promise<void> {
  const { id: given, scope, json } = parseUseArgs(args);
  // The app's "Use my own skill..." text reaches argv verbatim, so a leading
  // dash must be validated as an id rather than parsed as a flag.
  if (given !== undefined && !isValidSkillId(given)) return refuse(new UserActionableError("bad-id", `"${given}" is not a skill id`), json, deps, { title: `${given} is not a skill id`, why: "A skill id is a lowercase name, with its plugin in front when it comes from one (plugin:name)." });
  if (scope !== "user" && scope !== "team") return refuse(new UserActionableError("usage", `--scope must be user or team, not "${scope}"`), json, deps, usageFailure("Is this style for you or for your team?", "rt skills writing-style use <skill-id> --scope team", "Say user for just you, or team for everyone on your team."));
  // setSetting creates the store directory, and a write inside ~/.mattstack/user before home.init or home.restore clones makes that clone fail.
  if (!existsSync(homeGitDir(deps.home()))) {
    return refuse(new UserActionableError("no-home-repo", "your home repo does not exist yet; finish rt setup first"), json, deps, NO_HOME);
  }

  linkPersonalSkills(deps.home());
  const inv = await inventory(deps);
  const listing = listWritingStyles(inv, deps.resolve());

  const choosable = [...listing.options, ...listing.suggestions];
  let id = given;
  if (id === undefined) {
    if (deps.isTTY() && !json && !process.env.RT_BATCH) {
      id = (await deps.pick("Which writing style?", choosable.map((o) => ({ value: o.id, label: o.label, hint: o.detail })))) ?? undefined;
      if (!id) return deps.exit(0);
    } else {
      return refuse(new UserActionableError("usage", "usage: rt skills writing-style use <skill-id> [--scope user|team] [--json]"), json, deps, usageFailure("Which writing style?", "rt skills writing-style use <skill-id>"));
    }
  }

  if (!isValidSkillId(id)) return refuse(new UserActionableError("bad-id", `"${id}" is not a skill id`), json, deps, { title: `${id} is not a skill id`, why: "A skill id is a lowercase name, with its plugin in front when it comes from one (plugin:name)." });
  if (!isStyleUsable(id, inv)) {
    const choices = choosable.filter((o) => o.kind === "preset" || o.installed).map((o) => o.id).join(", ");
    return refuse(new UserActionableError("unknown-skill", `${id} is not installed here. Choose one of: ${choices}`), json, deps, { title: `${id} is not installed here`, details: `Choose one of: ${choices}` });
  }

  deps.writeSetting(WRITING_STYLE_KEY, id, scope);
  if (json) deps.print(JSON.stringify(envelope({ skill: id, scope }, deps.now())));
  else deps.show(out.line("done", "Writing style set", `${id}, for ${scope === "team" ? "your team" : "you"}`));
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
const PRESET_SHORT = ["sparse", "conversational", "structured"] as const;

function stripCompilerComments(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith("<!-- compiled by rt skills compile") && !l.trim().startsWith("<!-- part: "))
    .join("\n");
}

/** Normalizes CRLF to LF, then renames the frontmatter `name` and preset id so the copy is a skill of its own. */
function retarget(text: string, presetId: string, name: string): string | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const end = normalized.indexOf("\n---", 4);
  if (!normalized.startsWith("---\n") || end === -1) return null;
  const frontmatter = normalized
    .slice(0, end)
    .replace(/^name:.*$/m, `name: ${name}`)
    .split(presetId)
    .join(name);
  return frontmatter + normalized.slice(end);
}

export async function writingStyleNew(args: string[], _ctx: CommandContext = {}, deps: WritingStyleDeps = realWritingStyleDeps()): Promise<void> {
  const json = args.includes("--json");
  let from = "conversational";
  let name: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") continue;
    if (a === "--from") from = args[++i] ?? "";
    else if (a.startsWith("--from=")) from = a.slice("--from=".length);
    else if (name === undefined) name = a;
  }

  if (!existsSync(homeGitDir(deps.home()))) {
    return refuse(new UserActionableError("no-home-repo", "your home repo does not exist yet; finish rt setup first"), json, deps, NO_HOME);
  }
  if (name === undefined) {
    if (deps.isTTY() && !json && !process.env.RT_BATCH) name = (await deps.prompt("Name for your writing style (lowercase, e.g. my-voice)")) ?? undefined;
    if (name === undefined) return refuse(new UserActionableError("usage", "usage: rt skills writing-style new <name> [--from sparse|conversational|structured] [--json]"), json, deps, usageFailure("What should the new writing style be called?", "rt skills writing-style new <name>"));
  }
  if (!NAME_RE.test(name)) return refuse(new UserActionableError("bad-name", `"${name}" must be lowercase letters, digits, dot, dash or underscore`), json, deps, { title: `${name} cannot be the name of a writing style`, why: "Use lowercase letters, digits, dots, dashes and underscores." });

  const presetId = (PRESET_SHORT as readonly string[]).includes(from) ? `mattstack:writing-style-${from}` : from;
  if (!presetById(presetId)) return refuse(new UserActionableError("bad-preset", `--from must be one of ${PRESET_SHORT.join(", ")}`), json, deps, { title: "That is not a preset to copy from", details: `Choose one of: ${PRESET_SHORT.join(", ")}` });

  const target = join(personalSkillsDir(deps.home()), name);
  if (existsSync(target)) {
    return decline(new UserActionableError("exists", `${target} already exists`), json, deps, [
      out.line("refused", `You already have a writing style called ${name}`, target),
      out.callout("next", ["Edit it, then run ", out.cmd(`rt skills writing-style use ${name}`)]),
    ]);
  }

  const stdout = await deps.pluginListStdout();
  const mattstack = (stdout === null ? null : parsePluginEntries(stdout))?.find((p) => p.id.startsWith("mattstack@") && p.enabled && p.installPath);
  const source = mattstack?.installPath
    ? pluginSkillRoots(mattstack.installPath)
        .map((root) => join(root, presetId.split(":")[1]!))
        .find((candidate) => existsSync(join(candidate, "SKILL.md"))) ?? null
    : null;
  if (!source || !existsSync(join(source, "SKILL.md"))) {
    return refuse(new UserActionableError("no-plugin", "the mattstack plugin with the writing-style presets is not installed; run rt setup"), json, deps, { title: "The mattstack plugin with the writing-style presets is not installed", next: out.cmd("rt setup") });
  }

  let skillContent: string | null;
  let prDescContent: string | undefined;
  try {
    const rawSkill = readFileSync(join(source, "SKILL.md"), "utf8");
    skillContent = retarget(stripCompilerComments(rawSkill), presetId, name);
    if (existsSync(join(source, "pr-description.md"))) {
      prDescContent = stripCompilerComments(readFileSync(join(source, "pr-description.md"), "utf8"));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return refuse(new UserActionableError("no-plugin", `the installed preset ${presetId} is unreadable; reinstall the mattstack plugin (${msg})`), json, deps, { title: "The installed preset could not be read", why: msg, next: out.cmd("rt setup") });
  }
  if (skillContent === null) {
    return refuse(new UserActionableError("no-plugin", `the installed preset ${presetId} is unreadable; reinstall the mattstack plugin`), json, deps, { title: "The installed preset could not be read", next: out.cmd("rt setup") });
  }

  let linkResult: ReturnType<typeof linkPersonalSkills> = null;
  try {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "SKILL.md"), skillContent);
    if (prDescContent !== undefined) writeFileSync(join(target, "pr-description.md"), prDescContent);
    linkResult = linkPersonalSkills(deps.home());
  } catch (err) {
    try {
      // The exists check ran before this call, and name passed NAME_RE, so target is a directory this call just created.
      rmSync(target, { recursive: true, force: true });
    } catch {
    }
    throw err;
  }

  const conflict = linkResult?.actions.find((a) => a.name === name && a.kind === "conflict");
  if (conflict) {
    rmSync(target, { recursive: true, force: true });
    return decline(new UserActionableError("exists", `${conflict.link} already exists`), json, deps, [
      out.line("refused", `Your Claude skills folder already has something called ${name}`, conflict.link),
      out.callout("note", "rt left it alone and removed the copy it had just made."),
    ]);
  }

  if (json) deps.print(JSON.stringify(envelope({ name, path: target, from: presetId }, deps.now())));
  else deps.show(out.line("done", `Created ${name}`, target), out.callout("next", ["Edit it, then run ", out.cmd(`rt skills writing-style use ${name}`)]));
}
