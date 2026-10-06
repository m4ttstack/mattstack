import { SMOKE_CHECKS, runSmoke } from "./lib/docs-smoke.ts";

const failures = await runSmoke(SMOKE_CHECKS, {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => Bun.sleep(ms),
});
for (const f of failures) console.error(f);
console.log(`docs smoke: ${SMOKE_CHECKS.length - failures.length}/${SMOKE_CHECKS.length} ok`);
process.exit(failures.length ? 1 : 0);
