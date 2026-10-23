#!/usr/bin/env bun
// usage: bun build.ts <out dir> <red|green> <skills root>
// Writes <side>-<skill>--<scenario>.md for each header in headers/: the header,
// then the skill's SKILL.md and, for extending-a-pack, the props or slots
// reference beside it. <skills root> holds the skill folders: a snapshot of
// plugin/skills from before the change for red, plugin/skills for green.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const T = import.meta.dir;
const [out, side, root] = process.argv.slice(2);
if (!out || (side !== "red" && side !== "green") || !root) {
  console.error("usage: bun build.ts <out dir> <red|green> <skills root>");
  process.exit(2);
}
const FILES: Record<string, string[]> = { "extending-a-pack": ["SKILL.md", "props.md", "slots.md"] };
mkdirSync(out, { recursive: true });
for (const h of readdirSync(join(T, "headers")).filter((f) => f.endsWith(".md"))) {
  const skill = h.split("--")[0]!;
  let text = readFileSync(join(T, "headers", h), "utf8");
  for (const f of FILES[skill] ?? ["SKILL.md"]) {
    const p = join(root, skill, f);
    if (existsSync(p)) text += `\n---- FILE: ${skill}/${f} ----\n` + readFileSync(p, "utf8");
  }
  writeFileSync(join(out, `${side}-${h}`), text);
  console.log(side, h.replace(/\.md$/, ""), text.split(/\s+/).length);
}
