import { posix } from "path";
import type { ResolveFs } from "../resolve.ts";

/** Files by path; `links` maps a link path to the folder it points at, or null for a dead link. */
export function fakeFs(files: Record<string, string>, links: Record<string, string | null> = {}): ResolveFs & { reads: string[] } {
  const reads: string[] = [];
  // Segment by segment, as the OS walks: a link is followed before any `..` after it applies.
  const walk = (p: string, followLast: boolean): string | null => {
    const parts = p.split("/").filter((s) => s !== "" && s !== ".");
    let at = "";
    for (const [i, part] of parts.entries()) {
      at = part === ".." ? posix.dirname(at || "/") : `${at}/${part}`;
      if (at === "/") at = "";
      if (Object.hasOwn(links, at) && (followLast || i < parts.length - 1)) {
        const target = links[at]!;
        if (target === null) return null;
        at = target;
      }
    }
    return at || "/";
  };
  const follow = (p: string) => walk(p, true);
  const isDir = (p: string) => Object.keys(files).some((f) => f.startsWith(`${p}/`));
  return {
    reads,
    exists(p) {
      reads.push(p);
      const real = follow(p);
      return real !== null && (Object.hasOwn(files, real) || isDir(real));
    },
    readDir(p) {
      reads.push(p);
      const real = follow(p);
      if (real === null) return [];
      const names = new Set<string>();
      for (const f of Object.keys(files)) if (f.startsWith(`${real}/`)) names.add(f.slice(real.length + 1).split("/")[0]!);
      for (const link of Object.keys(links)) if (posix.dirname(link) === real) names.add(posix.basename(link));
      return [...names].sort();
    },
    readFile(p) {
      reads.push(p);
      const real = follow(p);
      return real !== null && Object.hasOwn(files, real) ? files[real]! : null;
    },
    isSymlink(p) {
      reads.push(p);
      const at = walk(p, false);
      return at !== null && Object.hasOwn(links, at);
    },
  };
}
