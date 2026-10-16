import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "fs";
import { basename, dirname, extname, isAbsolute, join } from "path";
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

export function bundleMembers(dir: string, fileName: string, list: (dir: string) => string[]): string[] {
  const stem = bundleStem(fileName);
  if (stem === null) return [];
  const s = escapeRegExp(stem);
  const member = new RegExp(
    `^${s}\\.(?:(?:c\\d+\\.)?(?:${IMAGE_EXTS})|c\\d+\\.capture\\.json|spec\\.json|redactions\\.json|redact-[^./]+\\.png)$`,
    "i",
  );
  const names = new Set(list(dir).filter((n) => member.test(n)));
  names.add(fileName);
  return [...names].sort();
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

interface Planned {
  requested: string;
  real: string;
  to: string;
  inPlace: boolean;
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

function sameBytes(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

export function copyIntoRun(
  requests: CopyRequest[],
  o: { allowedRoots: string[]; referencedElsewhere: Set<string> },
): { ok: true; copied: CopyResult[]; mapped: Map<string, string> } | { ok: false; error: string } {
  const roots = o.allowedRoots.filter((r) => typeof r === "string" && r.length > 0 && isAbsolute(r));
  const planned: Planned[] = [];
  const claimed = new Map<string, string>();
  const mapped = new Map<string, string>();

  for (const req of requests) {
    const real = safeRealpath(req.src);
    if (real === null) return { ok: false, error: `${req.src}: file not found` };
    const refusal = checkSource(req.src, real, roots, req.single === true);
    if (refusal !== null) return { ok: false, error: refusal };

    const destReal = safeRealpath(req.destDir) ?? req.destDir;
    const members = req.single
      ? [basename(real)]
      : bundleMembers(dirname(real), basename(real), (d) => readdirSync(d));
    for (const name of members) {
      const memberReal = name === basename(real) ? real : join(dirname(real), name);
      if (name !== basename(real)) {
        const bad = checkSource(memberReal, safeRealpath(memberReal) ?? memberReal, roots, false);
        if (bad !== null) return { ok: false, error: bad };
      }
      const inPlace = dirname(memberReal) === destReal;
      const to = inPlace ? memberReal : join(req.destDir, name);
      if (!inPlace && isSymlink(to)) return { ok: false, error: `${to}: destination is a symlink` };
      const prior = claimed.get(to);
      if (prior !== undefined && prior !== memberReal) {
        if (!sameBytes(prior, memberReal)) return { ok: false, error: `${to}: two sources with different bytes map here (${prior} and ${memberReal})` };
      } else {
        claimed.set(to, memberReal);
        planned.push({ requested: req.src, real: memberReal, to, inPlace });
      }
      if (name === basename(real)) mapped.set(req.src, to);
    }
  }

  for (const p of planned) {
    if (p.inPlace) continue;
    if (o.referencedElsewhere.has(p.to) && !sameBytes(p.real, p.to) && safeRealpath(p.to) !== null) {
      return { ok: false, error: `${p.to}: already used by another image with different bytes (from ${p.requested})` };
    }
  }

  const copied: CopyResult[] = [];
  for (const p of planned) {
    if (p.inPlace) continue;
    mkdirSync(dirname(p.to), { recursive: true });
    if (!sameBytes(p.real, p.to)) copyFileSync(p.real, p.to);
    copied.push({ from: p.real, to: p.to });
  }
  return { ok: true, copied, mapped };
}

export function allowedSourceRoots(o: { home: string; uid: number | null; repoRoots: string[]; uploadRoots: string[] }): string[] {
  const builtIn = builtInEvidenceRoot(evidenceDir(), o.uid);
  return [
    ...o.repoRoots,
    ...claudeTempRoots(o.uid),
    ...(builtIn === null ? [] : [builtIn]),
    ...o.uploadRoots,
    join(o.home, ".mattstack", "work"),
    join(o.home, ".fast-browser", "screenshots"),
  ];
}
