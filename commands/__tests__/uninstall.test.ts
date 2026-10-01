import { afterEach, beforeEach, describe, test, expect } from "bun:test";
import { realUninstallDeps, runUninstallCommand, UNINSTALL_FLAGS, type UninstallDeps } from "../uninstall.ts";
import { TREE } from "../../lib/command-tree-def.ts";
import type { UninstallAction } from "../../lib/setup/uninstall.ts";
import type { ApplyEvent } from "../../lib/setup/contract.ts";
import type { SecretsSeams } from "../../lib/secrets/store.ts";
import type { RelayClient } from "../../lib/team/relay-client.ts";
import type { SecretPresence } from "../../lib/setup/validators/accounts.ts";
import { fakeProbes, fakeTray } from "../../lib/setup/__tests__/fakes.ts";
import { capturePlain, expectOneJsonLine, realJson } from "./helpers/json-line.ts";
import type { CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

let quiet: CapturedOut;
beforeEach(() => {
  quiet = capturePlain();
});
afterEach(() => quiet.restore());

/** Answers `/version` reachable and every `/setup/need/<id>` as immediately done — the default tray behind every test below except the one that deliberately drives a real timeout. */
const instantTray = fakeTray({
  "GET /version": () => ({ status: 200, json: {} }),
  "GET /setup/need/services.unregister": () => ({ status: 200, json: { state: "done", detail: "unregistered" } }),
  "GET /setup/need/proxy.remove": () => ({ status: 200, json: { state: "done", detail: "removed" } }),
});

const fakeSecrets: SecretsSeams = {
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
};

const fakeRelay: RelayClient = {
  create: async () => ({ id: "", creatorSecret: "" }),
  fetch: async () => "gone",
  redeem: async () => "already",
  reply: async () => {},
  readReply: async () => "none",
  delete: async () => {},
};

function fakeSecretPresence(): SecretPresence {
  return { async has() { return null; } };
}

const SAMPLE_ACTIONS: UninstallAction[] = [
  { id: "services.unregister", title: "Stop and remove the rt daemon and deck services", kind: "app" },
];

function baseDeps(
  overrides: Partial<Omit<UninstallDeps, "probes">> & { probes?: ReturnType<typeof fakeProbes> } = {},
): Omit<UninstallDeps, "probes"> & { probes: ReturnType<typeof fakeProbes>; lines: string[]; exitCodes: number[]; confirmCalls: string[] } {
  const lines: string[] = [];
  const exitCodes: number[] = [];
  const confirmCalls: string[] = [];
  return {
    probes: fakeProbes({ tray: instantTray }),
    secrets: fakeSecrets,
    relay: fakeRelay,
    secretPresence: fakeSecretPresence(),
    actions: SAMPLE_ACTIONS,
    json: (v) => lines.push(JSON.stringify(v)),
    exit: (code: number) => {
      exitCodes.push(code);
      throw new Error("exit sentinel");
    },
    isTTY: () => false,
    confirm: async (message) => {
      confirmCalls.push(message);
      return true;
    },
    lines,
    exitCodes,
    confirmCalls,
    ...overrides,
  };
}

async function runExpectingExit(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Error && err.message === "exit sentinel") return;
    throw err;
  }
}

describe("rt uninstall — dry-run", () => {
  test("--json --dry-run: prints the contract envelope {contract,at,actions:[{id,title}]}, nothing else, exit 0", async () => {
    const deps = baseDeps();
    await runUninstallCommand(["--json", "--dry-run"], {}, deps);

    expect(deps.lines).toHaveLength(1);
    const payload = JSON.parse(deps.lines[0]!) as { contract: number; actions: { id: string; title: string }[] };
    expect(payload.contract).toBe(1);
    expect(payload.actions).toEqual([{ id: "services.unregister", title: "Stop and remove the rt daemon and deck services" }]);
    expect(deps.exitCodes).toEqual([]);
  });

  test("--dry-run --delete-data with no --yes on a non-TTY: never confirm-required — dry-run is read-only", async () => {
    const deps = baseDeps({ isTTY: () => false });
    await runUninstallCommand(["--json", "--dry-run", "--delete-data"], {}, deps);
    expect(deps.exitCodes).toEqual([]);
    // "read-only" proven, not assumed: no exec, no removal, no write, no
    // tray round-trip — a dry-run that actually removed something would
    // still pass a bare exit-code check, so that check alone is not enough.
    expect(deps.probes.calls.exec).toEqual([]);
    expect(deps.probes.calls.removed).toEqual([]);
    expect(deps.probes.calls.writes).toEqual({});
    expect(deps.probes.calls.tray).toEqual([]);
  });

  test("human --dry-run lists what would go as a changes block", async () => {
    await runUninstallCommand(["--dry-run"], {}, baseDeps());
    expect(quiet.stdout()).toBe("This would remove\n- Stop and remove the rt daemon and deck services\n");
  });
});

