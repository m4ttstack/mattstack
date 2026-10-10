/**
 * A throwaway acceptance environment for the runner's own tests: an owned
 * root, a fake installed bundle, a capture folder, and an exec that answers
 * the probes from a table instead of running anything.
 */

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { EnvironmentDescriptor, Exec } from "../environment.ts";
import { OWNERSHIP_MARKER } from "../environment.ts";
import type { CaptureManifest } from "../harnesses.ts";
import { requiredSlots, slotKey, type Profile } from "../scenarios.ts";

export const COMMIT = "0123456789abcdef0123456789abcdef01234567";
export const VERSION = "2.30.0";
export const NATIVE_VERSIONS = { claude: "2.1.294", codex: "0.160.0" } as const;

export type FixtureEnv = {
  root: string;
  descriptorPath: string;
  descriptor: EnvironmentDescriptor;
  calls: string[][];
  exec: Exec;
  /** Writes one slot's capture manifest. */
  capture(profile: Profile, key: string, manifest: CaptureManifest, files?: Record<string, string>): void;
  /** Writes a passing manifest for every slot the default drivers do not cover. */
  captureAllPassing(profile: Profile): void;
};

export function fixtureEnv(opts: Partial<EnvironmentDescriptor> & { versions?: Partial<Record<"claude" | "codex", string>>; commit?: string } = {}): FixtureEnv {
  const root = mkdtempSync(join(tmpdir(), "rt-acceptance-env-"));
  const id = opts.id ?? `fixture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  writeFileSync(join(root, OWNERSHIP_MARKER), `${id}\n`);
  const home = join(root, "home");
  const app = join(root, "mattstack.app");
  const captureDir = join(root, "captures");
  mkdirSync(home, { recursive: true });
  mkdirSync(captureDir, { recursive: true });
  bundle(app);
  const descriptor: EnvironmentDescriptor = {
    owner: "rt-acceptance", id, kind: "vm", root, home, path: "/usr/bin:/bin", app, rt: join(app, "Contents", "Helpers", "rt"),
    service: { id: "com.mattstack.daemon" }, disruptive: true, captureDir, claudeTripwireLog: join(root, "tripwire", "claude.log"),
    permissionMode: "auto", launch: "managed",
    ...opts,
  };
  const descriptorPath = join(root, "environment.json");
  writeFileSync(descriptorPath, JSON.stringify(descriptor));
  const versions = { ...NATIVE_VERSIONS, ...opts.versions };
  const calls: string[][] = [];
  const exec: Exec = (argv) => {
    calls.push(argv);
    const [bin, ...args] = argv;
    if (bin === "/usr/libexec/PlistBuddy") {
      const key = args[1]?.replace(/^Print :/, "");
      if (key === "CFBundleShortVersionString") return { status: 0, stdout: `${VERSION}\n`, stderr: "" };
      if (key === "MSSourceCommit") return { status: 0, stdout: `${opts.commit ?? COMMIT}\n`, stderr: "" };
      return { status: 1, stdout: "", stderr: "Does Not Exist" };
    }
    if (bin === descriptor.rt) return { status: 0, stdout: `rt ${VERSION}\nprod  mattstack.app · ${descriptor.rt}\n`, stderr: "" };
    if (bin === "claude") return { status: 0, stdout: `${versions.claude} (Claude Code)\n`, stderr: "" };
    if (bin === "codex") return { status: 0, stdout: `codex-cli ${versions.codex}\n`, stderr: "" };
    return { status: 127, stdout: "", stderr: `${bin}: not found` };
  };

  const capture: FixtureEnv["capture"] = (profile, key, manifest, files = {}) => {
    const dir = join(captureDir, profile);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    writeFileSync(join(dir, `${key}.json`), JSON.stringify(manifest));
  };

  const captureAllPassing = (profile: Profile) => {
    for (const { scenario, harness } of requiredSlots(profile)) {
      if (scenario.id === "release-artifact" || scenario.id === "codex-only-no-claude") continue;
      const key = slotKey(scenario.id, harness);
      const file = `${key}.log`;
      const manifest: CaptureManifest = {
        outcome: "passed",
        files: [file],
        ...(harness && { hook: { revision: `rev-${harness}`, trust: "trusted", proof: harness === "claude" ? "installation" : "receipts" } }),
        ...(scenario.needs.includes("disruptive") && { service: { id: "com.mattstack.daemon", recordedAt: "2026-10-10T00:00:00.000Z" } }),
        ...(scenario.restart && {
          native: {
            before: { nativeId: `thread-${harness}`, generation: 2, pending: ["q-1"] },
            after: { nativeId: `thread-${harness}`, generation: 3, pending: [] },
            fate: "completed", fateSource: "native",
          },
        }),
      };
      capture(profile, key, manifest, { [file]: `${key} observed\n` });
    }
  };

  return { root, descriptorPath, descriptor, calls, exec, capture, captureAllPassing };
}

/**
 * Makes the environment answer real probes: an Info.plist, an `rt` that
 * prints its version, and `claude`/`codex` stubs on the descriptor's PATH.
 * In a Codex-only environment `claude` is the tripwire: it logs and fails.
 */
export function installStubs(e: FixtureEnv, profile: Profile): void {
  const bin = join(e.root, "bin");
  mkdirSync(bin, { recursive: true });
  const contents = join(e.descriptor.app, "Contents");
  writeFileSync(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleShortVersionString</key><string>${VERSION}</string>
<key>MSSourceCommit</key><string>${COMMIT}</string>
</dict></plist>
`);
  const script = (path: string, body: string) => {
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  };
  script(e.descriptor.rt, `echo "rt ${VERSION}"`);
  script(join(bin, "codex"), `echo "codex-cli ${NATIVE_VERSIONS.codex}"`);
  const tripwire = e.descriptor.claudeTripwireLog!;
  mkdirSync(join(tripwire, ".."), { recursive: true });
  script(join(bin, "claude"), profile === "codex-only"
    ? `echo "$(date -u +%FT%TZ) claude $*" >> '${tripwire}'\nexit 127`
    : `echo "${NATIVE_VERSIONS.claude} (Claude Code)"`);
  e.descriptor.path = `${bin}:/usr/bin:/bin`;
  writeFileSync(e.descriptorPath, JSON.stringify(e.descriptor));
}

function bundle(app: string): void {
  const helpers = join(app, "Contents", "Helpers");
  for (const appName of ["board", "gitq"]) {
    mkdirSync(join(helpers, "skills", appName, "review"), { recursive: true });
    writeFileSync(join(helpers, "skills", appName, "review", "SKILL.md"), "---\nname: review\n---\nRun ${CLAUDE_SKILL_DIR}/scripts/x.sh\n");
    mkdirSync(join(helpers, "skills-targets", "codex", appName, "review"), { recursive: true });
    writeFileSync(join(helpers, "skills-targets", "codex", appName, "review", "SKILL.md"), "---\nname: review\n---\nRun scripts/x.sh\n");
  }
  writeFileSync(join(helpers, "skills-targets", "codex", "board", "skills-target.json"), '{"harness":"codex"}\n');
}
