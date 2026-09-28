import { describe, expect, test } from "bun:test";
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const WALK = join(import.meta.dir, "..", "..", "walkthrough.sh");
const RUN_MS = 90_000;

type Screens = "hang" | "drop";

interface World {
  root: string;
  art: string;
  calls: string;
  marker: string;
  args: string[];
  env: Record<string, string>;
}

// A host with no VM: tart, ssh, sshpass, gh and glab are stubs that answer
// from files under root and append every call to root/calls. The guest driver
// either hangs (a child sleeping on a marker duration, so a leak is findable)
// or exits 255 the way ssh does when its keepalives give up. `tart run` notes
// any signal it receives: under a real terminal that stops the guest.
function world(opts: {
  screens: Screens;
  ghDelete?: "ok" | "refuse";
  forge?: "github" | "gitlab";
  cloneFails?: boolean;
  slowCreate?: boolean;
  env?: Record<string, string>;
}): World {
  const root = mkdtempSync(join(tmpdir(), "walkthrough-"));
  const bin = join(root, "bin");
  const art = join(root, "art");
  const calls = join(root, "calls");
  const marker = String(3000 + Math.floor(Math.random() * 999));
  for (const d of [bin, art, join(root, "home"), join(root, "tart")]) mkdirSync(d, { recursive: true });
  writeFileSync(join(root, "key"), "private");
  writeFileSync(join(root, "key.pub"), "ssh-ed25519 AAAA test");
  writeFileSync(join(root, "x.dmg"), "");
  writeFileSync(join(root, "screens"), opts.screens);
  writeFileSync(join(root, "gh-delete"), opts.ghDelete ?? "ok");
  if (opts.cloneFails) writeFileSync(join(root, "clone-fails"), "");
  if (opts.slowCreate) writeFileSync(join(root, "slow-create"), "");
  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/bash\nROOT="${root}"\n${body}`);
    chmodSync(join(bin, name), 0o755);
  };
  stub("tart", `echo "tart $*" >> "$ROOT/calls"
S="$ROOT/tart"
case "$1" in
  list) echo "Source Name Disk Size State"; echo "local mattstack-golden-26 50 20 stopped"
        for f in "$S"/vm-*; do [ -e "$f" ] && echo "local \${f##*/vm-} 50 20 running"; done; true;;
  clone) [ -e "$ROOT/clone-fails" ] && exit 1; : > "$S/vm-$3";;
  run) trap 'echo "tart run signalled" >> "$ROOT/calls"; exit 1' INT TERM HUP
       while [ -e "$S/vm-$2" ] && [ ! -e "$S/stopped-$2" ]; do sleep 0.2; done;;
  ip) echo 127.0.0.1;;
  stop) : > "$S/stopped-$2";;
  delete) rm -f "$S/vm-$2";;
esac
`);
  stub("ssh", `echo "ssh $*" >> "$ROOT/calls"
for a; do last="$a"; done
case "$last" in
  *drive-setup.sh*)
    printf '%s\\n' "19:36:56 clicked setup.checklist.row.account.github.action" "19:37:13 filled setup.checklist.connect.field.token" >> "$VM_RUN_DIR/logs/drive.log"
    case "$(cat "$ROOT/screens")" in
      hang) sleep ${marker} & echo $! > "$ROOT/driver.pid"; wait;;
      drop) echo "Timeout, server 127.0.0.1 not responding." >&2; exit 255;;
    esac;;
esac
exit 0
`);
  stub("sshpass", `echo "sshpass $*" >> "$ROOT/calls"\nexit 0\n`);
  stub("hdiutil", "exit 1\n");
  stub("gh", `echo "gh $*" >> "$ROOT/calls"
case "$1 $2" in
  "repo create") : > "$ROOT/creating"; [ -e "$ROOT/slow-create" ] && sleep 1.5;;
  "repo delete") [ "$(cat "$ROOT/gh-delete")" = ok ] || { echo "HTTP 403: Must have admin rights to Repository." >&2; exit 1; };;
