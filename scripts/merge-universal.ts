#!/usr/bin/env bun
/**
 * Joins rt-tray/deps/arm64 and rt-tray/deps/x86_64 into rt-tray/deps/universal:
 * every Mach-O pair becomes one fat binary through lipo, and every other file
 * comes from the arm64 slice. build.sh bundles the result when
 * RT_DEPS_ARCH=universal.
 *
 *   bun scripts/merge-universal.ts [--deps <root>]
 */
import { spawnSync } from "child_process";
import { chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, rmSync, symlinkSync, type Stats } from "fs";
import { join, resolve } from "path";

const MACHO_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

export function isMachO(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(4);
    if (readSync(fd, buf, 0, 4, 0) < 4) return false;
    return MACHO_MAGICS.has(buf.readUInt32BE(0));
  } finally {
    closeSync(fd);
  }
}

export interface MergeReport {
  lipoed: string[];
  /** Non-Mach-O files whose bytes differ between slices; the arm64 copy ships. */
  differing: string[];
  /** Non-Mach-O files only the x86_64 slice carries; nothing ships for them. */
  intelOnly: string[];
}

export interface MergeSeams {
  lipoArchs(path: string): string[];
  lipoCreate(arm: string, intel: string, out: string): void;
}

function run(argv: string[]): string {
  const r = spawnSync(argv[0]!, argv.slice(1), { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${argv.join(" ")} exited ${r.status}: ${r.stderr.trim()}`);
  return r.stdout;
}

export const realSeams: MergeSeams = {
  lipoArchs: (path) => run(["lipo", "-archs", path]).trim().split(/\s+/),
  lipoCreate: (arm, intel, out) => { run(["lipo", "-create", arm, intel, "-output", out]); },
};

const STAMP = /\.sha256$/;

export function mergeUniversal(armRoot: string, intelRoot: string, outRoot: string, seams: MergeSeams = realSeams): MergeReport {
  for (const root of [armRoot, intelRoot]) {
    if (!existsSync(root)) throw new Error(`${root} is missing; fetch and build both slices first`);
  }
  rmSync(outRoot, { recursive: true, force: true });
  const report: MergeReport = { lipoed: [], differing: [], intelOnly: [] };

  const walk = (rel: string): void => {
    const arm = join(armRoot, rel);
    const intel = join(intelRoot, rel);
    const out = join(outRoot, rel);
    const st = lstatSync(arm);
    const intelSt = lstatOrNull(intel);

    if (st.isDirectory()) {
      if (intelSt && !intelSt.isDirectory()) throw new Error(`${rel} is a directory in arm64 but not in x86_64`);
      mkdirSync(out, { recursive: true });
      const names = new Set(readdirSync(arm));
      for (const name of names) {
        if (rel === "" && STAMP.test(name)) continue;
        walk(join(rel, name));
      }
      if (intelSt) {
        for (const name of readdirSync(intel)) {
          if (names.has(name) || (rel === "" && STAMP.test(name))) continue;
          collectIntelOnly(join(rel, name));
        }
      }
      return;
    }

    if (st.isSymbolicLink()) {
      const target = readlinkSync(arm);
      if (!intelSt?.isSymbolicLink() || readlinkSync(intel) !== target) {
        throw new Error(`${rel} links to ${target} in arm64 but differs in x86_64`);
      }
      symlinkSync(target, out);
      return;
    }

    const armMacho = isMachO(arm);
    if (!intelSt || !intelSt.isFile()) {
      if (armMacho) throw new Error(`${rel} is a binary with no x86_64 counterpart`);
      copyFileSync(arm, out);
      return;
    }
    const intelMacho = isMachO(intel);
    if (armMacho !== intelMacho) throw new Error(`${rel} is a binary in one slice and not the other`);
    if (!armMacho) {
      if (!readFileSync(arm).equals(readFileSync(intel))) report.differing.push(rel);
      copyFileSync(arm, out);
      return;
    }
    const armArchs = seams.lipoArchs(arm);
    if (armArchs.includes("arm64") && armArchs.includes("x86_64")) {
      copyFileSync(arm, out);
      return;
    }
    if (!armArchs.includes("arm64")) throw new Error(`${rel} in the arm64 slice is ${armArchs.join(" ")}`);
    const intelArchs = seams.lipoArchs(intel);
    if (!intelArchs.includes("x86_64")) throw new Error(`${rel} in the x86_64 slice is ${intelArchs.join(" ")}`);
    seams.lipoCreate(arm, intel, out);
    chmodSync(out, st.mode & 0o7777);
    report.lipoed.push(rel);
  };

  const collectIntelOnly = (rel: string): void => {
    const intel = join(intelRoot, rel);
    const st = lstatSync(intel);
    if (st.isDirectory()) {
      for (const name of readdirSync(intel)) collectIntelOnly(join(rel, name));
      return;
    }
    if (st.isFile() && isMachO(intel)) throw new Error(`${rel} is a binary only the x86_64 slice carries`);
    report.intelOnly.push(rel);
  };

  walk("");
  return report;
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--deps");
  const deps = resolve(at >= 0 ? args[at + 1]! : join(import.meta.dir, "..", "rt-tray", "deps"));
  const out = join(deps, "universal");
  const report = mergeUniversal(join(deps, "arm64"), join(deps, "x86_64"), out);
  for (const rel of report.lipoed) console.log(`  + ${rel} (arm64 + x86_64)`);
  for (const rel of report.differing) console.log(`  . ${rel}: differs between slices, shipping the arm64 copy`);
  for (const rel of report.intelOnly) console.log(`  . ${rel}: only in x86_64, not shipped`);
  console.log(`Merged ${report.lipoed.length} binaries into ${out}`);
}
