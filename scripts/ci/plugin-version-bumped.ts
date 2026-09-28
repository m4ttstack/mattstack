/**
 * Fails a pull request that changed an in-tree plugin without moving its
 * .claude-plugin/plugin.json version: Claude Code only reinstalls a plugin
 * whose version changed. Usage:
 *   bun scripts/ci/plugin-version-bumped.ts --base <sha> --plugin plugins/<name>
 * The base commit must be fetched first.
 */
import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..", "..");

export type BumpInput = { plugin: string; changed: string[]; baseVersion: string | null; headVersion: string | null };
export type BumpResult = { ok: boolean; message: string };

export function checkVersionBump(input: BumpInput): BumpResult {
  const manifest = `${input.plugin}/.claude-plugin/plugin.json`;
  if (input.changed.length === 0) return { ok: true, message: `${input.plugin} unchanged` };
  if (input.headVersion === null) return { ok: false, message: `${manifest} has no "version" string` };
  if (input.baseVersion === null) return { ok: true, message: `${input.plugin} is new at ${input.headVersion}` };
  if (input.baseVersion === input.headVersion) {
    return {
      ok: false,
      message: `${input.plugin} changed (${input.changed.length} file(s)) but ${manifest} is still at ${input.headVersion}; bump its version`,
    };
  }
  return { ok: true, message: `${input.plugin} bumped ${input.baseVersion} -> ${input.headVersion}` };
}

function versionOf(text: string): string | null {
  const version = (JSON.parse(text) as { version?: unknown }).version;
  return typeof version === "string" ? version : null;
}

export function readHeadVersion(root: string, plugin: string): { version: string | null } | { error: string } {
  const manifest = `${plugin}/.claude-plugin/plugin.json`;
  const path = join(root, manifest);
  if (!existsSync(path)) return { error: `${manifest} is missing` };
  try {
    return { version: versionOf(readFileSync(path, "utf8")) };
  } catch (e) {
    const reason = (e instanceof Error ? e.message : String(e)).split("\n")[0];
    return { error: `${manifest} is not valid JSON: ${reason}` };
  }
}

function git(args: string[]): { code: number; stdout: string; stderr: string } {
  const res = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return { code: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (!value) {
    console.error(`usage: bun scripts/ci/plugin-version-bumped.ts --base <sha> --plugin plugins/<name> (missing ${name})`);
    process.exit(2);
  }
  return value;
}

if (import.meta.main) {
  const base = arg("--base");
  const plugin = arg("--plugin").replace(/\/+$/, "");
  const diff = git(["diff", "--name-only", base, "HEAD", "--", plugin]);
  if (diff.code !== 0) {
    console.error(`git diff against ${base} failed: ${diff.stderr.trim()}`);
    process.exit(2);
  }
  const changed = diff.stdout.split("\n").filter((l) => l !== "");
  const manifest = `${plugin}/.claude-plugin/plugin.json`;
  const head = readHeadVersion(ROOT, plugin);
  if ("error" in head) {
    console.error(head.error);
    process.exit(1);
  }
  const baseShow = git(["show", `${base}:${manifest}`]);
  let baseVersion: string | null = null;
  try {
    if (baseShow.code === 0) baseVersion = versionOf(baseShow.stdout);
  } catch {
    baseVersion = null;
  }
  const result = checkVersionBump({ plugin, changed, baseVersion, headVersion: head.version });
  (result.ok ? console.log : console.error)(result.message);
  process.exit(result.ok ? 0 : 1);
}
