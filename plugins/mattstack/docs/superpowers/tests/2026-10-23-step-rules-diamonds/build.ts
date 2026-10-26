#!/usr/bin/env bun
// usage: bun build.ts <out dir>; writes <red|green>-<scenario>.md, a header from
// headers/ plus that side's compiled stage-gates from compiled/ (includes already inlined),
// for each side whose compiled file exists.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const T = import.meta.dir;
const out = process.argv[2];
if (!out) {
  console.error("usage: bun build.ts <out dir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
for (const side of ["red", "green"].filter((s) => existsSync(join(T, "compiled", `${s}-stage-gates.md`)))) {
  const skill = readFileSync(join(T, "compiled", `${side}-stage-gates.md`), "utf8");
  for (const h of readdirSync(join(T, "headers")).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(join(T, "headers", h), "utf8") + "\n---- SKILL: stage-gates ----\n" + skill;
    writeFileSync(join(out, `${side}-${h}`), text);
    console.log(side, h.replace(/\.md$/, ""), text.split(/\s+/).length);
  }
}
