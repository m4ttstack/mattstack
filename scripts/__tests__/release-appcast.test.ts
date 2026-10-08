import { describe, test, expect } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import {
  mkdtempSync, mkdirSync, rmSync, copyFileSync, writeFileSync,
  chmodSync, existsSync, readFileSync, readdirSync, symlinkSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";

// This suite proves appcast.sh's signing wiring end to end, offline, without
// ever touching the Keychain: a throwaway EdDSA key is derived purely from
// `openssl genpkey`, no `generate_keys` involved. It does NOT prove the
// production SPARKLE_ED_KEY works — a Keychain-issued key can only be
// exercised at a real tagged release.

const ROOT = join(import.meta.dir, "..", "..");
const SPARKLE_BIN = join(ROOT, "rt-tray", "deps", "tools", "sparkle", "bin");
const GEN = join(SPARKLE_BIN, "generate_appcast");
const SIGN = join(SPARKLE_BIN, "sign_update");
const MAKE_ZIP = join(ROOT, "scripts", "release", "make-zip.sh");
const RELEASE_SCRIPTS = join(ROOT, "scripts", "release");

const HAVE_SPARKLE = existsSync(GEN) && existsSync(SIGN);
if (!HAVE_SPARKLE) {
  console.warn(`release-appcast.test.ts: skipped — ${GEN} missing (run scripts/fetch-deps.sh)`);
}

// Pulls a labelled hex block ("priv:" / "pub:") out of `openssl pkey -text`
// output, e.g.:
//   priv:
//       3c:91:...:
//       ...
//   pub:
function extractHexBlock(text: string, label: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === label);
  if (start === -1) throw new Error(`openssl -text output missing "${label}" block`);
  const hex: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!/^\s+[0-9a-f:]+$/.test(line)) break;
    hex.push(line);
  }
  return hex.join("").replace(/[:\s]/g, "");
}

// Derives a throwaway Sparkle-compatible EdDSA key entirely offline: a raw
// ed25519 keypair from `openssl genpkey`, expanded to the 96-byte
// a‖prefix‖pub form generate_appcast/sign_update require (a = clamp(SHA512(seed)[0:32]),
// prefix = SHA512(seed)[32:64]) — never touches the Keychain or `generate_keys`.
function deriveThrowawayKey(workdir: string): { sparkleEdKey: string; publicKeyB64: string } {
  const privPem = join(workdir, "priv.pem");
  const pubPem = join(workdir, "pub.pem");
  execFileSync("openssl", ["genpkey", "-algorithm", "ed25519", "-out", privPem]);
  execFileSync("openssl", ["pkey", "-in", privPem, "-pubout", "-out", pubPem]);
  const privText = execFileSync("openssl", ["pkey", "-in", privPem, "-text", "-noout"]).toString();
  const pubText = execFileSync("openssl", ["pkey", "-in", pubPem, "-pubin", "-text", "-noout"]).toString();

  const seed = Buffer.from(extractHexBlock(privText, "priv:"), "hex");
  const pub = Buffer.from(extractHexBlock(pubText, "pub:"), "hex");
  expect(seed.length).toBe(32);
  expect(pub.length).toBe(32);

  const h = createHash("sha512").update(seed).digest();
  const a = Buffer.from(h.subarray(0, 32));
  a[0] = (a[0] ?? 0) & 248;
  a[31] = ((a[31] ?? 0) & 127) | 64;
  const prefix = h.subarray(32, 64);

  return {
    sparkleEdKey: Buffer.concat([a, prefix, pub]).toString("base64"),
    publicKeyB64: pub.toString("base64"),
  };
}

