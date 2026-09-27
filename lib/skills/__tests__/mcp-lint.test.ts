import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { listAgentSafe } from "../../command-tree-resolve.ts";
import { TREE } from "../../command-tree-def.ts";
import { mcpTools } from "../../mcp/tools.ts";
import { HEADER_COMMENT } from "../compile.ts";
import { commandPattern, deriveRules, formatHit, KEPT_ON_BASH, lintedMarkdownFiles, lintPackDir, lintPackScripts, lintScriptText, lintSkillText, pickRule, SCRIPT_ONLY_RULES } from "../mcp-lint.ts";

const md = (...lines: string[]) => lines.join("\n");
const LEAF_ENTRIES = listAgentSafe(TREE).map((l) => ({ path: l.path, deniedFlags: l.node.agentDeniedFlags, noCwd: l.node.agentNoCwd }));
const LEAVES = LEAF_ENTRIES.map((l) => l.path);
const RULES = deriveRules(mcpTools(), LEAF_ENTRIES);

describe("deriveRules on the real roster", () => {
  test("every rule hits its own example and wins it", () => {
    for (const r of RULES) {
      const hits = lintSkillText(`\`${r.example}\``, "a.md", RULES);
      expect(hits.map((h) => h.rule), r.id).toEqual([r.id]);
      expect(hits[0]!.tool, r.id).toBe(r.tool);
    }
  });
  test("rule ids are unique", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });
  test("every agent-safe leaf is covered by a leaf rule or a tool form of the same command", () => {
    for (const p of LEAVES) {
      const cmd = `rt ${p.join(" ")}`;
      expect(RULES.some((r) => r.id === cmd), cmd).toBe(true);
    }
  });
  test("a leaf a tool form already names is dropped in favor of the tool", () => {
    const gateList = RULES.filter((r) => r.id === "rt gate list");
    expect(gateList.map((r) => r.tool)).toEqual(["gate_list"]);
  });
  test("leaf rules name rt_verb with the args array", () => {
    const r = RULES.find((x) => x.id === "rt skills check")!;
    expect(r.tool).toBe("rt_verb");
    expect(r.source).toBe("leaf");
    expect(r.note).toBe('args: ["skills", "check"]');
  });
  test("the leak that started this: every chat verb with a tool is linted", () => {
    expect(lintSkillText("reply with `rt chat dm <handle>`", "a.md", RULES).map((h) => h.tool)).toEqual(["chat_dm"]);
    expect(lintSkillText("```\nrt chat post build hi\n```", "a.md", RULES).map((h) => h.tool)).toEqual(["chat_post"]);
  });
  test("a tool with { none } derives no rule", () => {
    expect(RULES.some((r) => r.tool === "whoami")).toBe(false);
  });
});

describe("leaf rules on denied flags and noCwd", () => {
  test("a denied flag later on the line takes the leaf off rt_verb", () => {
    expect(pickRule("rt skills compile --pack x --pack-dir /y", RULES)).toBeNull();
  });
  test("the same leaf with no denied flag still hits rt_verb", () => {
    expect(pickRule("rt skills compile --pack x", RULES)!.id).toBe("rt skills compile");
  });
  test("a noCwd leaf's note tells the agent to pass --pack", () => {
    for (const id of ["rt skills compile", "rt skills sync", "rt skills surface", "rt skills bind"]) {
      const r = RULES.find((x) => x.id === id)!;
      expect(r.note, id).toContain("rt_verb runs it with no cwd, so pass --pack");
    }
  });
  test("a leaf with no noCwd carries no such note", () => {
    const r = RULES.find((x) => x.id === "rt skills check")!;
    expect(r.note).not.toContain("no cwd");
  });
});

describe("commandPattern", () => {
  test("matches the command with any whitespace between words", () => {
    expect(commandPattern("rt chat dm").test("rt  chat\tdm x")).toBe(true);
  });
  test("never matches a longer verb it is a prefix of", () => {
    expect(commandPattern("rt herd wrap").test("rt herd wrap-up")).toBe(false);
    expect(commandPattern("rt gate list").test("rt gate listx")).toBe(false);
  });
  test("never matches inside a longer word", () => {
    expect(commandPattern("rt sync").test("rt skills sync")).toBe(false);
    expect(commandPattern("git push").test("legit push")).toBe(false);
  });
  test("never matches a hyphenated prefix", () => {
    expect(commandPattern("rt chat dm").test("mattstack-rt chat dm")).toBe(false);
  });
  test("still matches after a path separator", () => {
    expect(commandPattern("rt chat dm").test("/usr/local/bin/rt chat dm")).toBe(true);
  });
});

