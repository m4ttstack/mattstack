import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

setDefaultTimeout(30_000);

const SCRIPT = join(import.meta.dir, "..", "..", "guest", "install-chrome.sh");
const ID = "abcdefghijklmnopabcdefghijklmnop";
const UPDATE = "https://update.example.invalid/crx";

// curl writes a stand-in dmg; hdiutil attach makes a mount holding a Chrome
// app; sudo and chown run in place (sudo just runs its command); open lands
// the extension in the tester's Chrome profile unless told not to.
const STUBS: Record<string, string> = {
  curl: `#!/bin/bash\necho "curl $*" >> "$CALLS"\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && { : > "$2"; }; shift; done\n`,
  hdiutil: `#!/bin/bash\necho "hdiutil $*" >> "$CALLS"\nif [ "$1" = attach ]; then while [ $# -gt 0 ]; do [ "$1" = -mountpoint ] && { mkdir -p "$2/Google Chrome.app/Contents"; echo stub > "$2/Google Chrome.app/Contents/Info.plist"; }; shift; done; fi\n`,
  sudo: `#!/bin/bash\necho "sudo $*" >> "$CALLS"\n"$@"\n`,
  chown: `#!/bin/bash\necho "chown $*" >> "$CALLS"\n`,
  open: `#!/bin/bash\necho "open $*" >> "$CALLS"\n[ -e "$HOME/no-extension" ] || mkdir -p "$HOME/Library/Application Support/Google/Chrome/Default/Extensions/${ID}/1.0_0"\n`,
  sleep: `#!/bin/bash\n:\n`,
};

interface Run { root: string; calls: string[]; code: number; stderr: string }

function run(args: string[], opts: { noExtension?: boolean } = {}): Run {
  const root = mkdtempSync(join(tmpdir(), "install-chrome-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const home = join(root, "home");
  mkdirSync(home);
  if (opts.noExtension) writeFileSync(join(home, "no-extension"), "");
  if (args[0] === "open") mkdirSync(join(root, "root", "Applications", "Google Chrome.app"), { recursive: true });
  const share = join(root, "share");
  mkdirSync(join(share, "logs"), { recursive: true });
  const calls = join(root, "calls");
  const r = Bun.spawnSync(["/bin/bash", SCRIPT, ...args], {
    env: { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, CALLS: calls, GUEST_RUN: share, CHROME_ROOT: join(root, "root"), CHROME_WAIT_S: "3" },
  });
  return { root, calls: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [], code: r.exitCode ?? -1, stderr: r.stderr.toString() };
}

describe("install-chrome.sh", () => {
  test("install copies Chrome into Applications and force-installs the extension by policy", () => {
    const r = run(["install", ID, UPDATE]);
    expect(r.code).toBe(0);
    expect(existsSync(join(r.root, "root", "Applications", "Google Chrome.app", "Contents", "Info.plist"))).toBe(true);
    const plist = join(r.root, "root", "Library", "Managed Preferences", "com.google.Chrome.plist");
    const read = Bun.spawnSync(["/usr/bin/defaults", "read", plist, "ExtensionInstallForcelist"]).stdout.toString();
    expect(read).toContain(`${ID};${UPDATE}`);
    expect(r.calls.some((c) => c.startsWith("sudo defaults write") && c.includes("ExtensionInstallForcelist"))).toBe(true);
    expect(r.calls.some((c) => c.startsWith("hdiutil detach"))).toBe(true);
  });

  test("install refuses an extension id that is not 32 letters a-p", () => {
    const r = run(["install", "not-an-id", UPDATE]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("extension id");
    expect(r.calls).toEqual([]);
  });

  test("open starts Chrome once and waits for the extension in the profile", () => {
    const r = run(["open", ID]);
    expect(r.code).toBe(0);
    expect(r.calls[0]).toContain("Google Chrome.app");
  });

  test("open fails, naming the extension, when it never lands", () => {
    const r = run(["open", ID], { noExtension: true });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(ID);
  });

  test("usage", () => {
    const r = run([]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("usage: install-chrome.sh");
  });
});
