/**
 * Before cutover: every page rt.cool ever served must redirect to a page the
 * new build has. Usage:
 *   bun scripts/check-rt-cool-redirects.ts [--sitemap <url|file>] [--build website/build]
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { hasRule, resolveRedirect } from "./lib/docs-moves.ts";

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1]! : dflt;
};
const sitemap = opt("--sitemap", "https://rt.cool/sitemap.xml");
const build = opt("--build", "website/build");

const fail = (reason: string): never => {
  console.error(reason);
  process.exit(1);
};

let xml: string;
if (sitemap.startsWith("http")) {
  const res = await fetch(sitemap);
  if (!res.ok) fail(`could not read ${sitemap}: HTTP ${res.status}`);
  xml = await res.text();
} else {
  xml = readFileSync(sitemap, "utf8");
}
const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
if (paths.length === 0) fail(`no pages found in ${sitemap}`);

const built = (p: string) =>
  p === "/" ? existsSync(join(build, "index.html"))
    : existsSync(join(build, p, "index.html")) || existsSync(join(build, `${p}.html`));

const misses = paths.filter((p) => !hasRule(p) || !built(resolveRedirect(p)));
for (const p of misses) {
  console.error(hasRule(p) ? `  ${p} -> ${resolveRedirect(p)} (no page)` : `  ${p} -> (no rule)`);
}
console.log(`${paths.length - misses.length}/${paths.length} rt.cool pages land on a built page`);
process.exit(misses.length ? 1 : 0);