describe("pickRule precedence", () => {
  const rule = (id: string, pattern: RegExp, source: "tool" | "leaf" = "tool") => ({ id, pattern, tool: id, example: id, source });
  test("the earliest match wins", () => {
    expect(pickRule("IID=$(glab mr list)", RULES)!.id).toBe("subst");
  });
  test("on the same start, the longer match wins", () => {
    expect(pickRule("rt runs show 3", RULES)!.id).toBe("rt runs show");
    expect(pickRule("glab mr merge 4", RULES)!.id).toBe("glab mr merge");
    expect(pickRule("rt git push", RULES)!.id).toBe("rt git push");
  });
  test("on the same start and length, the earlier rule wins", () => {
    const rules = [rule("a", /\bx y\b/), rule("b", /\bx y\b/, "leaf")];
    expect(pickRule("x y", rules)!.id).toBe("a");
  });
  test("no match is null", () => {
    expect(pickRule("git commit -m x", RULES)).toBeNull();
  });
});

describe("formatHit", () => {
  test("names the tool and note", () => {
    const [hit] = lintSkillText("`rt skills check --pack x`", "a.md", RULES);
    expect(formatHit(hit!)).toBe('a.md:1: `rt skills check --pack x` shells out for rt skills check; use the rt_verb tool (args: ["skills", "check"])');
  });
  test("drops the parenthesis when there is no note", () => {
    const [hit] = lintSkillText("`rt chat dm x`", "a.md", RULES);
    expect(formatHit(hit!)).toBe("a.md:1: `rt chat dm x` shells out for rt chat dm; use the chat_dm tool");
  });
});

describe("lintSkillText: no hits", () => {
  test("the kept-on-Bash list", () => {
    const kept = md(
      "```bash", "rt gate answer <id> --answers '<json>' --by shepherd", "rt gate wait <id>", "rt events wait 'run:*'",
      "git rebase --continue", "git rebase --skip", "git commit -m x", "git add -A", "git fetch origin", "git merge-base HEAD origin/main", "```",
    );
    expect(lintSkillText(kept, "k.md", RULES)).toEqual([]);
    expect(KEPT_ON_BASH.length).toBeGreaterThan(0);
  });
  test("the shepherd's --by=shepherd and --by  shepherd forms are kept on Bash too", () => {
    expect(lintSkillText("```bash\nrt gate answer <id> --answers '<json>' --by=shepherd\n```", "k.md", RULES)).toEqual([]);
    expect(lintSkillText("```bash\nrt gate answer <id> --answers '<json>' --by  shepherd\n```", "k.md", RULES)).toEqual([]);
  });
  test("prose that names a tool", () => {
    const prose = md(
      "Push with the `git_push` tool (`tree`, `setUpstream: true`).",
      "Start the run with `run_start`; keep its `runDb`.",
      "Call `rt_verb` with args [\"herd\", \"status\"].",
      "Merge with `mr_merge`; GitLab still enforces approvals.",
      "Provision with `worktree_provision`, then EnterWorktree by path.",
    );
    expect(lintSkillText(prose, "p.md", RULES)).toEqual([]);
  });
  test("plain prose outside code is not linted (the audit covers it)", () => {
    expect(lintSkillText("Then push the branch and open the MR.", "p.md", RULES)).toEqual([]);
  });
  test("the allow marker excuses its own line and the code line under a marker-only line", () => {
    const allowed = md(
      "Never hand-build a `glab api` call. <!-- mcp-lint: allow -->",
      "- the `glab` CLI (authenticated) <!-- mcp-lint: allow -->",
      "<!-- mcp-lint: allow -->",
      "`git push --force` is what this guard exists to stop.",
      "```bash",
      "<!-- mcp-lint: allow -->",
      "git rebase -i HEAD~3",
      "```",
    );
    expect(lintSkillText(allowed, "a.md", RULES)).toEqual([]);
  });
  test("the marker excuses one line only, never the rest of a block", () => {
    const partly = md("```bash", "<!-- mcp-lint: allow -->", "git push", "git rebase origin/main", "```");
    const hits = lintSkillText(partly, "a.md", RULES);
    expect(hits.map((h) => h.rule)).toEqual(["git-rebase"]);
  });
});