esac
exit 0
`);
  stub("glab", `echo "glab $*" >> "$ROOT/calls"\nexit 0\n`);
  const forge = opts.forge ?? "github";
  return {
    root, art, calls, marker,
    args: ["--ver", "26", "--dmg", join(root, "x.dmg"), "--scenario", "create", "--fresh-team-repo", "--no-graphics", "--forge", forge],
    env: {
      HOME: join(root, "home"),
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      VM_ARTIFACTS: art,
      VM_SSH_KEY: join(root, "key"),
      MATTSTACK_VMTEST_PAT: "test-token",
      MATTSTACK_VMTEST_GITLAB_GROUP: "vmtest-group",
      ...opts.env,
    },
  };
}

interface Phase { phase: string; status: string; reason: string; seconds: number }

function runDir(w: World): string {
  const runs = readdirSync(w.art);
  const [run] = runs;
  if (runs.length !== 1 || !run) throw new Error(`expected one run dir, got ${runs.join(", ")}`);
  return join(w.art, run);
}
const ledger = (w: World): Phase[] =>
  readFileSync(join(runDir(w), "phases.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const phase = (w: World, name: string) => ledger(w).find((p) => p.phase === name);
const calls = (w: World) => (existsSync(w.calls) ? readFileSync(w.calls, "utf8") : "");
const leftoverGuests = (w: World) => readdirSync(join(w.root, "tart")).filter((f) => f.startsWith("vm-mattstack-run-"));
const driverAlive = (w: World) => Bun.spawnSync(["pgrep", "-f", `sleep ${w.marker}`]).exitCode === 0;

interface WalkOpts {
  signal?: "SIGTERM" | "SIGINT";
  // driver: once the screens driver hangs; creating: once the repo create starts.
  when?: "driver" | "creating";
  // The whole process group, as a terminal's Ctrl-C does, or only bash's pid.
  group?: boolean;
  // The output reader dies first, as `| tee` does under the same Ctrl-C.
  deadReader?: boolean;
}

async function walk(w: World, o: WalkOpts = {}): Promise<{ code: number; out: string; ms: number }> {
  const started = Date.now();
  const pidFile = join(w.root, "walk.pid");
  // A job-control wrapper makes walkthrough.sh lead its own process group, as
  // a terminal would, so a signal can reach the group without reaching bun.
  // The wrapper's own job notices go nowhere: the dead-reader case must see
  // walkthrough.sh's exit, not the wrapper's SIGPIPE.
  const argv = ["/bin/bash", "-c", 'set -m; /bin/bash "$@" & echo $! > "$0"; exec 2>/dev/null; wait $!', pidFile, WALK, ...w.args];
  let reader: ReturnType<typeof Bun.spawn> | undefined;
  let fd: number | undefined;
  if (o.deadReader) {
    const fifo = join(w.root, "out.fifo");
    Bun.spawnSync(["mkfifo", fifo]);
    reader = Bun.spawn(["cat", fifo], { stdout: "ignore" });
    fd = openSync(fifo, "w");
  }
  const p = Bun.spawn(argv, { env: w.env, stdout: fd ?? "pipe", stderr: fd ?? "pipe" });
  if (fd !== undefined) closeSync(fd);
  if (o.signal) {
    const mark = join(w.root, o.when === "creating" ? "creating" : "driver.pid");
    while (!(existsSync(mark) && existsSync(pidFile)) && Date.now() - started < 30_000) await Bun.sleep(50);
    if (reader) {
      reader.kill("SIGKILL");
      await reader.exited;
    }
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    process.kill(o.group ? -pid : pid, o.signal);
  }
  const code = await p.exited;
  const out = fd === undefined ? (await new Response(p.stdout as ReadableStream).text()) + (await new Response(p.stderr as ReadableStream).text()) : "";
  return { code, out, ms: Date.now() - started };
}

function expectTornDown(w: World) {
  const teardown = phase(w, "teardown");
  expect(teardown?.status).toBe("pass");
  expect(calls(w)).toMatch(/tart stop mattstack-run-26-\d{6}-\d+/);
  expect(calls(w)).toMatch(/tart delete mattstack-run-26-\d{6}-\d+/);
  expect(calls(w)).not.toContain("tart run signalled");
  expect(leftoverGuests(w)).toEqual([]);
  expect(driverAlive(w)).toBe(false);
}

describe("walkthrough.sh ends a cut phase and still tears down", () => {
  test("a screens phase past its limit fails with the phase, elapsed time and the driver's last lines", async () => {
    const w = world({ screens: "hang", env: { VM_PHASE_LIMIT_SCREENS: "2" } });
    const { code, out, ms } = await walk(w);
    expect(code).toBe(1);
    expect(ms).toBeLessThan(60_000);
    const screens = phase(w, "screens");
    expect(screens?.status).toBe("fail");
    expect(screens?.reason).toMatch(/^screens timed out after \d+s \(limit 2s\); last lines of logs\/drive\.log: .*filled setup\.checklist\.connect\.field\.token$/);
    expect(readFileSync(join(runDir(w), "report.md"), "utf8")).toContain("screens timed out after");
    expectTornDown(w);
    expect(calls(w)).toMatch(/gh repo delete mattstack-vmtest\/mattstack-vmtest-team-\d{8}-\d{6}-\d+ --yes/);
    expect(out).toContain("1 failed");
  }, RUN_MS);

  test("a dropped ssh session fails the phase as a drop, not a driver verdict", async () => {
    const w = world({ screens: "drop" });
    const { code } = await walk(w);
    expect(code).toBe(1);
    const screens = phase(w, "screens");
    expect(screens?.status).toBe("fail");
    expect(screens?.reason).toMatch(/^ssh to the guest failed or dropped after \d+s in screens \(exit 255\); last lines of logs\/drive\.log: /);
    expectTornDown(w);
    expect(calls(w)).toContain("gh repo delete mattstack-vmtest/mattstack-vmtest-team-");
  }, RUN_MS);

  test("every guest ssh, keyed or password, carries keepalives", async () => {
    const w = world({ screens: "drop" });
    await walk(w);
    const sshCalls = calls(w).split("\n").filter((l) => /^(ssh|sshpass) /.test(l));
    expect(sshCalls.length).toBeGreaterThan(5);
    for (const l of sshCalls) {
      expect(l).toContain("-o ServerAliveInterval=10");
      expect(l).toContain("-o ServerAliveCountMax=3");
    }
  }, RUN_MS);

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    test(`${signal} to the process group mid-screens ledgers the phase and runs teardown`, async () => {
      const w = world({ screens: "hang" });
      const { code, out, ms } = await walk(w, { signal, group: true });
      expect(code).toBe(1);
      expect(ms).toBeLessThan(60_000);
      // The trap fires inside a call redirected to screens.log; the operator
      // must still see the teardown, not find it in a phase log.
      expect(out).toContain(`caught ${signal}; tearing down`);
      expect(out).toContain("1 failed");
      expect(phase(w, "screens")?.reason).toMatch(new RegExp(`^interrupted by ${signal} after \\d+s$`));
      expect(phase(w, "assert")).toBeUndefined();
      expectTornDown(w);
      expect(calls(w)).toContain("gh repo delete mattstack-vmtest/mattstack-vmtest-team-");
    }, RUN_MS);
  }

  test("a signal after the output reader died still tears down, logging to teardown.log", async () => {
    const w = world({ screens: "hang" });
    const { code, ms } = await walk(w, { signal: "SIGTERM", group: true, deadReader: true });
    expect(code).toBe(1);
    expect(ms).toBeLessThan(60_000);
    expect(phase(w, "screens")?.reason).toMatch(/^interrupted by SIGTERM after \d+s$/);
    expectTornDown(w);
    expect(calls(w)).toContain("gh repo delete mattstack-vmtest/mattstack-vmtest-team-");
    expect(readFileSync(join(runDir(w), "logs", "teardown.log"), "utf8")).toContain("caught SIGTERM; tearing down");
  }, RUN_MS);

  test("a signal while the fresh repo is being created still deletes it", async () => {
    const w = world({ screens: "drop", slowCreate: true });
    const { code } = await walk(w, { signal: "SIGTERM", when: "creating" });
    expect(code).toBe(1);
    expect(phase(w, "preflight")?.reason).toMatch(/^interrupted by SIGTERM after \d+s$/);
    expect(calls(w)).toMatch(/gh repo delete mattstack-vmtest\/mattstack-vmtest-team-\S+ --yes/);
    expect(phase(w, "teardown")?.status).toBe("pass");
  }, RUN_MS);

  test("a failed clone tears down no guest but still deletes the repo", async () => {
    const w = world({ screens: "drop", cloneFails: true });
    const { code } = await walk(w);
    expect(code).toBe(1);
    expect(phase(w, "clone")?.status).toBe("fail");
    expect(calls(w)).not.toMatch(/tart (ip|stop|delete) /);
    expect(calls(w)).toContain("gh repo delete mattstack-vmtest/mattstack-vmtest-team-");
    expect(phase(w, "teardown")?.status).toBe("pass");
  }, RUN_MS);

  test("a token that cannot delete the fresh repo archives it and says so", async () => {
    const w = world({ screens: "drop", ghDelete: "refuse" });
    await walk(w);
    expect(calls(w)).toMatch(/gh repo archive mattstack-vmtest\/mattstack-vmtest-team-\S+ --yes/);
    const teardown = phase(w, "teardown");
    expect(teardown?.status).toBe("pass");
    expect(teardown?.reason).toMatch(/archived, not deleted/);
  }, RUN_MS);

  test("a gitlab fresh repo is deleted through glab", async () => {
    const w = world({ screens: "drop", forge: "gitlab" });
    await walk(w);
    expect(calls(w)).toMatch(/glab repo delete vmtest-group\/mattstack-vmtest-team-\S+ --yes/);
    expectTornDown(w);
  }, RUN_MS);

  test("--keep leaves the guest and its team repo for diagnosis", async () => {
    const w = world({ screens: "drop" });
    w.args.push("--keep");
    await walk(w);
    expect(calls(w)).not.toContain("tart delete");
    expect(calls(w)).not.toContain("gh repo delete");
    expect(phase(w, "teardown")?.reason).toContain("--keep");
    Bun.spawnSync(["pkill", "-f", `${w.root}/bin/tart run`]);
  }, RUN_MS);
});
