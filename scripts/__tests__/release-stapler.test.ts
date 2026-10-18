import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const STAPLER = join(import.meta.dir, "..", "release", "stapler.sh");

const NETWORK_LOST = [
  'error is Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."',
  "CloudKit's response is inconsistent with expections: (null)",
  "The validate action failed! Error 68.",
].join("\n");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stapler-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// A fake xcrun whose Nth call prints the Nth scripted reply and exits with it.
function fakeXcrun(replies: { out: string; rc: number }[]): void {
  replies.forEach((r, i) => writeFileSync(join(dir, `reply.${i + 1}`), `${r.rc}\n${r.out}\n`));
  writeFileSync(
    join(dir, "xcrun"),
    `#!/bin/bash
n=$(( $(cat "${dir}/calls" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "${dir}/calls"
echo "$*" >> "${dir}/args"
f="${dir}/reply.$n"
[ -f "$f" ] || f="${dir}/reply.${replies.length}"
rc=$(head -1 "$f")
tail -n +2 "$f" >&2
exit "$rc"
`,
  );
  chmodSync(join(dir, "xcrun"), 0o755);
}

function run(action: string): { status: number | null; stderr: string; calls: number } {
  const r = spawnSync("bash", [STAPLER, action, "/tmp/target.app"], {
    env: { PATH: `${dir}:/usr/bin:/bin`, STAPLER_RETRY_WAIT: "0" },
    encoding: "utf8",
  });
  const calls = existsSync(join(dir, "calls")) ? Number(readFileSync(join(dir, "calls"), "utf8").trim()) : 0;
  return { status: r.status, stderr: r.stderr, calls };
}

describe("scripts/release/stapler.sh", () => {
  test("a first success runs stapler once", () => {
    fakeXcrun([{ out: "The validate action worked!", rc: 0 }]);
    const r = run("validate");
    expect(r.status).toBe(0);
    expect(r.calls).toBe(1);
    expect(readFileSync(join(dir, "args"), "utf8").trim()).toBe("stapler validate /tmp/target.app");
  });

  test("a lost CloudKit connection is retried until stapler succeeds", () => {
    fakeXcrun([
      { out: NETWORK_LOST, rc: 68 },
      { out: NETWORK_LOST, rc: 68 },
      { out: "The staple and validate action worked!", rc: 0 },
    ]);
    const r = run("staple");
    expect(r.status).toBe(0);
    expect(r.calls).toBe(3);
  });

  test("a network failure on every try gives up after 4 and prints Apple's error", () => {
    fakeXcrun([{ out: NETWORK_LOST, rc: 68 }]);
    const r = run("validate");
    expect(r.status).toBe(68);
    expect(r.calls).toBe(4);
    expect(r.stderr).toContain("NSURLErrorDomain Code=-1005");
    expect(r.stderr).toContain("gave up after 4 tries");
  });

  test("a failure that is not the network fails at once", () => {
    fakeXcrun([{ out: "mattstack.app does not have a ticket stapled to it.\nThe validate action failed! Error 65.", rc: 65 }]);
    const r = run("validate");
    expect(r.status).toBe(65);
    expect(r.calls).toBe(1);
    expect(r.stderr).toContain("does not have a ticket stapled");
  });

  test("a network error that is not a dropped or refused connection fails at once", () => {
    fakeXcrun([{ out: 'error is Error Domain=NSURLErrorDomain Code=-1202 "The certificate for this server is invalid."\nThe validate action failed! Error 68.', rc: 68 }]);
    const r = run("validate");
    expect(r.status).toBe(68);
    expect(r.calls).toBe(1);
  });

  test("an unknown action is refused", () => {
    fakeXcrun([{ out: "", rc: 0 }]);
    const r = run("remove");
    expect(r.status).toBe(2);
    expect(r.calls).toBe(0);
  });
});
