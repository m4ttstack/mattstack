// scripts/gen-mcp-tools.ts: stdin = the checkout's `bun cli.ts mcp tools --json`, stdout = reference.md
const input = JSON.parse(await Bun.stdin.text()) as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
const out: string[] = [
  "# mattstack MCP tools",
  "",
  "Generated from the checkout's `bun cli.ts mcp tools --json`; do not edit by hand. Regenerate from the repo root with:",
  "`bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`",
  "",
  "Every tool below is on the mattstack MCP server, which is allowed whole in every mattstack install. Before a skill tells an agent to run a shell command, check whether a tool here covers it.",
  "",
  "Kept on Bash on purpose: `rt gate wait <id>`, `rt events wait`, `git commit`, `git add`, `git fetch`, `git merge-base`, `git rebase --continue` and `--skip`, and project tooling. A shepherd answers and parks a lane's gates with herd_gate_answer and herd_gate_park.",
  "",
];
for (const t of input.tools) {
  out.push(`### ${t.name}`, "", "<!-- mcp-lint: allow -->", t.description, "", "```json", JSON.stringify(t.inputSchema, null, 2), "```", "");
}
process.stdout.write(out.join("\n"));
