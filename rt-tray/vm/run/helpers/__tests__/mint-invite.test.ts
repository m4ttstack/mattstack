import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const MINT = join(import.meta.dir, "..", "..", "host", "mint-invite.sh");
const CODE = "SECRET-CODE-4242";

// A stand-in rt: it records how it was called and what it could see from
// inside the throwaway HOME, and answers the three verbs the way rt does.
const STUB_RT = `#!/bin/bash
echo "rt $*" >> "$HOME/rt-calls"
case "$1 $2" in
  "team create")
    env > "$HOME/rt-env"
    security add-generic-password -a mattstack -s mattstack-age-key -w AGE-SECRET-KEY-1STUB
    security find-generic-password -a mattstack -s mattstack-age-key -w > "$HOME/rt-found"
    security list-keychains >/dev/null 2>&1 && : > "$HOME/rt-keychain-leak"
    security find-generic-password -a mattstack -s github-token -w > /dev/null 2>&1; echo $? > "$HOME/rt-other-find"
    security add-generic-password -a mattstack -s github-token -w ghp_other > /dev/null 2>&1; echo $? > "$HOME/rt-other-add"
    printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill > "$HOME/rt-cred" 2>&1
    echo '{"contract":1,"slug":"vmtest","created":true}';;
  "team publish") echo '{"contract":1,"pushed":true}';;
  "team invite")
    [ -e "$HOME/../invite-fails" ] && { echo '{"error":{"code":"relay-down","message":"the invite relay answered 503"}}'; exit 2; }
    echo "reminder: share the code privately" >&2
    echo '{"contract":1,"code":"${CODE}","link":"https://mattstack.dev/join#${CODE}","pasteBlock":"paste ${CODE}","forgeAccess":"skipped","expiresAt":"2026-10-06T00:00:00Z"}';;
esac
`;

interface Mint { root: string; home: string; out: string; runDir: string; code: number; stderr: string }

function mint(opts: { args?: string[]; home?: string; invite?: "ok" | "fails"; token?: string; seedHome?: boolean } = {}): Mint {
  const root = mkdtempSync(join(tmpdir(), "mint-invite-"));
  const home = opts.home ?? join(root, "vm-mint.abc123");
  mkdirSync(home, { recursive: true });
  if (opts.seedHome) writeFileSync(join(home, "stray"), "");
  const runDir = join(root, "run");
  mkdirSync(join(runDir, "logs"), { recursive: true });
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "rt"), STUB_RT);
  chmodSync(join(bin, "rt"), 0o755);
  writeFileSync(join(bin, "gh"), `#!/bin/bash\n[ "$1 $2" = "api user" ] && [ "$GH_TOKEN" = test-token ] && echo vmtest-joiner\n`);
  chmodSync(join(bin, "gh"), 0o755);
  if (opts.invite === "fails") writeFileSync(join(home, "..", "invite-fails"), "");
  const out = join(runDir, "mint", "invite-code.txt");
  const args = opts.args ?? ["--rt", join(bin, "rt"), "--home", home, "--remote", "https://github.com/mattstack-vmtest/mattstack-vmtest-team-1.git", "--out", out];
  const r = Bun.spawnSync(["/bin/bash", MINT, ...args], {
    env: {
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: join(root, "operator-home"),
      VM_RUN_DIR: runDir,
      OPERATOR_ONLY: "must-not-reach-rt",
      ...(opts.token === undefined ? { VM_MINT_TOKEN: "test-token" } : opts.token ? { VM_MINT_TOKEN: opts.token } : {}),
    },
  });
  return { root, home, out, runDir, code: r.exitCode ?? -1, stderr: r.stderr.toString() };
}

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

