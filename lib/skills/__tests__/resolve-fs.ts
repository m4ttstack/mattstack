import { posix } from "path";
import type { ResolveFs } from "../resolve.ts";

/** Files by path; `links` maps a link path to the folder it points at, or null for a dead link. */
export function fakeFs(files: Record<string, string>, links: Record<string, string | null> = {}): ResolveFs & { reads: string[] } {
  const reads: string[] = [];
  const follow = (p: string): string | null => {
    let path = posix.normalize(p);
    for (const [link, target] of Object.entries(links)) {
      if (path === link || path.startsWith(`${link}/`)) {
        if (target === null) return null;
        path = target + path.slice(link.length);
      }
    }
    return path;
  };
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
      return Object.hasOwn(links, posix.normalize(p));
    },
  };
}
