import { applyEdits, findNodeAtLocation, modify, parse, parseTree, type ParseError } from "jsonc-parser";
import { basename, dirname, join, resolve } from "path";
import { detectEditorsVia, TERMINAL_FONT_EDITORS } from "../editors.ts";
import type { Probes } from "./probes.ts";
import { NERD_FONT_ARCHIVE, type NerdFontArchive } from "./tools-install.ts";

export const NERD_FAMILY = "JetBrainsMonoNL Nerd Font";
export const EDITOR_DEFAULT_FONT = "Menlo, Monaco, 'Courier New', monospace";

export function hasNerdFont(family: string): boolean {
  return family.split(",").some((part) => {
    const name = part.trim().replace(/^['"]+|['"]+$/g, "").trim().toLowerCase();
    return name.includes("nerd font") || name.endsWith(" nf");
  });
}

export function nextTerminalFont(input: {
  terminal: string | undefined;
  editor: string | undefined;
  lastWritten: string | undefined;
}): {
  action: "keep" | "write";
  value?: string;
  reason: "has-nerd" | "member-undid" | "appended" | "seeded";
} {
  const { lastWritten } = input;
  const terminal = input.terminal?.trim() || undefined;
  const editor = input.editor?.trim() || undefined;
  if (terminal !== undefined && hasNerdFont(terminal)) return { action: "keep", reason: "has-nerd" };
  if (lastWritten !== undefined && terminal !== lastWritten) return { action: "keep", reason: "member-undid" };
  const seeded = terminal === undefined;
  const base = (seeded ? (editor ?? EDITOR_DEFAULT_FONT) : terminal).replace(/[\s,]+$/, "");
  return { action: "write", value: `${base}, '${NERD_FAMILY}'`, reason: seeded ? "seeded" : "appended" };
}

const TERMINAL_KEY = "terminal.integrated.fontFamily";
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const STEP_TIMEOUT_MS = 60_000;

function fontDirs(home: string): string[] {
  return [join(home, "Library", "Fonts"), "/Library/Fonts"];
}

export function nerdFontInstalled(p: Probes): boolean {
  const glob = new Bun.Glob(NERD_FONT_ARCHIVE.fileGlob);
  return fontDirs(p.home).some((dir) => p.readDir(dir).some((name) => glob.match(name)));
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

function findFonts(p: Probes, dir: string, glob: Bun.Glob, depth = 0): string[] {
  if (depth > 8) return [];
  return p.readDir(dir).flatMap((name) => {
    const path = join(dir, name);
    if (p.statPath(path)?.isDirectory) return findFonts(p, path, glob, depth + 1);
    return glob.match(name) ? [path] : [];
  });
}

/** Nothing in the archive is unpacked before its sha256 matches the pin. */
export async function installNerdFont(
  p: Probes,
  log: (line: string) => void,
  pin: NerdFontArchive = NERD_FONT_ARCHIVE,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  let host: string;
  try {
    const url = new URL(pin.url);
    host = url.protocol === "https:" ? url.hostname : "";
  } catch {
    host = "";
  }
  if (!pin.allowedHosts.includes(host)) return { ok: false, detail: `The font download points at a host rt does not allow (${host || pin.url})` };

  const work = join(p.env.TMPDIR || "/tmp", `rt-nerd-font-${process.pid}`);
  try {
    await p.exec(["rm", "-rf", work], { timeoutMs: STEP_TIMEOUT_MS });
    p.mkdirp(work);
    const file = join(work, "JetBrainsMono.tar.xz");
    log("Downloading JetBrainsMono Nerd Font");
    const fetched = await p.exec(["curl", "-fsSL", "--proto", "=https", "--proto-redir", "=https", pin.url, "-o", file], { timeoutMs: DOWNLOAD_TIMEOUT_MS });
    if (fetched.code === 124) return { ok: false, detail: "Downloading the font did not finish in time" };
    if (fetched.code !== 0) return { ok: false, detail: `Downloading the font failed (exit ${fetched.code}): ${firstLine(fetched.stderr || fetched.stdout)}` };

    log("Checking the download");
    const sum = await p.exec(["shasum", "-a", "256", file], { timeoutMs: STEP_TIMEOUT_MS });
    const got = sum.stdout.trim().split(/\s+/)[0] ?? "";
    if (sum.code !== 0 || got !== pin.sha256) return { ok: false, detail: "The font download did not match its pinned sha256, so nothing was installed" };

    log("Unpacking the font");
    const unpacked = join(work, "unpacked");
    p.mkdirp(unpacked);
    const untar = await p.exec(["tar", "-xJf", file, "-C", unpacked], { timeoutMs: STEP_TIMEOUT_MS });
    if (untar.code !== 0) return { ok: false, detail: `Unpacking the font failed: ${firstLine(untar.stderr || untar.stdout)}` };

    const fonts = findFonts(p, unpacked, new Bun.Glob(pin.fileGlob));
    if (fonts.length === 0) return { ok: false, detail: `The font download held no ${pin.fileGlob} files` };

    log("Installing the font into ~/Library/Fonts");
    const dest = join(p.home, "Library", "Fonts");
    p.mkdirp(dest);
    const copied = await p.exec(["cp", ...fonts, dest], { timeoutMs: STEP_TIMEOUT_MS });
    if (copied.code !== 0) return { ok: false, detail: `Copying the font into ~/Library/Fonts failed: ${firstLine(copied.stderr || copied.stdout)}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: `Installing the font failed: ${firstLine(err instanceof Error ? err.message : String(err))}` };
  } finally {
    await p.exec(["rm", "-rf", work], { timeoutMs: STEP_TIMEOUT_MS }).catch(() => undefined);
  }
}

export type EditorFontResult = {
  editor: string;
  path: string;
  outcome: "written" | "kept" | "member-undid" | "unreadable" | "not-installed" | "failed";
  value?: string;
  /** Why a write failed; only on `failed`. */
  detail?: string;
};

function defaultAppDirs(home: string): string[] {
  return ["/Applications", join(home, "Applications")];
}

/** A symlinked settings.json (a dotfiles repo) is edited at its target, so the rename never replaces the link. */
function resolveLinks(p: Probes, path: string): string {
  let current = path;
  for (let hop = 0; hop < 8; hop++) {
    const target = p.readlink(current);
    if (target === null) return current;
    current = resolve(dirname(current), target);
  }
  return current;
}

const BOM = "﻿";

/**
 * Sets the terminal key without reformatting anything else: an existing key
 * has only its value replaced, and an absent one goes in as the first
 * property, since jsonc-parser's own insert re-lays out its neighbours.
 */
function withTerminalFont(text: string, value: string): string {
  const root = parseTree(text, [], { allowTrailingComma: true });
  if (root === undefined || root.type !== "object") throw new Error("settings.json does not hold an object");
  if (findNodeAtLocation(root, [TERMINAL_KEY]) !== undefined) return applyEdits(text, modify(text, [TERMINAL_KEY], value, {}));

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const entry = `${JSON.stringify(TERMINAL_KEY)}: ${JSON.stringify(value)}`;
  const open = root.offset + 1;
  const close = root.offset + root.length - 1;
  const fallback = /^\t/m.test(text) ? "\t" : "    ";
  const first = root.children?.[0];
  if (first === undefined) {
    const inner = text.slice(open, close);
    return `${text.slice(0, open)}${eol}${fallback}${entry}${inner.trim() === "" ? eol : inner}${text.slice(close)}`;
  }
  const lineStart = text.lastIndexOf("\n", first.offset - 1) + 1;
  const lead = text.slice(lineStart, first.offset);
  const indent = lineStart > open && /^[ \t]*$/.test(lead) ? lead : fallback;
  return `${text.slice(0, open)}${eol}${indent}${entry},${text.slice(open)}`;
}

type FontEditor = (typeof TERMINAL_FONT_EDITORS)[number];
type Inspected = { result: EditorFontResult; target?: string; text?: string; bom?: boolean };

function inspect(p: Probes, editor: FontEditor, installed: Set<string>, written: Record<string, string>): Inspected {
  const path = join(p.home, "Library", "Application Support", editor.settingsDir, "User", "settings.json");
  const base = { editor: editor.displayName, path };
  if (!installed.has(editor.appName)) return { result: { ...base, outcome: "not-installed" } };

  const target = resolveLinks(p, path);
  const raw = p.exists(target) ? p.readFile(target) : "";
  if (raw === null) return { result: { ...base, outcome: "unreadable" } };
  const bom = raw.startsWith(BOM);
  const text = bom ? raw.slice(1) : raw;

  let terminal: string | undefined;
  let editorFont: string | undefined;
  if (text.trim() !== "") {
    const errors: ParseError[] = [];
    const root: unknown = parse(text, errors, { allowTrailingComma: true });
    if (errors.length > 0 || typeof root !== "object" || root === null || Array.isArray(root)) return { result: { ...base, outcome: "unreadable" } };
    const settings = root as Record<string, unknown>;
    if (typeof settings[TERMINAL_KEY] === "string") terminal = settings[TERMINAL_KEY];
    if (typeof settings["editor.fontFamily"] === "string") editorFont = settings["editor.fontFamily"];
  }

  const next = nextTerminalFont({ terminal, editor: editorFont, lastWritten: written[path] });
  if (next.action === "write") return { result: { ...base, outcome: "written", value: next.value }, target, text, bom };
  return { result: { ...base, outcome: next.reason === "member-undid" ? "member-undid" : "kept" } };
}

function inspectAll(p: Probes, written: Record<string, string>, appDirs: string[]): Inspected[] {
  const installed = new Set(detectEditorsVia(p.exists, appDirs).map((e) => basename(e.appPath)));
  return TERMINAL_FONT_EDITORS.map((editor) => inspect(p, editor, installed, written));
}

/** What `applyEditorFonts` would do, writing nothing: a `written` outcome here means "would write". */
export function planEditorFonts(p: Probes, written: Record<string, string>, appDirs: string[] = defaultAppDirs(p.home)): EditorFontResult[] {
  return inspectAll(p, written, appDirs).map((i) => i.result);
}

/** `written` maps each settings path to the value rt last wrote there, so a value the member changed since is never rewritten. */
export function applyEditorFonts(p: Probes, written: Record<string, string>, appDirs: string[] = defaultAppDirs(p.home)): EditorFontResult[] {
  return inspectAll(p, written, appDirs).map(({ result, target, text, bom }) => {
    if (result.outcome !== "written" || target === undefined || text === undefined || result.value === undefined) return result;
    const tmp = `${target}.rt-${process.pid}.tmp`;
    try {
      const edited = text.trim() === "" ? `{\n    ${JSON.stringify(TERMINAL_KEY)}: ${JSON.stringify(result.value)}\n}\n` : withTerminalFont(text, result.value);
      const next = bom ? BOM + edited : edited;
      p.mkdirp(dirname(target));
      const mode = p.fileMode(target);
      p.writeFile(tmp, next);
      if (mode !== null) p.chmod(tmp, mode);
      p.rename(tmp, target);
      return result;
    } catch (err) {
      p.removeFile(tmp);
      const detail = firstLine(err instanceof Error ? err.message : String(err));
      return { editor: result.editor, path: result.path, outcome: "failed", detail };
    }
  });
}
