import { readFileSync } from "fs";
import { compareVersions } from "../../lib/skills/installed-plugins.ts";

const REF = "plugins/mattstack/attachments/mcp-tools/reference.md";
const FLOOR = "plugins/mattstack/pack/requires.json";

export function checkEngineFloor(input: { changed: string[]; prBody: string; floor: string | null; pluginVersion: string }): string[] {
  const errors: string[] = [];
  if (input.floor !== null && compareVersions(input.floor, input.pluginVersion) > 0) {
    errors.push(`${FLOOR} sets minEngine ${input.floor}, above the plugin's own version ${input.pluginVersion}; every Mac would hold it.`);
  }
  if (input.changed.includes(REF) && !input.changed.includes(FLOOR) && !/^engine-floor: unchanged\b/m.test(input.prBody)) {
    errors.push(`The MCP tools reference changed but ${FLOOR} did not. Raise minEngine to this PR's plugin version if skills now need the new tools, or add a line "engine-floor: unchanged <reason>" to the PR body. Edit the PR body, then push a commit (re-running the job reads the old body).`);
  }
  return errors;
}

if (import.meta.main) {
  const i = process.argv.indexOf("--base");
  const base = (i === -1 ? undefined : process.argv[i + 1]) ?? "HEAD^1";
  const diff = Bun.spawnSync(["git", "diff", "--name-only", base, "HEAD"]);
  if (diff.exitCode !== 0) {
    console.error(`git diff against ${base} failed: ${diff.stderr.toString().trim()}`);
    process.exit(2);
  }
  const changed = diff.stdout.toString().split("\n").filter(Boolean);
  const floorRaw = (() => { try { return readFileSync(FLOOR, "utf8"); } catch { return null; } })();
  const floor = floorRaw ? ((JSON.parse(floorRaw) as { minEngine?: string }).minEngine ?? null) : null;
  const pluginVersion = (JSON.parse(readFileSync("plugins/mattstack/.claude-plugin/plugin.json", "utf8")) as { version: string }).version;
  const errors = checkEngineFloor({ changed, prBody: process.env.PR_BODY ?? "", floor, pluginVersion });
  for (const e of errors) console.error(e);
  process.exit(errors.length ? 1 : 0);
}