describe("rt uninstall — the --delete-data consent gate", () => {
  test("non-TTY, --delete-data, no --yes: exit 2 confirm-required, nothing runs", async () => {
    const deps = baseDeps({ isTTY: () => false });
    await runExpectingExit(() => runUninstallCommand(["--json", "--delete-data"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    const payload = JSON.parse(deps.lines[0]!) as { error: { code: string } };
    expect(payload.error.code).toBe("confirm-required");
  });

  test("non-TTY, --delete-data, --yes: proceeds — the app's own confirmation sheet already gave consent", async () => {
    const deps = baseDeps({ isTTY: () => false });
    await runUninstallCommand(["--json", "--delete-data", "--yes"], {}, deps);
    expect(deps.exitCodes).toEqual([]);
    const events = deps.lines.map((l) => JSON.parse(l) as ApplyEvent);
    expect(events.at(-1)).toMatchObject({ event: "done", ok: true });
  });

  test("non-TTY, --keep-data (default), no --yes: no gate at all", async () => {
    const deps = baseDeps({ isTTY: () => false });
    await runUninstallCommand(["--json"], {}, deps);
    expect(deps.exitCodes).toEqual([]);
  });

  test("TTY, no --yes: confirms before running; a decline runs nothing", async () => {
    const deps = baseDeps({ isTTY: () => true, confirm: async () => false });
    await runUninstallCommand([], {}, deps);
    expect(quiet.stdout()).toContain("This will remove\n- Stop and remove the rt daemon and deck services\n");
  });

  test("TTY, --yes: skips the confirm prompt entirely", async () => {
    const deps = baseDeps({ isTTY: () => true });
    await runUninstallCommand(["--yes"], {}, deps);
    expect(deps.confirmCalls).toEqual([]);
  });

  test("BLOCKER regression: --json --delete-data on a TTY, no --yes: refuses too — neither the refusal nor the prompt used to fire here", async () => {
    const deps = baseDeps({ isTTY: () => true });

    await runExpectingExit(() => runUninstallCommand(["--json", "--delete-data"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    expect(deps.confirmCalls).toEqual([]); // never even reached the prompt
    const payload = JSON.parse(deps.lines[0]!) as { error: { code: string } };
    expect(payload.error.code).toBe("confirm-required");
    // Nothing was ever executed against the machine.
    expect(deps.probes.calls).toEqual({ exec: [], fetch: [], fetchInits: [], tray: [], writes: {}, removed: [], symlinks: {}, modes: {}, renames: [] });
  });

  test("--keep-data and --delete-data together: exit 2, conflicting-data-flags, nothing runs", async () => {
    const deps = baseDeps({ isTTY: () => false });

    await runExpectingExit(() => runUninstallCommand(["--json", "--keep-data", "--delete-data", "--yes"], {}, deps));

    expect(deps.exitCodes).toEqual([2]);
    const payload = JSON.parse(deps.lines[0]!) as { error: { code: string } };
    expect(payload.error.code).toBe("conflicting-data-flags");
    expect(deps.probes.calls.exec).toEqual([]);
  });
});

describe("rt uninstall: takes no app name", () => {
  const cases: { args: string[]; tty: boolean }[] = [
    { args: ["gitq"], tty: false },
    { args: ["gitq"], tty: true },
    { args: ["--json", "gitq"], tty: false },
    { args: ["--yes", "--json", "board"], tty: false },
    { args: ["--dry-run", "--json", "chat"], tty: false },
    { args: ["--keep_data"], tty: true },
  ];

  for (const { args, tty } of cases) {
    test(`${args.join(" ")} (${tty ? "TTY" : "no TTY"}): exit 2, nothing prompted, nothing run`, async () => {
      const deps = baseDeps({ isTTY: () => tty });

      await runExpectingExit(() => runUninstallCommand(args, {}, deps));

      expect(deps.exitCodes).toEqual([2]);
      expect(deps.confirmCalls).toEqual([]);
      expect(deps.lines).toHaveLength(args.includes("--json") ? 1 : 0);
      expect(deps.probes.calls).toEqual({ exec: [], fetch: [], fetchInits: [], tray: [], writes: {}, removed: [], symlinks: {}, modes: {}, renames: [] });
    });
  }

  test("--json: the error envelope carries the code and the stray arguments", async () => {
    const deps = baseDeps();

    await runExpectingExit(() => runUninstallCommand(["--json", "gitq", "extra"], {}, deps));

    const payload = JSON.parse(deps.lines[0]!) as { contract: number; error: { code: string; message: string; args: string[] } };
    expect(payload.contract).toBe(1);
    expect(payload.error.code).toBe("unexpected-args");
    expect(payload.error.args).toEqual(["gitq", "extra"]);
    expect(payload.error.message).toContain("run: deck remove <name> (add --force for a mattstack app");
  });

  test("human mode: a failure block naming the argument, nothing on stdout", async () => {
    const deps = baseDeps();
    await runExpectingExit(() => runUninstallCommand(["gitq"], {}, deps));
    expect(deps.lines).toEqual([]);
    expect(quiet.stdout()).toBe("");
    expect(quiet.stderr()).toMatch(/^\[failed\] [Uu]nexpected argument "gitq"\. /);
  });

  test("the handler accepts exactly the flags the command-tree node declares, and the node declares no positional", () => {
    const declared = TREE.uninstall!.args ?? [];
    expect(declared.every((a) => typeof a.flag === "string")).toBe(true);
    expect(declared.map((a) => a.flag).sort()).toEqual([...UNINSTALL_FLAGS].sort());
  });
});

describe("rt uninstall — stayed", () => {
  test("human mode: '~/.mattstack (kept)' is printed, not silently discarded", async () => {
    const deps = baseDeps({ isTTY: () => false });
    await runUninstallCommand(["--yes"], {}, deps);
    expect(quiet.stdout()).toContain("Kept on this Mac\n[skipped] ~/.mattstack (kept)\n");
  });

  test("a human run draws each action as a step by title and ends in a summary", async () => {
    await runUninstallCommand(["--yes"], {}, baseDeps({ isTTY: () => false }));
    expect(quiet.stdout()).toContain("[ok] Stop and remove the rt daemon and deck services");
    expect(quiet.stdout()).toContain("[ok] mattstack is uninstalled  1 done\n");
  });

  test("--json mode: stayed is never printed as a bare stdout line — the NDJSON stream stays strictly one-object-per-line", async () => {
    const deps = baseDeps({ isTTY: () => false });
    await runUninstallCommand(["--json", "--yes"], {}, deps);
    for (const line of deps.lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(quiet.stdout()).toBe("");
    expect(quiet.stderr()).toBe("");
  });
});

describe("rt uninstall — NDJSON discipline and exit codes", () => {
  test("--json: stdout is plan/step/done for a happy action, exit 0", async () => {
    const deps = baseDeps({ isTTY: () => false });
    await runUninstallCommand(["--json", "--yes"], {}, deps);

    const events = deps.lines.map((l) => JSON.parse(l) as ApplyEvent);
    // services.unregister logs one line (deck not bundled in this fake), then asks the app over the need protocol, before its terminal step event.
    expect(events.map((e) => e.event)).toEqual(["plan", "step", "log", "need", "step", "done"]);
    expect(deps.exitCodes).toEqual([]);
  });

  test("a failed action -> exit 2, the stream already carries the failure", async () => {
    // Reachable (so `need` doesn't take the nonInteractive "no-app" skip
    // path) but never answers the specific need id — times out fast.
    const failingProbes = fakeProbes({
      files: { "/Library/LaunchDaemons/sh.portless.proxy.plist": "<plist/>" },
      tray: fakeTray({
        "GET /version": () => ({ status: 200, json: {} }),
        "GET /setup/need/proxy.remove": () => ({ status: 200, json: { state: "pending" } }),
      }),
    });
    const deps = baseDeps({
      probes: failingProbes,
      isTTY: () => false,
      actions: [{ id: "proxy.remove", title: "x", kind: "privileged" }],
      needOpts: { timeoutMs: 5, pollMs: 1 },
    });

    await runExpectingExit(() => runUninstallCommand(["--json"], {}, deps));
    expect(deps.exitCodes).toEqual([2]);
    const events = deps.lines.map((l) => JSON.parse(l) as ApplyEvent);
    expect(events.at(-1)).toMatchObject({ event: "done", ok: false });
  });

  test("realUninstallDeps() builds without throwing", () => {
    expect(() => realUninstallDeps()).not.toThrow();
  });
});

describe("rt uninstall --json bytes", () => {
  test("the dry-run envelope is one compact line: contract, at, actions of id and title", async () => {
    const deps = baseDeps({ json: realJson });
    await runUninstallCommand(["--json", "--dry-run"], {}, deps);
    const payload = expectOneJsonLine(quiet.stdout()) as { contract: number; at: string; actions: Array<Record<string, unknown>> };
    expect(Object.keys(payload)).toEqual(["contract", "at", "actions"]);
    expect(payload.at).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.actions.map((a) => [a.id, Object.keys(a)])).toEqual([["services.unregister", ["id", "title"]]]);
  });
});
