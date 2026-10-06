import { SMOKE_CHECKS, evaluate } from "./lib/docs-smoke.ts";

const failures: string[] = [];
for (const c of SMOKE_CHECKS) {
  const res = await fetch(c.url, { redirect: "manual" });
  const why = evaluate(c, { status: res.status, location: res.headers.get("location") });
  if (why) failures.push(why);
}
for (const f of failures) console.error(f);
console.log(`docs smoke: ${SMOKE_CHECKS.length - failures.length}/${SMOKE_CHECKS.length} ok`);
process.exit(failures.length ? 1 : 0);