describe("lintPackDir", () => {
  test("walks skills, attachments and plugin/skills markdown only", () => {
    const files: Record<string, string> = {
      "/p/skills/work/SKILL.md": "```\nrt runs snapshot\n```",
      "/p/attachments/fill/SKILL.md": "`glab mr view 1`",
      "/p/plugin/skills/x/SKILL.md": "`git push`",
      "/p/README.md": "`git push`",
      "/p/skills/work/notes.txt": "`git push`",
    };
    const hits = lintPackDir("/p", RULES, { list: () => Object.keys(files), read: (p) => files[p] ?? "" });
    expect(hits.map((h) => h.file).sort()).toEqual(["/p/attachments/fill/SKILL.md", "/p/plugin/skills/x/SKILL.md", "/p/skills/work/SKILL.md"]);
  });

  test("skips compiled output (it carries the compiler header) and lints the hand-written file beside it", () => {
    const files: Record<string, string> = {
      "/p/skills/work/SKILL.md": `---\nname: work\n---\n${HEADER_COMMENT}\n\`git push\`\n`,
      "/p/skills/hand/SKILL.md": "`git push`",
      "/p/attachments/work/step.md": `${HEADER_COMMENT}\n\`glab mr view 1\`\n`,
    };
    const deps = { list: () => Object.keys(files), read: (p: string) => files[p] ?? "" };
    expect(lintPackDir("/p", RULES, deps).map((h) => h.file)).toEqual(["/p/skills/hand/SKILL.md"]);
    expect(lintedMarkdownFiles("/p", deps)).toEqual(["/p/skills/hand/SKILL.md"]);
  });

  test("a file the reader cannot return is skipped, not a crash", () => {
    const deps = { list: () => ["/p/skills/a/SKILL.md", "/p/skills/b/SKILL.md"], read: (p: string) => (p.includes("/a/") ? null : "`git push`") };
    expect(lintPackDir("/p", RULES, deps).map((h) => h.file)).toEqual(["/p/skills/b/SKILL.md"]);
  });
});

