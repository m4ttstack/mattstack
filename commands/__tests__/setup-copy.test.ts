/**
 * The plan in two views. The machine view is what the tray and agents read
 * and never changes without a contract change; the copy view is every string
 * a person reads, so a wording change is a deliberate snapshot update.
 */
import { afterAll, beforeAll, describe, test, expect } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb } from "../../lib/state/index.ts";
import { composePlan } from "../../lib/setup/plan.ts";
import type { Plan, Row } from "../../lib/setup/contract.ts";
import { fakeProbes, ok } from "../../lib/setup/__tests__/fakes.ts";
import type { ExecScript } from "../../lib/setup/__tests__/fakes.ts";
import type { SecretPresence } from "../../lib/setup/validators/accounts.ts";

const readyExec: ExecScript = (argv) => (argv[0] === "sw_vers" ? ok("15.6") : ok());
const secrets: SecretPresence = { async has() { return null; } };

async function plan(mode: "plan" | "status"): Promise<Plan> {
  return composePlan({ p: fakeProbes({ exec: readyExec }), secrets, ci: false, mode, teams: [], waived: [] });
}

/** The only keys inside an action that a person reads and no program does. Everything else in an action is the app's to act on. */
const ACTION_COPY_KEYS = new Set(["label", "subtitle", "footnote", "steps", "hint", "detail", "sample"]);

/** Splits an action: the copy keys leave the machine half and land in `copy` by path; every other key and value stays. */
function splitAction(value: unknown, path: string, copy: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((v, i) => splitAction(v, `${path}[${i}]`, copy));
  if (value === null || typeof value !== "object") return value;
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (ACTION_COPY_KEYS.has(k)) copy[`${path}.${k}`] = v;
    else kept[k] = splitAction(v, `${path}.${k}`, copy);
  }
  return kept;
}

/**
 * Fields a validator reads straight off this Mac with no probe seam composePlan can fake, so the
 * snapshot pins a token in their place. `tool.editor` lists the editor apps in /Applications.
 */
const MACHINE_READ: Record<string, readonly (keyof Row)[]> = { "tool.editor": ["status", "detail"] };

function pinMachineReads(r: Row): Row {
  const fields = MACHINE_READ[r.id];
  return fields ? { ...r, ...Object.fromEntries(fields.map((f) => [f, "<read from this Mac>"])) } : r;
}

function views(p: Plan) {
  const { at: _at, ...rest } = p;
  const copy: Record<string, unknown> = {};
  const machine = {
    ...rest,
    groups: p.groups.map((g) => {
      copy[`${g.id}.title`] = g.title;
      const { title: _title, rows, ...group } = g;
      return {
        ...group,
        rows: rows.map((raw: Row) => {
          const r = pinMachineReads(raw);
          const { title, why, detail, optionalNote, action, ...keep } = r;
          Object.assign(copy, { [`${r.id}.title`]: title, [`${r.id}.why`]: why, [`${r.id}.detail`]: detail, [`${r.id}.optionalNote`]: optionalNote });
          return { ...keep, action: splitAction(action, `${r.id}.action`, copy) };
        }),
      };
    }),
  };
  return { machine, copy };
}

const machineView = (p: Plan) => views(p).machine;
const copyView = (p: Plan) => views(p).copy;

describe("the setup plan's shape and copy", () => {
  // Some rows read the real HOME (legacy state folders, the state db), which other tests in this directory leave state in.
  const origHome = process.env.HOME;
  const origCi = process.env.CI;
  let home: string;
  beforeAll(() => {
    delete process.env.CI;
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-setup-copy-home-")));
    process.env.HOME = home;
    closeStateDb();
  });
  afterAll(() => {
    process.env.HOME = origHome;
    if (origCi === undefined) delete process.env.CI;
    else process.env.CI = origCi;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  for (const mode of ["plan", "status"] as const) {
    test(`${mode}: the machine view is unchanged`, async () => {
      expect(machineView(await plan(mode))).toMatchSnapshot();
    });
    test(`${mode}: the copy is what the copy table says`, async () => {
      expect(copyView(await plan(mode))).toMatchSnapshot();
    });
  }
});
