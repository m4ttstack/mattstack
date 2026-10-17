/**
 * The plan in two views. The machine view is what the tray and agents read
 * and never changes without a contract change; the copy view is every string
 * a person reads, so a wording change is a deliberate snapshot update.
 */
import { afterAll, beforeAll, describe, test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { closeStateDb } from "../../lib/state/index.ts";
import { createApplyContext, runApplyWith } from "../../lib/setup/apply.ts";
import { STEPS } from "../../lib/setup/steps/index.ts";
import type { ApplyEvent } from "../../lib/setup/contract.ts";
import { composePlan } from "../../lib/setup/plan.ts";
import type { Plan, Row } from "../../lib/setup/contract.ts";
import { markDeferred } from "../../lib/setup/repo-placement.ts";
import { fakeProbes, ok } from "../../lib/setup/__tests__/fakes.ts";
import { sharedStorePath } from "../../packages/rt-client/test/org-fixture.ts";
import type { ExecScript } from "../../lib/setup/__tests__/fakes.ts";
import type { SecretPresence } from "../../lib/setup/validators/accounts.ts";

const readyExec: ExecScript = (argv) => (argv[0] === "sw_vers" ? ok("15.6") : ok());
const secrets: SecretPresence = { async has() { return null; } };

async function plan(mode: "plan" | "status"): Promise<Plan> {
  return composePlan({ p: fakeProbes({ exec: readyExec }), secrets, ci: false, mode, orgs: [], waived: [] });
}

/** The only keys inside an action that a person reads and no program does. Everything else in an action is the app's to act on. */
const ACTION_COPY_KEYS = new Set(["label", "subtitle", "footnote", "steps", "hint", "detail", "sample", "note", "problem"]);

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

  test("apply emits the org folder, pull and identity titles after a join", async () => {
    const events: ApplyEvent[] = [];
    const ctx = await createApplyContext({
      probes: fakeProbes(),
      emit: (event) => events.push(event),
      snapshotRead: () => undefined,
      secrets: {
        ageKeySeam: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
        execSeam: {
          run: async () => ({ code: 0, stdout: "", stderr: "" }),
          fileExists: () => false,
          statFile: () => null,
          readFile: () => "",
          writeFile: () => {},
          ensureDir: () => {},
          chmod: () => {},
          fsyncAndRename: () => {},
          removeFile: () => {},
        },
      },
      relay: {
        create: async () => ({ id: "", creatorSecret: "" }),
        fetch: async () => "gone",
        redeem: async () => "already",
        reply: async () => {},
        readReply: async () => "none",
        delete: async () => {},
      },
      secretPresence: secrets,
      flags: { nonInteractive: true, teamOfOne: false, ci: false },
    });
    await runApplyWith(
      STEPS.map((step) => ({ ...step, applies: () => true, run: async () => ({ state: "skipped", detail: "fixture" }) as const })),
      ctx,
      { only: "org.pull" },
    );
    const event = events.find((event) => event.event === "plan");
    if (!event || event.event !== "plan") throw new Error("missing apply plan");
    const at = event.steps.findIndex((step) => step.id === "team.join");
    expect(event.steps.slice(at, at + 4).map((step) => step.id)).toEqual(["team.join", "org.folder", "org.pull", "team.identity"]);
    expect(event.steps.slice(at + 1, at + 4).map((step) => ({ id: step.id, title: step.title }))).toMatchSnapshot();
  });

  for (const mode of ["plan", "status"] as const) {
    test(`${mode}: the machine view is unchanged`, async () => {
      expect(machineView(await plan(mode))).toMatchSnapshot();
    });
    test(`${mode}: the copy is what the copy table says`, async () => {
      expect(copyView(await plan(mode))).toMatchSnapshot();
    });
  }

  test("Your repos: one row per tracked repo, and the one Install left for you", async () => {
    const teamPath = sharedStorePath("acme");
    mkdirSync(dirname(teamPath), { recursive: true });
    writeFileSync(teamPath, JSON.stringify({ "mattstack.tracking": { repos: { "gitlab.com/acme/widgets": {}, "gitlab.com/acme/acme-api": {} } } }));
    // After Install, where a joiner first sees the rows: the home repo exists.
    const p = fakeProbes({ exec: readyExec, dirs: { "/fake-home/.mattstack/user/.git": [] } });
    markDeferred(p, "gitlab.com/acme/acme-api");
    const { machine, copy } = views(await composePlan({ p, secrets, ci: false, mode: "status", orgs: ["acme"], waived: [] }));
    expect(machine.groups.find((g) => g.id === "repos")).toMatchSnapshot();
    expect(Object.fromEntries(Object.entries(copy).filter(([key]) => key.startsWith("repos")))).toMatchSnapshot();
  });
});
