import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { childEnv, runCapture } from "../../subprocess.ts";

// Catches a disconnected native-inventory/compile seam: the compiler must use
// the selected installed engine but the current source pack's own fills.
// Only the external Claude executable is replaced; discovery, compilation,
// drift checking and the emitted resource all execute production code.
test("Claude discovery recovers from bad inventory and compiles executable resources from the selected engine", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-claude-compile-")));
  try {
    const fixture = join(import.meta.dir, "fixtures", "compile-native");
    cpSync(fixture, root, { recursive: true });
    const pack = join(root, "pack");
    const engine = join(root, "mattstack-home", "plugins", "mattstack");
    const oldEngine = join(root, "old-engine");
    const oldPack = join(root, "old-pack");
    cpSync(engine, oldEngine, { recursive: true });
    cpSync(pack, oldPack, { recursive: true });
    writeFileSync(join(engine, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "2.0.0" }));
    writeFileSync(join(oldEngine, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "mattstack", version: "1.0.0" }));
    writeFileSync(join(oldPack, "attachments", "plan-policy", "SKILL.md"), "---\nname: plan-policy\ndescription: old\nmetadata:\n  provides: plan-domain@1\n---\n\nSTALE INSTALLED POLICY\n");
    writeFileSync(join(engine, "attachments", "gitlab-note", "scripts", "note.sh"), "#!/bin/sh\nprintf 'selected engine resource\\n'\n");

    const bin = join(root, "bin");
    mkdirSync(bin);
    const inventory = join(root, "inventory.json");
    const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
    writeFileSync(join(bin, "claude"), `#!/bin/sh\n[ "$*" = 'plugin list --json' ] || exit 93\nexec /bin/cat ${quote(inventory)}\n`, { mode: 0o755 });
    const entries = [
      { id: "mattstack@mattstack", installPath: oldEngine, version: "1.0.0", enabled: true, scope: "user" },
      { id: "mattstack@mirror", installPath: engine, version: "2.0.0", enabled: true, scope: "project" },
      { id: "acme@acme", installPath: oldPack, version: "0.1.0", enabled: true, scope: "user" },
    ];
    const driver = join(root, "driver.ts");
    const commands = resolve(import.meta.dir, "../../../commands/skills.ts");
    writeFileSync(driver, `
import { writeFileSync } from "fs";
import { compilePackAll, checkPack } from ${JSON.stringify(commands)};
const opts = ${JSON.stringify({ packDir: pack, manifest: join(root, "mattstack-home", "repos", "my-repo", "skills.jsonc") })};
writeFileSync(${JSON.stringify(inventory)}, "not json");
let rejected = false;
try { await compilePackAll(opts); } catch { rejected = true; }
writeFileSync(${JSON.stringify(inventory)}, ${JSON.stringify(JSON.stringify(entries))});
const compiled = await compilePackAll(opts);
const checked = await checkPack(opts);
console.log(JSON.stringify({ rejected, compiled, drift: checked.drift, chainErrors: checked.chainErrors, verbs: checked.verbs }));
`);
    const home = join(root, "home");
    mkdirSync(home);
    const run = await runCapture([process.execPath, driver], {
      cwd: root,
      env: { ...childEnv(), HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), PATH: `${bin}:/usr/bin:/bin`, RT_BATCH: "1" },
      stderr: "pipe",
      timeoutMs: 15_000,
    });
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe("");
    const result = JSON.parse(run.stdout);
    expect(result.rejected).toBe(true);
    expect(result.compiled.ok).toBe(true);
    expect(result.compiled.errors).toEqual([]);
    expect(result.drift).toBe(false);
    expect(result.chainErrors).toEqual([]);
    expect(result.verbs.map((v: { name: string; status: string }) => [v.name, v.status]).sort()).toEqual([
      ["stage-implement", "in-sync"], ["stage-plan", "in-sync"], ["stage-ship", "in-sync"], ["work", "in-sync"],
    ]);
    const plan = readFileSync(join(pack, "attachments", "stage-plan", "SKILL.md"), "utf8");
    expect(plan).toContain("policy text");
    expect(plan).not.toContain("STALE INSTALLED POLICY");
    const resource = /\$\{CLAUDE_SKILL_DIR\}([^\s`]*\/scripts\/note\.sh)/.exec(plan);
    expect(resource).not.toBeNull();
    const emittedPath = resolve(pack, "skills", "work", resource![1]!.replace(/^\//, ""));
    const executed = await runCapture(["/bin/sh", emittedPath], { env: childEnv(), stderr: "pipe" });
    expect(executed.exitCode).toBe(0);
    expect(executed.stdout).toBe("selected engine resource\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
