#!/usr/bin/env bun
// usage: bun build.ts <out dir>; writes <red|green>-<scenario>.md, a header from
// headers/ plus that side's compiled ship from compiled/ (includes already inlined).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const T = import.meta.dir;
const out = process.argv[2];
if (!out) {
  console.error("usage: bun build.ts <out dir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
for (const side of ["red", "green"]) {
  const skill = readFileSync(join(T, "compiled", `${side}-ship.md`), "utf8");
  for (const h of readdirSync(join(T, "headers")).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(join(T, "headers", h), "utf8") + "\n---- SKILL: ship ----\n" + skill;
    writeFileSync(join(out, `${side}-${h}`), text);
    console.log(side, h.replace(/\.md$/, ""), text.split(/\s+/).length);
  }
}