describe("mint-invite.sh", () => {
  test("scaffolds, publishes and invites in order, under the throwaway HOME", () => {
    const m = mint();
    expect(m.code).toBe(0);
    expect(read(join(m.home, "rt-calls")).trim().split("\n")).toEqual([
      "rt team create vmtest --remote https://github.com/mattstack-vmtest/mattstack-vmtest-team-1.git --others --json",
      "rt team publish --team vmtest --json",
      "rt team invite --handle vmtest-joiner --team vmtest --json",
    ]);
    const env = read(join(m.home, "rt-env"));
    expect(env).toContain(`HOME=${m.home}\n`);
    expect(env).toContain("RT_BATCH=1\n");
    expect(env).not.toContain("OPERATOR_ONLY");
    expect(env).not.toContain("VM_RUN_DIR");
  });

  test("the code lands in --out, 0600, and nowhere in the log", () => {
    const m = mint();
    expect(read(m.out).trim()).toBe(CODE);
    expect(statSync(m.out).mode & 0o777).toBe(0o600);
    const log = read(join(m.runDir, "logs", "mint.log"));
    expect(log).toContain('"forgeAccess":"skipped"');
    expect(log).toContain("reminder: share the code privately");
    expect(log).not.toContain(CODE);
    expect(m.stderr).not.toContain(CODE);
  });

  test("the age key goes to a file in the throwaway HOME, never the keychain", () => {
    const m = mint();
    expect(read(join(m.home, "rt-found"))).toBe("AGE-SECRET-KEY-1STUB");
    expect(statSync(join(m.home, ".vm-keychain", "mattstack-age-key")).mode & 0o777).toBe(0o600);
    expect(existsSync(join(m.home, "rt-keychain-leak"))).toBe(false);
  });

  test("the stand-in keychain answers only for the age key's service", () => {
    const m = mint();
    expect(read(join(m.home, "rt-other-find")).trim()).toBe("44");
    expect(read(join(m.home, "rt-other-add")).trim()).not.toBe("0");
    expect(read(join(m.home, ".vm-keychain", "mattstack-age-key"))).toBe("AGE-SECRET-KEY-1STUB");
  });

  test("git gets the token from a credential helper, not from argv", () => {
    const m = mint();
    const cred = read(join(m.home, "rt-cred"));
    expect(cred).toContain("username=x-access-token");
    expect(cred).toContain("password=test-token");
    expect(read(join(m.home, "rt-calls"))).not.toContain("test-token");
  });

  test("a gitlab remote authenticates as oauth2", () => {
    const m = mint({ args: [] });
    const bin = join(m.root, "bin", "rt");
    const home = join(m.root, "vm-mint.gl");
    mkdirSync(home);
    const r = Bun.spawnSync(["/bin/bash", MINT, "--rt", bin, "--home", home, "--remote", "https://gitlab.com/g/mattstack-vmtest-team-1.git", "--out", m.out, "--handle", "joiner"], {
      env: { PATH: `${join(m.root, "bin")}:/usr/bin:/bin`, VM_RUN_DIR: m.runDir, VM_MINT_TOKEN: "test-token" },
    });
    expect(r.exitCode).toBe(0);
    expect(read(join(home, "rt-cred"))).toContain("username=oauth2");
  });

  test("a refused invite fails with rt's message and writes no code", () => {
    const m = mint({ invite: "fails" });
    expect(m.code).not.toBe(0);
    expect(m.stderr).toContain("rt team invite failed (exit 2): the invite relay answered 503");
    expect(existsSync(m.out)).toBe(false);
  });

  test("refuses a HOME the harness did not make", () => {
    const m = mint({ home: join(tmpdir(), `mint-invite-real-${process.pid}`) });
    expect(m.code).not.toBe(0);
    expect(m.stderr).toContain("not a vm-mint.* directory");
    expect(existsSync(join(m.home, "rt-calls"))).toBe(false);
  });

  test("refuses a HOME that is not empty", () => {
    const m = mint({ seedHome: true });
    expect(m.code).not.toBe(0);
    expect(m.stderr).toContain("not empty");
  });

  test("refuses to run without a token", () => {
    const m = mint({ token: "" });
    expect(m.code).not.toBe(0);
    expect(m.stderr).toContain("VM_MINT_TOKEN is empty");
    expect(existsSync(join(m.home, "rt-calls"))).toBe(false);
  });
});
