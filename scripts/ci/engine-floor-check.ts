import { readFileSync } from "fs";
import { compareVersions } from "../../lib/skills/installed-plugins.ts";

const REF = "plugins/mattstack/attachments/mcp-tools/reference.md";
const FLOOR = "plugins/mattstack/pack/requires.json";

export function checkEngineFloor(input: { changed: string[]; prBody: string; floor: string | null; baseFloor: string | null; pluginVersion: string }): string[] {
  const errors: string[] = [];
  if (input.floor !== null && compareVersions(input.floor, input.pluginVersion) > 0) {
    errors.push(`${FLOOR} sets minEngine ${input.floor}, above the plugin's own version ${input.pluginVersion}; every Mac would hold it.`);
  }
  const raised = input.floor !== null && (input.baseFloor === null || compareVersions(input.floor, input.baseFloor) > 0);
  if (input.changed.includes(REF) && !raised && !/^engine-floor: unchanged\b/m.test(input.prBody)) {
    errors.push(`The MCP tools reference changed but ${FLOOR} did not raise minEngine. Raise minEngine to this PR's plugin version if skills now need the new tools, or add a line "engine-floor: unchanged <reason>" to the PR body. Edit the PR body, then push a commit (re-running the job reads the old body).`);
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
  const minEngine = (raw: string | null) => (raw ? ((JSON.parse(raw) as { minEngine?: string }).minEngine ?? null) : null);
  const floor = minEngine((() => { try { return readFileSync(FLOOR, "utf8"); } catch { return null; } })());
  const show = Bun.spawnSync(["git", "show", `${base}:${FLOOR}`]);
  const baseFloor = minEngine(show.exitCode === 0 ? show.stdout.toString() : null);
  const pluginVersion = (JSON.parse(readFileSync("plugins/mattstack/.claude-plugin/plugin.json", "utf8")) as { version: string }).version;
  const errors = checkEngineFloor({ changed, prBody: process.env.PR_BODY ?? "", floor, baseFloor, pluginVersion });
  for (const e of errors) console.error(e);
  process.exit(errors.length ? 1 : 0);
}
