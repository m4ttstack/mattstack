import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

setDefaultTimeout(30_000);

const APPROVE = join(import.meta.dir, "..", "..", "host", "approve-join.sh");
const JOINER = "age1joinerkey0000000000000000000000000000000000000000000000000";
const OWNER = "age1ownerkey00000000000000000000000000000000000000000000000000";

// A stand-in rt: members sync adds the keys named in $HOME/../sync-adds to the
// clone's .sops.yaml and reports them; publish reports a push.
const STUB_RT = `#!/bin/bash
echo "rt $*" >> "$HOME/rt-calls"
case "$1 $2 $3" in
  "team members sync")
    env > "$HOME/rt-env"
    sops="$HOME/.mattstack/orgs/vmtest/.sops.yaml"
    mkdir -p "$(dirname "$sops")"
    adds=$(cat "$HOME/../sync-adds" 2>/dev/null)
    handles=$(cat "$HOME/../sync-handles" 2>/dev/null)
    printf 'creation_rules:\\n  - age: %s\\n' "$(printf '%s' "$adds" | tr ' ' ',')" > "$sops"
    keys=$(printf '%s' "$adds" | awk '{for(i=1;i<=NF;i++) printf "%s\\"%s\\"", (i>1?",":""), $i}')
    hs=$(printf '%s' "$handles" | awk '{for(i=1;i<=NF;i++) printf "%s\\"%s\\"", (i>1?",":""), $i}')
    echo "{\\"contract\\":1,\\"added\\":[$keys],\\"addedHandles\\":[$hs],\\"pending\\":[]}";;
esac
case "$1 $2" in
  "team publish") echo '{"contract":1,"pushed":true}';;
esac
`;

interface Run { home: string; code: number; stderr: string }

function approve(opts: { adds?: string; handles?: string; key?: string | null; home?: string; shim?: boolean } = {}): Run {
  const root = mkdtempSync(join(tmpdir(), "approve-join-"));
  const home = opts.home ?? join(root, "vm-mint.abc123");
  mkdirSync(join(home, "bin"), { recursive: true });
  if (opts.shim !== false) {
    writeFileSync(join(home, "bin", "security"), "#!/bin/bash\n");
    chmodSync(join(home, "bin", "security"), 0o755);
  }
  writeFileSync(join(root, "sync-adds"), opts.adds ?? `${OWNER} ${JOINER}`);
  writeFileSync(join(root, "sync-handles"), opts.handles ?? "vmtest-joiner");
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "rt"), STUB_RT);
  chmodSync(join(bin, "rt"), 0o755);
  const key = opts.key === undefined ? JOINER : opts.key;
  const args = ["--rt", join(bin, "rt"), "--home", home, "--slug", "vmtest", ...(key ? ["--key", key] : [])];
  const r = Bun.spawnSync(["/bin/bash", APPROVE, ...args], {
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: join(root, "operator-home"), VM_MINT_TOKEN: "test-token", OPERATOR_ONLY: "must-not-reach-rt" },
  });
  return { home, code: r.exitCode ?? -1, stderr: r.stderr.toString() };
}

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const calls = (home: string) => read(join(home, "rt-calls")).trim().split("\n").filter(Boolean);

describe("approve-join.sh", () => {
  test("syncs members, then publishes, under the throwaway HOME", () => {
    const r = approve();
    expect(r.code).toBe(0);
    expect(calls(r.home)).toEqual(["rt team members sync --team vmtest --json", "rt team publish --team vmtest --json"]);
    const env = read(join(r.home, "rt-env"));
    expect(env).toContain(`HOME=${r.home}\n`);
    expect(env).not.toContain("OPERATOR_ONLY");
  });

  test("fails, and publishes nothing, when the joiner's key is not a recipient afterwards", () => {
    const r = approve({ adds: OWNER, handles: "" });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(JOINER);
    expect(calls(r.home)).toEqual(["rt team members sync --team vmtest --json"]);
  });

  test("without --key, a sync that added no joiner fails", () => {
    const r = approve({ adds: OWNER, handles: "", key: null });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("no joiner");
  });

  test("without --key, every key the sync added must be a recipient", () => {
    const r = approve({ key: null });
    expect(r.code).toBe(0);
  });

  test("refuses a HOME that is not a vm-mint.* directory, before any rt call", () => {
    const root = mkdtempSync(join(tmpdir(), "approve-join-"));
    const r = approve({ home: join(root, "real-home") });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("not a vm-mint.* directory");
    expect(calls(r.home)).toEqual([]);
  });

  test("refuses a HOME the mint never ran in", () => {
    const r = approve({ shim: false });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("mint-invite.sh");
    expect(calls(r.home)).toEqual([]);
  });
});
