import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { SERVED_ONLY_PACKAGES, keepsFastPath } from "../release/preflight.ts";

// A release that ships a kit change on the fast path skips the rehearsal, so a
// kit counts as served-only only when nothing but fast-path apps builds from it:
// no deck, no other app, and not rt itself (which imports kits by relative path,
// invisible to package.json).
const ROOT = resolve(import.meta.dir, "..", "..");
const RT_SOURCE = ["cli.ts", "commands", "lib", "scripts"];

interface Manifest {
  kind: "apps" | "packages";
  dir: string;
  name: string;
  deps: Set<string>;
}

function manifests(kind: "apps" | "packages"): Manifest[] {
  return readdirSync(join(ROOT, kind), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, kind, e.name, "package.json")))
    .map((e) => {
      const pkg = JSON.parse(readFileSync(join(ROOT, kind, e.name, "package.json"), "utf8"));
      const deps = new Set([pkg.dependencies, pkg.devDependencies, pkg.peerDependencies].flatMap((d) => Object.keys(d ?? {})));
      return { kind, dir: e.name, name: pkg.name as string, deps };
    });
}

function rtSourceFiles(path: string): string[] {
  const full = join(ROOT, path);
  if (path.endsWith(".ts")) return [full];
  return readdirSync(full, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.parentPath.includes("__tests__") && !e.parentPath.includes("node_modules"))
    .map((e) => join(e.parentPath, e.name));
}

test("SERVED_ONLY_PACKAGES matches the kits only fast-path apps build from", () => {
  const apps = manifests("apps");
  const packages = manifests("packages");
  const all = [...apps, ...packages];

  const rtText = RT_SOURCE.flatMap(rtSourceFiles).map((f) => readFileSync(f, "utf8")).join("\n");
  const rootDeps = Object.keys(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies ?? {});
  const usedByRt = (p: Manifest) =>
    rootDeps.includes(p.name) || new RegExp(`from "[^"]*packages/${p.dir}/`).test(rtText) || rtText.includes(`"${p.name}"`);

  const computed: Record<string, string[]> = {};
  for (const pkg of packages) {
    const servedApps = new Set<string>();
    let disqualified = false;
    const queue = [pkg];
    const seen = new Set<string>();
    while (queue.length && !disqualified) {
      const cur = queue.shift()!;
      if (seen.has(cur.name)) continue;
      seen.add(cur.name);
      if (usedByRt(cur)) disqualified = true;
      for (const consumer of all.filter((m) => m.deps.has(cur.name))) {
        if (consumer.kind === "packages") queue.push(consumer);
        else if (keepsFastPath(consumer.dir)) servedApps.add(consumer.dir);
        else disqualified = true;
      }
    }
    if (!disqualified && servedApps.size) computed[pkg.dir] = [...servedApps].sort();
  }

  const declared: Record<string, string[]> = Object.fromEntries(Object.entries(SERVED_ONLY_PACKAGES).map(([k, v]) => [k, [...v].sort()]));
  expect(declared).toEqual(computed);
});