describe("lintPackDir on disk", () => {
  test("never descends a symlinked directory, tolerates missing roots, and skips an unreadable file", () => {
    const pack = mkdtempSync(join(tmpdir(), "rt-mcp-lint-pack-"));
    const outside = mkdtempSync(join(tmpdir(), "rt-mcp-lint-outside-"));
    try {
      mkdirSync(join(pack, "skills", "real"), { recursive: true });
      writeFileSync(join(pack, "skills", "real", "SKILL.md"), "`git push`\n");
      mkdirSync(join(pack, "skills", "locked"), { recursive: true });
      writeFileSync(join(pack, "skills", "locked", "SKILL.md"), "`git push`\n");
      chmodSync(join(pack, "skills", "locked", "SKILL.md"), 0o000);
      writeFileSync(join(outside, "SKILL.md"), "`git push`\n");
      symlinkSync(outside, join(pack, "skills", "linked"));
      expect(lintPackDir(pack, RULES).map((h) => h.file)).toEqual([join(pack, "skills", "real", "SKILL.md")]);
    } finally {
      chmodSync(join(pack, "skills", "locked", "SKILL.md"), 0o644);
      rmSync(pack, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a verb dir whose SKILL.md carries the compiler header is skipped whole, vendored files included", () => {
    const pack = mkdtempSync(join(tmpdir(), "rt-mcp-lint-compiled-"));
    try {
      mkdirSync(join(pack, "skills", "verb", "references"), { recursive: true });
      mkdirSync(join(pack, "skills", "verb", "parts", "fix"), { recursive: true });
      mkdirSync(join(pack, "skills", "other"), { recursive: true });
      writeFileSync(join(pack, "skills", "verb", "SKILL.md"), `---\nname: verb\n---\n${HEADER_COMMENT}\n\`git push\`\n`);
      writeFileSync(join(pack, "skills", "verb", "references", "engine.md"), "`git push -u`\n");
      writeFileSync(join(pack, "skills", "verb", "parts", "fix", "notes.md"), "`glab mr view`\n");
      writeFileSync(join(pack, "skills", "other", "SKILL.md"), "`git push`\n");
      expect(lintPackDir(pack, RULES).map((h) => h.file)).toEqual([join(pack, "skills", "other", "SKILL.md")]);
      expect(lintedMarkdownFiles(pack)).toEqual([join(pack, "skills", "other", "SKILL.md")]);
    } finally {
      rmSync(pack, { recursive: true, force: true });
    }
  });

  test("skips a dot-directory, venv and __pycache__ during the real walk", () => {
    const pack = mkdtempSync(join(tmpdir(), "rt-mcp-lint-skipdirs-"));
    try {
      mkdirSync(join(pack, "skills", "a", ".venv", "lib"), { recursive: true });
      writeFileSync(join(pack, "skills", "a", ".venv", "lib", "x.py"), "git push\n");
      mkdirSync(join(pack, "skills", "a", "venv", "lib"), { recursive: true });
      writeFileSync(join(pack, "skills", "a", "venv", "lib", "y.py"), "git push\n");
      mkdirSync(join(pack, "skills", "a", "__pycache__"), { recursive: true });
      writeFileSync(join(pack, "skills", "a", "__pycache__", "z.py"), "git push\n");
      mkdirSync(join(pack, "skills", "a", "scripts"), { recursive: true });
      writeFileSync(join(pack, "skills", "a", "scripts", "real.py"), "git push\n");
      expect(lintPackScripts(pack, RULES).map((h) => h.file)).toEqual([join(pack, "skills", "a", "scripts", "real.py")]);
    } finally {
      rmSync(pack, { recursive: true, force: true });
    }
  });
});

describe("lintScriptText", () => {
  const SCRIPT_RULES = [...RULES, ...SCRIPT_ONLY_RULES];
  test("scans whole lines, not code spans", () => {
    expect(lintScriptText("set -e\ngit push origin HEAD\n", "s.sh", SCRIPT_RULES).map((h) => [h.line, h.tool])).toEqual([[2, "git_push"]]);
  });
  test("skips comment lines and allow-marked lines", () => {
    const text = ["# never git push here", "  // git push is the tool's job", "git push # mcp-lint: allow", "glab mr view 1  // mcp-lint: allow"].join("\n");
    expect(lintScriptText(text, "s.sh", SCRIPT_RULES)).toEqual([]);
  });
  test("the allow marker only counts inside a trailing comment", () => {
    const hits = lintScriptText('echo "mcp-lint: allow"; git push\n', "s.sh", SCRIPT_RULES);
    expect(hits.map((h) => h.tool)).toEqual(["git_push"]);
  });
  test("gh pr and gh api are flagged with no tool named", () => {
    const hits = lintScriptText("gh pr view 3\ngh api repos/x\ngh auth status\n", "s.sh", SCRIPT_RULES);
    expect(hits.map((h) => [h.line, h.tool])).toEqual([[1, null], [2, null]]);
    expect(formatHit(hits[0]!)).toContain("no MCP tool covers it yet");
  });
  test("the kept-on-Bash list still wins", () => {
    expect(lintScriptText("rt gate wait abc\n", "s.sh", SCRIPT_RULES)).toEqual([]);
  });
  test("CRLF lines still match", () => {
    expect(lintScriptText("git push\r\n", "s.sh", SCRIPT_RULES).length).toBe(1);
  });
});

describe("lintPackScripts", () => {
  test("walks .sh, .py and .ts under the linted roots only", () => {
    const files: Record<string, string> = {
      "/p/skills/a/scripts/x.sh": "git push",
      "/p/attachments/b/y.py": "subprocess.run(['glab', 'mr', 'view'])",
      "/p/plugin/skills/c/z.ts": "await $`rt chat dm x hi`",
      "/p/skills/a/SKILL.md": "`git push`",
      "/p/scripts/gen.ts": "git push",
      "/p/skills/a/notes.txt": "git push",
    };
    const hits = lintPackScripts("/p", RULES, { list: () => Object.keys(files), read: (p) => files[p] ?? null });
    expect(hits.map((h) => h.file).sort()).toEqual(["/p/attachments/b/y.py", "/p/plugin/skills/c/z.ts", "/p/skills/a/scripts/x.sh"]);
  });
  test("skips a compiled verb dir's vendored scripts", () => {
    const files: Record<string, string> = {
      "/p/skills/verb/SKILL.md": `---\nname: verb\n---\n${HEADER_COMMENT}\n`,
      "/p/skills/verb/parts/a/scripts/pick.py": "git push",
      "/p/attachments/a/scripts/pick.py": "git push",
    };
    const hits = lintPackScripts("/p", RULES, { list: () => Object.keys(files), read: (p) => files[p] ?? null });
    expect(hits.map((h) => h.file)).toEqual(["/p/attachments/a/scripts/pick.py"]);
  });
  test("an unreadable script is skipped and no scripts is empty", () => {
    expect(lintPackScripts("/p", RULES, { list: () => ["/p/skills/a/x.sh"], read: () => null })).toEqual([]);
    expect(lintPackScripts("/p", RULES, { list: () => [], read: () => null })).toEqual([]);
  });
  test("a captured-output line is judged on the inner call, not flagged as subst", () => {
    const files: Record<string, string> = { "/p/skills/a/scripts/x.sh": "out=$(glab ci retry 5)" };
    const hits = lintPackScripts("/p", RULES, { list: () => Object.keys(files), read: (p) => files[p] ?? null });
    expect(hits.map((h) => h.tool)).toEqual(["mr_retry"]);
  });
});
