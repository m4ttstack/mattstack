import { claimCiLease } from "../../src/ci-lease.ts";

const [dir, mrUrl, owner, holder = "watch-ci"] = process.argv.slice(2) as [string, string, string, ("watch-ci" | "doctor")?];
const r = claimCiLease({ mrUrl, owner, holder }, { dir });
process.stdout.write(JSON.stringify({ owner, claimed: r.claimed }));
