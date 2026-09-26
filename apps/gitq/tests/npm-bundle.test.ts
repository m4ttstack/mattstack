import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { homedir } from 'node:os';
import { builtinModules } from 'node:module';
import { join } from 'path';
import { spawnSync } from 'child_process';

const ROOT = join(import.meta.dir, '..');

/**
 * Every bare specifier the bundle imports or requires by a literal string:
 * a static `import ... from "..."` (matched line-anchored so a quoted "from"
 * inside an error-message template literal is not mistaken for one), a
 * dynamic `import("...")`, or a `require("...")`/`__require("...")` call.
 */
function bareSpecifiers(js: string): string[] {
  const specs = new Set<string>();
  for (const line of js.split('\n')) {
    const m = line.trimStart().match(/^import\b.*\bfrom\s+["']([^"']+)["']/);
    if (m) specs.add(m[1]);
  }
  for (const pattern of [/\bimport\(\s*["']([^"']+)["']\s*\)/g, /\b(?:__)?require\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const m of js.matchAll(pattern)) specs.add(m[1]);
  }
  return [...specs].filter((s) => !s.startsWith('.') && !s.startsWith('/'));
}

describe('npm bundle', () => {
  test('dist/gitq.js imports only node builtins, bun:sqlite, or a declared dependency', () => {
    const build = spawnSync('bun', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
    expect(build.status).toBe(0);
    const js = readFileSync(join(ROOT, 'dist', 'gitq.js'), 'utf8');
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      version: string;
      dependencies: Record<string, string>;
    };
    const specs = bareSpecifiers(js);
    expect(specs.length).toBeGreaterThan(0);
    const unresolved = specs.filter((spec) => {
      if (spec === 'bun:sqlite') return false;
      const bare = spec.startsWith('node:') ? spec.slice('node:'.length) : spec;
      if (builtinModules.includes(bare)) return false;
      return !(spec in pkg.dependencies);
    });
    // @mattstack/rt-client is a dev dependency, inlined into the bundle, so
    // it showing up here as a bare specifier would mean it stopped being
    // inlined. @mattstack/settings-kit is not declared in gitq's
    // package.json at all: it arrives, if at all, transitively through
    // rt-client, and needs the same inlining.
    expect(unresolved).toEqual([]);
    for (const name of Object.keys(pkg.dependencies)) expect(pkg.dependencies[name]).not.toMatch(/^(file|link):/);
    // bin/gitq.mjs is the entry point that actually calls main(); dist/gitq.js
    // only exports it. HOME is the real one (not the preload's temp HOME): a
    // version-manager node shim resolves its own config off HOME, and
    // --version answers before any gitq config read (src/cli/main.ts), so
    // this does not weaken the preload's isolation.
    const smoke = spawnSync('node', [join(ROOT, 'bin', 'gitq.mjs'), '--version'], {
      stdio: 'pipe',
      env: { ...process.env, HOME: homedir() },
    });
    expect(smoke.status).toBe(0);
    expect(smoke.stdout.toString().trim()).toBe(pkg.version);
  }, 15_000);
});