const minimalPlist = (version: string, build: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>mattstack-fixture</string>
    <key>CFBundleIdentifier</key>
    <string>com.mattstack.release-fixture</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${version}</string>
    <key>CFBundleVersion</key>
    <string>${build}</string>
</dict>
</plist>
`;

// Always a minimal, from-scratch bundle (a real Mach-O + a plist) — enough
// for codesign and generate_appcast's own signing-identity check to succeed,
// and independent of whatever bundle rt-tray/build.sh happens to have
// produced in this checkout (that bundle can run into the hundreds of MB).
// The build number mirrors build.sh's numeric_build (X*1000000 + Y*1000 + Z),
// because that is what sparkle:version and a minimum update version compare.
function buildFixtureApp(workdir: string, version = "1.0.0"): string {
  const [maj, min, pat] = version.split(".").map(Number);
  const build = String(maj! * 1000000 + min! * 1000 + pat!);
  const appPath = join(workdir, `app-${version}`, "mattstack-fixture.app");
  mkdirSync(join(appPath, "Contents", "MacOS"), { recursive: true });
  copyFileSync("/bin/echo", join(appPath, "Contents", "MacOS", "mattstack-fixture"));
  chmodSync(join(appPath, "Contents", "MacOS", "mattstack-fixture"), 0o755);
  writeFileSync(join(appPath, "Contents", "Info.plist"), minimalPlist(version, build));
  return appPath;
}

function stampPublicKeyAndSign(appPath: string, publicKeyValue: string): void {
  const plist = join(appPath, "Contents", "Info.plist");
  const setResult = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Set :SUPublicEDKey ${publicKeyValue}`, plist]);
  if (setResult.status !== 0) {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Add :SUPublicEDKey string ${publicKeyValue}`, plist]);
  }
  execFileSync("codesign", ["--force", "--deep", "-s", "-", appPath]);
}

// A curl that always reports "not found" — exercises appcast.sh's
// first-release branch without any real network access. It prints the status
// and exits 0 because appcast.sh fetches WITHOUT `-f`: that is what real curl
// does on a 404, and the script branches on the status, not the exit code.
function writeCurl404Shim(binDir: string): void {
  writeFileSync(join(binDir, "curl"), "#!/bin/bash\necho 404\n");
  chmodSync(join(binDir, "curl"), 0o755);
}

// A stand-in for the repo root: the release scripts plus the Sparkle tools,
// and a declaration file only when a test writes one, so the suite never
// depends on what rt-tray/sparkle-minimum-update says today.
function makeReleaseRoot(workdir: string, declaration?: string): string {
  const root = join(workdir, "root");
  mkdirSync(join(root, "scripts", "release"), { recursive: true });
  for (const f of readdirSync(RELEASE_SCRIPTS)) {
    if (f.endsWith(".sh")) copyFileSync(join(RELEASE_SCRIPTS, f), join(root, "scripts", "release", f));
  }
  mkdirSync(join(root, "rt-tray"));
  if (existsSync(join(ROOT, "rt-tray", "deps"))) symlinkSync(join(ROOT, "rt-tray", "deps"), join(root, "rt-tray", "deps"));
  if (declaration !== undefined) writeFileSync(join(root, "rt-tray", "sparkle-minimum-update"), declaration);
  return root;
}

function runAppcastSh(root: string, archivesDir: string, tag: string, sparkleEdKey: string, fakeBin: string) {
  return spawnSync("bash", [join(root, "scripts", "release", "appcast.sh"), archivesDir, tag], {
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, SPARKLE_ED_KEY: sparkleEdKey, GITHUB_REPOSITORY: "m4ttstack/mattstack" },
    encoding: "utf8",
  });
}

describe.skipIf(!HAVE_SPARKLE)("appcast.sh signing (offline, throwaway key)", () => {
  test("signs the new enclosure, and the embedded signature matches an independent sign_update run", () => {
    const workdir = mkdtempSync(join(tmpdir(), "mattstack-release-appcast-"));
    try {
      const { sparkleEdKey, publicKeyB64 } = deriveThrowawayKey(workdir);

      const appPath = buildFixtureApp(workdir);
      stampPublicKeyAndSign(appPath, publicKeyB64);

      const archivesDir = join(workdir, "archives");
      mkdirSync(archivesDir);
      const zipPath = join(archivesDir, "mattstack-1.0.0.zip");
      execFileSync("bash", [MAKE_ZIP, appPath, zipPath]);

      const fakeBin = join(workdir, "fakebin");
      mkdirSync(fakeBin);
      writeCurl404Shim(fakeBin);

      const result = runAppcastSh(makeReleaseRoot(workdir), archivesDir, "v1.0.0", sparkleEdKey, fakeBin);
      expect(result.status).toBe(0);

      const appcastXml = readFileSync(join(archivesDir, "appcast.xml"), "utf8");
      const enclosureLine = appcastXml.split("\n").find((l) => l.includes("<enclosure") && l.includes("mattstack-1.0.0.zip"));
      expect(enclosureLine).toBeDefined();
      const embeddedSig = enclosureLine!.match(/sparkle:edSignature="([^"]+)"/)?.[1];
      expect(embeddedSig).toBeTruthy();

      const independentSig = execFileSync(SIGN, ["--ed-key-file", "-", "-p", zipPath], { input: sparkleEdKey }).toString().trim();
      expect(embeddedSig).toBe(independentSig);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  test("fails with a named reason when SUPublicEDKey is the unfilled template placeholder", () => {
    const workdir = mkdtempSync(join(tmpdir(), "mattstack-release-appcast-badkey-"));
    try {
      const { sparkleEdKey } = deriveThrowawayKey(workdir);

      const appPath = buildFixtureApp(workdir);
      // generate_appcast exits 0 and silently omits edSignature for this
      // exact case — appcast.sh must not let a mismatched key ship silently.
      stampPublicKeyAndSign(appPath, "REPLACE_WITH_RELEASE_PUBLIC_ED_KEY");

      const archivesDir = join(workdir, "archives");
      mkdirSync(archivesDir);
      const zipPath = join(archivesDir, "mattstack-1.0.0.zip");
      execFileSync("bash", [MAKE_ZIP, appPath, zipPath]);

      const fakeBin = join(workdir, "fakebin");
      mkdirSync(fakeBin);
      writeCurl404Shim(fakeBin);

      const result = runAppcastSh(makeReleaseRoot(workdir), archivesDir, "v1.0.0", sparkleEdKey, fakeBin);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/edSignature|does not match/);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});

// A curl that serves a fake GitHub Releases tree from <serveDir>:
// releases/latest/download/<f> reads <serveDir>/latest/<f>, and
// releases/download/<tag>/<f> reads <serveDir>/<tag>/<f>. Anything else is a 404.
function writeCurlServeShim(binDir: string, serveDir: string): void {
  writeFileSync(join(binDir, "curl"), `#!/bin/bash
out=""; url=""
while [ $# -gt 0 ]; do
    case "$1" in
        -o|-w) [ "$1" = -o ] && out="$2"; shift 2 ;;
        -*) shift ;;
        *) url="$1"; shift ;;
    esac
