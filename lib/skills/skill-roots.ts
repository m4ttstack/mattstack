import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import { isAbsolute as isAbsolutePath, join, relative as relativePath, resolve as resolvePath, sep } from "path";

/**
 * A plugin may register more than one skills root (plugin.json `skills`, e.g.
 * ["./skills/review", "./plugin/skills"]); the registered surface is the union
 * of those roots, defaulting to skills/ when the manifest lists none.
 */
export function registeredSkillRoots(packDir: string): string[] {
  const manifestPath = join(packDir, ".claude-plugin", "plugin.json");
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as { skills?: unknown };
      if (Array.isArray(parsed.skills) && parsed.skills.length > 0) {
        // A root is only honored inside the pack: a manifest value like "../x" or an
        // absolute path would otherwise let the surface verbs enumerate (and move) dirs
        // that belong to some other tree.
        const canonical = (p: string) => {
          try {
            return realpathSync(p);
          } catch {
            return resolvePath(p);
          }
        };
        const packRoot = canonical(packDir);
        const roots = parsed.skills
          .filter((s): s is string => typeof s === "string")
          .map((s) => canonical(resolvePath(packDir, s)))
          .filter((root) => {
            const rel = relativePath(packRoot, root);
            if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolutePath(rel)) return false;
            try {
              return statSync(root).isDirectory();
            } catch {
              return false;
            }
          });
        if (roots.length > 0) return roots;
      }
    } catch {
      // an unreadable manifest falls back to the conventional root below
    }
  }
  return [join(packDir, "skills")];
}
