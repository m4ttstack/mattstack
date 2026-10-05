import { join, relative, resolve } from "node:path";

import {
  createEvidence,
  requireLive,
  type Evidence,
  type QuestionId,
} from "./evidence";
import { command, startLab, type Lab } from "./lab";
import { result } from "./verdicts";

const IDS: QuestionId[] = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];
export function parseArgs(argv: string[]) {
  const value = (flag: string) => argv[argv.indexOf(flag) + 1];
  if (!argv.includes("--cases") || !argv.includes("--out"))
    throw new Error("requires --cases and --out");
  const cases = value("--cases")?.split(",") as QuestionId[];
  const out = value("--out");
  if (
    !out ||
    !cases?.length ||
    cases.some(x => !IDS.includes(x)) ||
    new Set(cases).size !== cases.length
  )
    throw new Error("invalid case selection/output");
  return { live: argv.includes("--live"), cases, out };
}
export async function runSelected(
  ids: QuestionId[],
  cases: Partial<Record<QuestionId, () => Promise<void>>>
) {
  for (const id of ids) await cases[id]?.();
}
export async function collectPaneTails(lab: Lab, ev: Evidence) {
  for (const w of lab.workers) {
    try {
      ev.record("pane-tail", {
        worker: w.name,
        read: await lab.herdr(
          "pane",
          "read",
          w.pane,
          "--source",
          "recent-unwrapped",
          "--lines",
          "40"
        ),
      });
    } catch (e) {
      try {
        ev.addCleanup({
          resource: `pane-tail ${w.name}`,
          ok: false,
          detail: String(e),
        });
      } catch {
        /* Cleanup must run even if evidence storage is unavailable. */
      }
    }
  }
}
export async function finalizeRun(lab: Lab, ev: Evidence) {
  try {
    await collectPaneTails(lab, ev);
  } finally {
    try {
      const rows = await lab.stop();
      for (const r of rows) {
        try {
          ev.addCleanup(r);
        } catch {
          /* Continue through other resources and final report. */
        }
      }
    } finally {
      ev.write();
    }
  }
}
if (import.meta.main) {
  const argv = process.argv.slice(2);
  requireLive(argv);
  const args = parseArgs(argv);
  const repo = process.cwd();
  const dir = resolve(args.out);
  if (
    !relative(join(repo, ".harness-spike"), dir) ||
    relative(join(repo, ".harness-spike"), dir).startsWith("..")
  )
    throw new Error("output must be a run directory under .harness-spike");
  await command(["git", "check-ignore", dir]);
  const versions = {
    codex: (await command(["codex", "--version"])).trim(),
    herdr: (await command(["herdr", "--version"])).trim(),
    bun: Bun.version,
    commit: (await command(["git", "rev-parse", "HEAD"])).trim(),
  };
  const ev = createEvidence(dir, versions);
  let lab: Lab | undefined;
  try {
    lab = await startLab({ repo, runDir: dir, ev });
    const groups = [
      { ids: ["G1", "G2"], load: () => import("./cases/attribution") },
      { ids: ["G3", "G4"], load: () => import("./cases/questions") },
      { ids: ["G5"], load: () => import("./cases/policy") },
      { ids: ["G6"], load: () => import("./cases/sockets") },
      { ids: ["G7"], load: () => import("./cases/delivery") },
    ];
    for (const group of groups) {
      const selected = args.cases.filter(id => group.ids.includes(id));
      if (!selected.length) continue;
      process.stdout.write(`running ${selected.join(",")}\n`);
      try {
        const mod = await group.load();
        for (const r of await mod.run(lab, ev, selected)) ev.addCase(r);
      } catch (e) {
        ev.record("case-error", { selected, error: String(e) });
        for (const id of selected)
          ev.addCase(
            result(
              id,
              "not-run",
              [String(e)],
              "Verify probe setup and repeat affected case"
            )
          );
      }
    }
  } finally {
    if (lab) await finalizeRun(lab, ev);
    else ev.write();
    process.stdout.write(`report: ${join(args.out, "report.json")}\n`);
  }
}
