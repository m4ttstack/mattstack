import { createHash } from "crypto";
import { constants as fsConstants, copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "fs";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "path";
import { builtInEvidenceRoot, claudeTempRoots, isInsideRoot, runEvidenceRoot, TEXT_EXTENSIONS, UPLOAD_EXTENSIONS, workRoot } from "../daemon/upload-guard.ts";
import { evidenceDir } from "../rt-paths.ts";
import { runsRoot } from "../runs/paths.ts";

export const BUNDLE_EXTRA_EXTENSIONS = ["json", "txt", "log"] as const;

const COPYABLE = new Set<string>([...UPLOAD_EXTENSIONS, ...BUNDLE_EXTRA_EXTENSIONS]);
const TRANSCRIPT = new Set<string>([...COPYABLE, ...TEXT_EXTENSIONS]);
const IMAGE_EXTS = UPLOAD_EXTENSIONS.join("|");

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function bundleStem(fileName: string): string | null {
  const ext = extname(fileName);
  if (ext === "" || fileName.startsWith(".")) return null;
  const stem = fileName.slice(0, -ext.length).replace(/\.c\d+$/, "");
  return stem === "" ? null : stem;
}

function readText(p: string): string | null {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** A pair's spec names the before bundle's captures, which keep the before's stem; a bundle carries them so it re-renders wherever it lands. */
function specCaptures(dir: string, stem: string, present: Set<string>, read: (p: string) => string | null): string[] {
  const raw = read(join(dir, `${stem}.spec.json`));
  if (raw === null) return [];
  let panels: unknown;
  try {
    panels = (JSON.parse(raw) as { panels?: unknown }).panels;
  } catch {
    return [];
  }
  if (!Array.isArray(panels)) return [];
  const out: string[] = [];
  for (const panel of panels) {
    const capture = (panel as { capture?: unknown } | null)?.capture;
    if (typeof capture !== "string" || basename(capture) !== capture || !capture.endsWith(".capture.json")) continue;
    for (const name of [capture, `${capture.slice(0, -".capture.json".length)}.png`]) if (present.has(name)) out.push(name);
  }
  return out;
}

export function bundleMembers(dir: string, fileName: string, list: (dir: string) => string[], read: (p: string) => string | null = readText): string[] {
  const stem = bundleStem(fileName);
  if (stem === null) return [];
  const s = escapeRegExp(stem);
  const member = new RegExp(
    `^${s}\\.(?:(?:c\\d+\\.)?(?:${IMAGE_EXTS})|c\\d+\\.capture\\.json|spec\\.json|redactions\\.json|redact-[^./]+\\.png)$`,
    "i",
  );
  const present = new Set(list(dir));
  const names = new Set([...present].filter((n) => member.test(n)));
  for (const name of specCaptures(dir, stem, present, read)) names.add(name);
  names.add(fileName);
  return [...names].sort();
}

/**
 * The captures in a board's bundle that were not captured live: Fast Browser's
 * import writes the saved image re-encoded as <x>.png beside <x>.capture.json
 * with source "import". A sidecar that does not say "live" counts, as in the
 * redaction check.
 */
export function importedCaptures(board: string, list: (dir: string) => string[] = (d) => readdirSync(d), read: (p: string) => string | null = readText): string[] {
  const dir = dirname(board);
  let names: string[];
  try {
    names = bundleMembers(dir, basename(board), list, read);
  } catch {
    return [];
  }
  const present = new Set(names);
  return names.flatMap((name) => {
    if (!name.endsWith(".capture.json")) return [];
    const png = `${name.slice(0, -".capture.json".length)}.png`;
    if (!present.has(png)) return [];
    let source: unknown;
    try {
      source = (JSON.parse(read(join(dir, name)) ?? "null") as { source?: unknown } | null)?.source;
    } catch {
      source = undefined;
    }
    return source === "live" ? [] : [join(dir, png)];
  });
}

export interface CopyRequest {
  src: string;
  destDir: string;
  single?: boolean;
}
export interface CopyResult {
  from: string;
  to: string;
}

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

function underAllowedRoot(real: string, roots: string[]): boolean {
  return roots.some((root) => {
    if (isInsideRoot(real, root)) return true;
    const rootReal = safeRealpath(root);
    return rootReal !== null && isInsideRoot(real, rootReal);
  });
}

function checkSource(requested: string, real: string, roots: string[], single: boolean): string | null {
  const name = basename(real);
  if (name.startsWith(".")) return `${requested}: a dotfile is never copied`;
  if (!(single ? TRANSCRIPT : COPYABLE).has(extname(name).slice(1).toLowerCase())) return `${requested}: only image, json, txt and log files are copied`;
  let st;
  try {
    st = lstatSync(real);
  } catch {
    return `${requested}: cannot read the file`;
  }
  if (!st.isFile()) return `${requested}: not a regular file`;
  if (st.nlink !== 1) return `${requested}: has more than one hard link`;
  if (!underAllowedRoot(real, roots)) return `${requested}: outside the allowed source roots (${roots.join(", ")})`;
  const inWork = isInsideRoot(real, safeRealpath(workRoot()) ?? workRoot());
  if (inWork && runEvidenceRoot(real, { workRoot: workRoot(), runsRoot: runsRoot() }) === null) {
    return `${requested}: under the work root but not inside a run's evidence folder`;
  }
  return null;
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The upload guard resolves the work root and splits the rest literally, so a link below it would send a copy out of the run. */
function symlinkBelow(root: string, dir: string): string | null {
  let p = root;
  for (const part of relative(root, dir).split(sep)) {
    p = join(p, part);
    if (isSymlink(p)) return p;
  }
  return null;
}

export function sameBytes(a: string, b: string): boolean {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    if (!sa.isFile() || !sb.isFile() || sa.size !== sb.size) return false;
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

/** copyIntoRun's mapped is keyed per request, since one source can be requested into several case folders. */
export function mapKey(src: string, destDir: string): string {
  return `${destDir}\0${src}`;
}

/** A content folder's name: the first 12 hex of a sha256 over the bundle's names and bytes. */
export const CONTENT_DIR = /^[0-9a-f]{12}$/;

function bundleDigest(members: Array<{ name: string; real: string }>): string {
  const h = createHash("sha256");
  for (const m of [...members].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    h.update(`${m.name}\0${createHash("sha256").update(readFileSync(m.real)).digest("hex")}\n`);
  }
  return h.digest("hex").slice(0, 12);
}

/**
 * Nothing already in the run folder is ever rewritten. A bundle that would
 * change any existing file lands whole in a content folder beside it, file
 * names unchanged, since #822's guard pairs a board with its redaction record
 * and crops by name.
 */
export function copyIntoRun(
  requests: CopyRequest[],
  o: {
    allowedRoots: string[];
    destRoot: string;
    /** Must fail with EEXIST rather than replace a file; tests wrap it to land files mid-call. */
    copyFile?: (from: string, to: string) => void;
  },
): { ok: true; copied: CopyResult[]; mapped: Map<string, string> } | { ok: false; error: string } {
  const roots = o.allowedRoots.filter((r) => typeof r === "string" && r.length > 0 && isAbsolute(r));
  const planned = new Map<string, string>();
  const writes: CopyResult[] = [];
  const mapped = new Map<string, string>();

  for (const req of requests) {
    const real = safeRealpath(req.src);
    if (real === null) return { ok: false, error: `${req.src}: file not found` };
    const refusal = checkSource(req.src, real, roots, req.single === true);
    if (refusal !== null) return { ok: false, error: refusal };

    if (!isInsideRoot(req.destDir, o.destRoot)) return { ok: false, error: `${req.destDir}: destination is outside ${o.destRoot}` };
    const link = symlinkBelow(o.destRoot, req.destDir);
    if (link !== null) return { ok: false, error: `${link}: destination directory is a symlink` };
    const destReal = safeRealpath(req.destDir) ?? req.destDir;
    const srcDir = dirname(real);
    if (srcDir === destReal || isInsideRoot(srcDir, destReal)) {
      mapped.set(mapKey(req.src, req.destDir), join(req.destDir, relative(destReal, real)));
      continue;
    }

    const names = req.single ? [basename(real)] : bundleMembers(srcDir, basename(real), (d) => readdirSync(d));
    const members = names.map((name) => ({ name, real: name === basename(real) ? real : join(srcDir, name) }));
    for (const m of members) {
      if (m.real === real) continue;
      const bad = checkSource(m.real, safeRealpath(m.real) ?? m.real, roots, false);
      if (bad !== null) return { ok: false, error: bad };
    }
    const symlinked = (dir: string) => members.map((m) => join(dir, m.name)).find(isSymlink);
    const fits = (dir: string) => members.every((m) => {
      const to = join(dir, m.name);
      const prior = planned.get(to);
      if (prior !== undefined) return prior === m.real || sameBytes(prior, m.real);
      return safeRealpath(to) === null || sameBytes(m.real, to);
    });

    let dir = req.destDir;
    const linked = symlinked(dir);
    if (linked !== undefined) return { ok: false, error: `${linked}: destination is a symlink` };
    if (!fits(dir)) {
      dir = join(req.destDir, bundleDigest(members));
      if (isSymlink(dir)) return { ok: false, error: `${dir}: destination directory is a symlink` };
      const inner = symlinked(dir);
      if (inner !== undefined) return { ok: false, error: `${inner}: destination is a symlink` };
      if (!fits(dir)) return { ok: false, error: `${dir}: holds other bytes under this bundle's names` };
    }
    for (const m of members) {
      const to = join(dir, m.name);
      if (!planned.has(to)) {
        planned.set(to, m.real);
        writes.push({ from: m.real, to });
      }
    }
    mapped.set(mapKey(req.src, req.destDir), join(dir, basename(real)));
  }

  const copied: CopyResult[] = [];
  const landed = (error: string) => ({
    ok: false as const,
    error: `${error}${copied.length ? ` (copied before it: ${copied.map((c) => c.to).join(", ")})` : ""}`,
  });
  const copyFile = o.copyFile ?? ((from: string, to: string) => copyFileSync(from, to, fsConstants.COPYFILE_EXCL));
  const linkAt = (to: string) => {
    const link = symlinkBelow(o.destRoot, to);
    if (link === null) return null;
    return landed(link === to ? `${to}: destination is a symlink` : `${link}: destination directory is a symlink`);
  };
  for (const w of writes) {
    // planning saw these destinations; another process may have written one since
    const linked = linkAt(w.to);
    if (linked !== null) return linked;
    if (safeRealpath(w.to) !== null) {
      if (!sameBytes(w.from, w.to)) return landed(`${w.to}: landed under this call with other bytes`);
      continue;
    }
    mkdirSync(dirname(w.to), { recursive: true });
    try {
      copyFile(w.from, w.to);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return landed(`${w.to}: ${(e as Error).message}`);
      const late = linkAt(w.to);
      if (late !== null) return late;
      if (!sameBytes(w.from, w.to)) return landed(`${w.to}: landed under this call with other bytes`);
      continue;
    }
    copied.push(w);
  }
  return { ok: true, copied, mapped };
}

export function allowedSourceRoots(o: { home: string; uid: number | null; repoRoots: string[]; uploadRoots: string[] }): string[] {
  const builtIn = [builtInEvidenceRoot(evidenceDir(), o.uid), builtInEvidenceRoot(join(o.home, ".fast-browser", "screenshots"), o.uid)];
  return [
    ...o.repoRoots,
    ...claudeTempRoots(o.uid),
    ...builtIn.filter((r): r is string => r !== null),
    ...o.uploadRoots,
    join(o.home, ".mattstack", "work"),
  ];
}
