// scripts/gen-mcp-tools.ts: stdin = `rt mcp tools --json`, stdout = reference.md
const input = JSON.parse(await Bun.stdin.text()) as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
const out: string[] = [
  "# mattstack MCP tools",
  "",
  "Generated from `rt mcp tools --json`; do not edit by hand. Regenerate with:",
  "`rt mcp tools --json | bun scripts/gen-mcp-tools.ts > attachments/mcp-tools/reference.md`",
  "",
  "Every tool below is on the mattstack MCP server, which is allowed whole in every mattstack install. Before a skill tells an agent to run a shell command, check whether a tool here covers it.",
  "",
  "Kept on Bash on purpose: `rt gate answer <id> --answers <json> --by shepherd`, `rt gate wait <id>`, `rt chat tail`, `rt events wait`, `git commit`, `git add`, `git fetch`, `git merge-base`, `git rebase --continue` and `--skip`, and project tooling.",
  "",
];
for (const t of input.tools) {
  out.push(`### ${t.name}`, "", t.description, "", "```json", JSON.stringify(t.inputSchema, null, 2), "```", "");
}
process.stdout.write(out.join("\n"));