done
rel="\${url#https://github.com/m4ttstack/mattstack/releases/}"
case "$rel" in
    latest/download/*) f="${serveDir}/latest/\${rel#latest/download/}" ;;
    download/*) f="${serveDir}/\${rel#download/}" ;;
    *) f="" ;;
esac
if [ -n "$f" ] && [ -f "$f" ]; then cp "$f" "$out"; echo 200; else echo 404; fi
`);
  chmodSync(join(binDir, "curl"), 0o755);
}

// Publishes what appcast.sh left in <archivesDir> the way Create Release does:
// every file becomes an asset of <tag>, and its appcast becomes the latest one.
function publish(archivesDir: string, serveDir: string, tag: string): void {
  mkdirSync(join(serveDir, tag), { recursive: true });
  mkdirSync(join(serveDir, "latest"), { recursive: true });
  for (const f of readdirSync(archivesDir)) copyFileSync(join(archivesDir, f), join(serveDir, tag, f));
  copyFileSync(join(archivesDir, "appcast.xml"), join(serveDir, "latest", "appcast.xml"));
}

function itemFor(appcastXml: string, shortVersion: string): string | undefined {
  return appcastXml.match(/<item>[\s\S]*?<\/item>/g)?.find((i) => i.includes(`<title>${shortVersion}</title>`));
}

// Releases 1.0.0 then 1.0.1 into a fake Releases tree, so a third release
// finds a real two-item feed with deltas, as v2.22.0 will find v2.21.1's.
function releaseHistory(workdir: string) {
  const { sparkleEdKey, publicKeyB64 } = deriveThrowawayKey(workdir);
  const serveDir = join(workdir, "serve");
  const fakeBin = join(workdir, "fakebin");
  mkdirSync(fakeBin);
  writeCurlServeShim(fakeBin, serveDir);

  const cut = (version: string, root: string) => {
    const appPath = buildFixtureApp(workdir, version);
    stampPublicKeyAndSign(appPath, publicKeyB64);
    const archivesDir = join(workdir, `archives-${version}`);
    mkdirSync(archivesDir);
    execFileSync("bash", [MAKE_ZIP, appPath, join(archivesDir, `mattstack-${version}.zip`)]);
    const result = runAppcastSh(root, archivesDir, `v${version}`, sparkleEdKey, fakeBin);
    return { result, archivesDir };
  };

  const plainRoot = makeReleaseRoot(join(workdir, "plain-root"));
  for (const version of ["1.0.0", "1.0.1"]) {
    const { result, archivesDir } = cut(version, plainRoot);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    publish(archivesDir, serveDir, `v${version}`);
  }
  const previousFeed = readFileSync(join(serveDir, "latest", "appcast.xml"), "utf8");
  return { cut, previousFeed };
}

describe.skipIf(!HAVE_SPARKLE)("appcast.sh minimum update version (offline, throwaway key)", () => {
  test("a declared minimum lands on the new item only, and the older items are kept unchanged", () => {
    const workdir = mkdtempSync(join(tmpdir(), "mattstack-release-appcast-min-"));
    try {
      mkdirSync(join(workdir, "plain-root"));
      const { cut, previousFeed } = releaseHistory(workdir);
      expect(itemFor(previousFeed, "1.0.1")).toContain("<sparkle:deltas>");

      const root = makeReleaseRoot(workdir, "release=1.1.0\nminimum=1.0.1\n");
      const { result, archivesDir } = cut("1.1.0", root);
      expect(result.status).toBe(0);

      const feed = readFileSync(join(archivesDir, "appcast.xml"), "utf8");
      expect(itemFor(feed, "1.1.0")).toContain("<sparkle:minimumUpdateVersion>1000001</sparkle:minimumUpdateVersion>");
      expect(feed.match(/minimumUpdateVersion>/g)?.length).toBe(2);
      expect(itemFor(feed, "1.0.1")).toBe(itemFor(previousFeed, "1.0.1"));
      expect(itemFor(feed, "1.0.0")).toBe(itemFor(previousFeed, "1.0.0"));
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 120_000);

  test("without a declaration the new item carries no minimum and the older items are kept", () => {
    const workdir = mkdtempSync(join(tmpdir(), "mattstack-release-appcast-nomin-"));
    try {
      mkdirSync(join(workdir, "plain-root"));
      const { cut, previousFeed } = releaseHistory(workdir);

      const { result, archivesDir } = cut("1.1.0", makeReleaseRoot(workdir));
      expect(result.status).toBe(0);

      const feed = readFileSync(join(archivesDir, "appcast.xml"), "utf8");
      expect(feed).not.toContain("minimumUpdateVersion");
      expect(itemFor(feed, "1.1.0")).toContain("mattstack-1.1.0.zip");
      expect(itemFor(feed, "1.0.0")).toBe(itemFor(previousFeed, "1.0.0"));
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 120_000);

  test("refuses a minimum the previous feed has no item for", () => {
    const workdir = mkdtempSync(join(tmpdir(), "mattstack-release-appcast-minmissing-"));
    try {
      mkdirSync(join(workdir, "plain-root"));
      const { cut } = releaseHistory(workdir);

      const root = makeReleaseRoot(workdir, "release=1.1.0\nminimum=1.0.2\n");
      const { result } = cut("1.1.0", root);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("1000002");
      expect(result.stderr).toContain("sparkle-minimum-update");
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 120_000);
});

// The resolver needs no Sparkle tools, so these run on every machine.
describe("minimum-update.sh", () => {
  function resolve(tag: string, declaration?: string) {
    const workdir = mkdtempSync(join(tmpdir(), "mattstack-release-minimum-"));
    try {
      const root = makeReleaseRoot(workdir, declaration);
      return spawnSync("bash", [join(root, "scripts", "release", "minimum-update.sh"), tag], { encoding: "utf8" });
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  }

  test("prints nothing when no release declares a minimum", () => {
    const r = resolve("v2.22.0");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("prints the minimum as a bundle version for the declared release", () => {
    const r = resolve("v2.22.0", "# a note\nrelease=2.22.0\nminimum=2.21.1\n");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("2021001\n");
  });

  test("applies to a rehearsal of an earlier version, so a dry run proves it", () => {
    const r = resolve("v2.21.2-ci41", "release=2.22.0\nminimum=2.21.1\n");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("2021001\n");
  });

  test("refuses a release past the declared one, so a stale declaration cannot ship", () => {
    const r = resolve("v2.23.0", "release=2.22.0\nminimum=2.21.1\n");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("2.22.0");
    expect(r.stderr).toContain("sparkle-minimum-update");
  });

  test("refuses a minimum that is not below the version being cut", () => {
    const r = resolve("v2.21.1-ci3", "release=2.22.0\nminimum=2.21.1\n");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe("");
  });

  test("refuses a declaration that is not two X.Y.Z versions", () => {
    for (const bad of ["release=2.22.0\n", "minimum=2.21.1\n", "release=2.22\nminimum=2.21.1\n", "release=2.22.0\nminimum=v2.21.1\n"]) {
      const r = resolve("v2.22.0", bad);
      expect(r.status).not.toBe(0);
      expect(r.stdout).toBe("");
    }
  });
});
