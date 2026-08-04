#!/usr/bin/env bun
/** Cut a release of @mattstack/gitq: verify the tree, bump the version, run
    the gates, publish, then commit and push the bump and its tag.

    Usage: bun run release <patch|minor|major|x.y.z> [--dry-run]

    Publishing uses `bun publish`, not `npm publish`: bun resolves the
    workspace: and catalog: protocols that this suite's packages use, and npm
    leaves them verbatim in the manifest, which produces a package nobody can
    install. */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const PKG = join(ROOT, 'package.json');
const dryRun = process.argv.includes('--dry-run');
const bumpArg = process.argv[2];

function run(cmd: string[], opts: { capture?: boolean } = {}): string {
  const proc = Bun.spawnSync(cmd, { cwd: ROOT, stdout: opts.capture ? 'pipe' : 'inherit', stderr: 'inherit' });
  if (proc.exitCode !== 0) {
    console.error(`\nfailed: ${cmd.join(' ')}`);
    process.exit(1);
  }
  return opts.capture ? new TextDecoder().decode(proc.stdout).trim() : '';
}

function die(msg: string): never {
  console.error(`release: ${msg}`);
  process.exit(1);
}

if (!bumpArg || bumpArg.startsWith('--')) {
  die('usage: bun run release <patch|minor|major|x.y.z> [--dry-run]');
}

// 1. The tree has to be somewhere we can safely tag from.
const branch = run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { capture: true });
if (branch !== 'main') die(`on branch ${branch}, releases cut from main`);
if (run(['git', 'status', '--porcelain'], { capture: true })) die('working tree is dirty');
run(['git', 'fetch', 'origin', 'main', '--quiet']);
if (run(['git', 'log', '--oneline', 'origin/main..HEAD'], { capture: true })) {
  die('local main is ahead of origin, push first');
}
if (run(['git', 'log', '--oneline', 'HEAD..origin/main'], { capture: true })) {
  die('local main is behind origin, pull first');
}

// 2. Work out the next version.
const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as { name: string; version: string };
const [maj, min, pat] = pkg.version.split('.').map(Number) as [number, number, number];
const next =
  bumpArg === 'patch' ? `${maj}.${min}.${pat + 1}`
  : bumpArg === 'minor' ? `${maj}.${min + 1}.0`
  : bumpArg === 'major' ? `${maj + 1}.0.0`
  : /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(bumpArg) ? bumpArg
  : die(`not a bump or a version: ${bumpArg}`);

const tag = `v${next}`;
if (run(['git', 'tag', '--list', tag], { capture: true })) die(`tag ${tag} already exists`);

console.log(`\n${pkg.name}  ${pkg.version} -> ${next}\n`);

// 3. Gates. prepublishOnly reruns check-types and build, so this is the
//    tests plus a fast fail before anything is written.
run(['bun', 'run', 'check-types']);
run(['bun', 'run', 'test:unit']);

if (dryRun) {
  console.log(`\ndry run: would publish ${next}, then tag and push ${tag}`);
  process.exit(0);
}

// 4. Publish first. If it fails, the repo is untouched and rerunnable;
//    the reverse order would leave a tag pointing at an unpublished version.
writeFileSync(PKG, JSON.stringify({ ...JSON.parse(readFileSync(PKG, 'utf8')), version: next }, null, 2) + '\n');
try {
  run(['bun', 'publish']);
} catch (err) {
  writeFileSync(PKG, readFileSync(PKG, 'utf8').replace(`"version": "${next}"`, `"version": "${pkg.version}"`));
  throw err;
}

// 5. Record it.
run(['git', 'add', 'package.json']);
run(['git', 'commit', '-m', `chore: release ${next}`]);
run(['git', 'tag', '-a', tag, '-m', `${pkg.name} ${next}`]);
run(['git', 'push', 'origin', 'main', '--follow-tags']);

// 6. npm's packument lags the tarball on fresh publishes, so the version can
//    exist while `npm install` still cannot resolve a range against it.
console.log('\nwaiting for the registry to serve the new version...');
const encoded = pkg.name.replace('/', '%2f');
for (let i = 0; i < 10; i++) {
  await Bun.sleep(6000);
  const res = await fetch(`https://registry.npmjs.org/${encoded}`, { cache: 'no-store' });
  const latest = res.ok ? ((await res.json()) as { 'dist-tags'?: { latest?: string } })['dist-tags']?.latest : null;
  if (latest === next) {
    console.log(`\nreleased ${pkg.name}@${next}, tagged ${tag}`);
    process.exit(0);
  }
}
console.log(`\npublished and tagged ${tag}, but the registry has not served ${next} yet.`);
console.log('this is usually propagation. if it persists, publishing a patch on top rebuilds the metadata.');
