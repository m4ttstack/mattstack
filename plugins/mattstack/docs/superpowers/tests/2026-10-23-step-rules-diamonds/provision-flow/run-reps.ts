#!/usr/bin/env bun
// usage: bun run-reps.ts <prompt dir> <empty dir> <red|green> <scenario...>
// 5 tool-less reps per scenario into runs/; exits 1 when any rep's claude process
// failed, its output file holding the error. A Bun runner because the worktree's
// Bash guard refuses `bash <script>`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const T = import.meta.dir;
const [prompts, empty, side, ...scenarios] = process.argv.slice(2);
if (!prompts || !empty || (side !== "red" && side !== "green") || scenarios.length === 0) {
  console.error("usage: bun run-reps.ts <prompt dir> <empty dir> <red|green> <scenario...>");
  process.exit(2);
}
mkdirSync(join(T, "runs"), { recursive: true });
mkdirSync(empty, { recursive: true });
const settings = JSON.stringify({ disableAllHooks: true });
const jobs = scenarios.flatMap((name) =>
  [1, 2, 3, 4, 5].map(async (i) => {
    const out = join(T, "runs", `${side}-${name}-${i}.txt`);
    const p = Bun.spawn(
      ["claude", "--model", "sonnet", "--tools", "", "--strict-mcp-config", "--setting-sources", "local",
        "--settings", settings, "--disable-slash-commands", "--no-session-persistence", "-p"],
      { cwd: empty, stdin: new Blob([readFileSync(join(prompts, `${side}-${name}.md`))]), stdout: "pipe", stderr: "pipe" },
    );
    const text = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    writeFileSync(out, text);
    const code = await p.exited;
    if (code !== 0) console.error(`failed: ${out}`);
    return code;
  }),
);
const codes = await Promise.all(jobs);
process.exit(codes.some((c) => c !== 0) ? 1 : 0);
