import { join, relative } from "path";
import { applyEdits, modify } from "jsonc-parser";
import { logFailureDetail, UserActionableError } from "../errors.ts";
import { readSection } from "../../packages/rt-client/src/settings/migrate.ts";
import { getDef } from "../settings/registry.ts";
import { TEAM_NAME_RE } from "../settings/stores.ts";
import { validateSlug } from "../secrets/store.ts";
import { FragmentError, parseFragment } from "./manifest-merge.ts";
import { packManifestPath, repoSlug } from "./manifest-paths.ts";
import { stripJsonc } from "./sources.ts";
import type { PackShare } from "../team/share-pack.ts";
import { orgsDirUnder } from "../rt-paths.ts";
import { ORG_LAYOUT, parseMarker } from "../team/org-marker.ts";
import { orgLayoutWaitingError } from "../team/org-layout.ts";
import { TEAM_PACK_FOLDER, isUnconvertedTeamPack, teamPackSource, unconvertedTeamPackError } from "../team/team-pack-path.ts";

/** Strips only the userinfo (scheme://user:pass@) so the rest of a rejected remote URL stays in the message; withoutUrls's full-URL redaction would leave nothing readable here. */
function withoutCredentials(message: string): string {
  return message.replace(/(:\/\/)[^/@\s]+@/g, "$1");
}

export type RepoRef = { host: string; path: string; slug: string };

/** The slug here is the directory every per-pack bindings file for this repo lands under. */
export function parseRemote(url: string): RepoRef | null {
  let u = url.trim();
  if (u.endsWith(".git")) u = u.slice(0, -4);
  for (const scheme of ["ssh://", "https://", "http://", "git://"]) {
    if (u.startsWith(scheme)) { u = u.slice(scheme.length); break; }
  }
  const at = u.indexOf("@");
  if (at !== -1) u = u.slice(at + 1);
  u = u.replace(":", "/");
  const slash = u.indexOf("/");
  if (slash === -1 || slash === u.length - 1) return null;
  const host = u.slice(0, slash).toLowerCase();
  const path = u.slice(slash + 1);
  return { host, path, slug: repoSlug(host, path) };
}

export type InitFs = {
  exists(p: string): boolean;
  readFile(p: string): string | null;
  writeFile(p: string, text: string): void;
  mkdirp(p: string): void;
  readDir(p: string): string[];
};

export type ZoneInfo = {
  /** "<org>/<team>": what a bindings file's header records. */
  slug: string;
  org: string;
  team: string;
  /** The org clone's root. */
  orgDir: string;
  /** The team folder. */
  dir: string;
  host: string | null;
  projects: string[];
  marketplace: string | null;
  hasPack: boolean;
  /** Compile has written into the pack; a pack that has not is a skeleton init carries on. */
  packCompiled: boolean;
};

function readJsonc(fs: InitFs, path: string): Record<string, unknown> | null {
  const raw = fs.readFile(path);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(stripJsonc(raw));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function hostOnly(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.replace(/^https?:\/\//, "").split("/")[0]!.toLowerCase() || null;
}

/** A pack is a directory holding the fragment materialize layers, so every "which packs are here" question agrees with materialize. */
export function isPackDir(fs: Pick<InitFs, "exists">, dir: string): boolean {
  return fs.exists(join(dir, "pack", "skills.jsonc"));
}

/** An unreadable fragment is not a base, so materialize still tries the pack and reports the parse error against it. */
export function isBasePack(fs: Pick<InitFs, "readFile">, dir: string): boolean {
  const path = join(dir, "pack", "skills.jsonc");
  const text = fs.readFile(path);
  if (text === null) return false;
  try {
    return parseFragment(text, path).base === true;
  } catch (err) {
    if (err instanceof FragmentError) return false;
    throw err;
  }
}

export function readZones(fs: InitFs, home: string): ZoneInfo[] {
  return readZonesFrom(fs, orgsDirUnder(home));
}

function isOrgSlug(name: string): boolean {
  try {
    validateSlug(name);
    return true;
  } catch {
    return false;
  }
}

/** The org clones on this Mac, by the folder name every zone's slug starts with. */
export function readOrgSlugs(fs: InitFs, home: string): string[] {
  const orgsRoot = orgsDirUnder(home);
  return [...fs.readDir(orgsRoot)].sort().filter((org) => isOrgSlug(org) && readJsonc(fs, join(orgsRoot, org, "mattstack", "mattstack.jsonc"))?.role === "org");
}

function storeGlobal(fs: InitFs, path: string): Record<string, unknown> | null {
  const parsed = readJsonc(fs, path);
  if (parsed === null) return null;
  const { repos: _repos, ...global } = parsed;
  return global;
}

function stored(key: string, section: Record<string, unknown> | null): unknown {
  const def = getDef(key);
  if (!def || section === null) return undefined;
  const read = readSection(def, section, { layer: true });
  return read.present ? read.value : undefined;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((p) => typeof p === "string");
}

function forgeHost(section: Record<string, unknown> | null): unknown {
  return (stored("mattstack.integrations", section) as { forge?: { host?: unknown } | null } | undefined)?.forge?.host;
}

export function zonePackDir(zone: Pick<ZoneInfo, "dir">): string {
  return join(zone.dir, TEAM_PACK_FOLDER);
}

/** A team folder can land before its settings file (a partial pull); only a parsed settings file says what the team claims. */
export function zoneTeamConfigReads(fs: InitFs, zoneDir: string): boolean {
  return readJsonc(fs, join(zoneDir, "settings.team.jsonc")) !== null;
}

/**
 * One zone per team folder of every org clone. A team's pack claims the
 * projects in board.projects as that team resolves it (the team's own list,
 * else the org's), on board.gitlabHost, else the forge host.
 */
export function readZonesFrom(fs: InitFs, teams: string): ZoneInfo[] {
  const zones: ZoneInfo[] = [];
  for (const org of [...fs.readDir(teams)].sort()) {
    if (!isOrgSlug(org)) continue;
    const orgDir = join(teams, org);
    const state = parseMarker(fs.readFile(join(orgDir, "mattstack", "mattstack.jsonc")));
    if (state.kind !== "org") continue;
    if (state.layout !== ORG_LAYOUT) throw orgLayoutWaitingError({ kind: "waiting", slug: org, dir: orgDir, layout: state.layout });
    const orgSettings = storeGlobal(fs, join(orgDir, "mattstack", "org", "settings.org.jsonc"));
    const market = readJsonc(fs, join(orgDir, ".claude-plugin", "marketplace.json"));
    const marketplace = typeof market?.name === "string" ? market.name : null;
    const teamsRoot = join(orgDir, "mattstack", "teams");
    for (const team of [...fs.readDir(teamsRoot)].sort()) {
      if (!TEAM_NAME_RE.test(team)) continue;
      const dir = join(teamsRoot, team);
      const teamSettings = storeGlobal(fs, join(dir, "settings.team.jsonc"));
      if (teamSettings === null) continue;
      const projects = [stored("board.projects", teamSettings), stored("board.projects", orgSettings)].find(isStringList) ?? [];
      const host =
        hostOnly(stored("board.gitlabHost", teamSettings)) ??
        hostOnly(stored("board.gitlabHost", orgSettings)) ??
        hostOnly(forgeHost(teamSettings)) ??
        hostOnly(forgeHost(orgSettings));
      if (isUnconvertedTeamPack(fs, dir, team)) throw unconvertedTeamPackError(orgDir, team);
      const packDir = zonePackDir({ dir });
      zones.push({ slug: `${org}/${team}`, org, team, orgDir, dir, host, projects, marketplace, hasPack: isPackDir(fs, packDir) && !isBasePack(fs, packDir), packCompiled: packIsCompiled(fs, packDir) });
    }
  }
  return zones;
}

export type ZoneChoice =
  | { kind: "found"; zone: ZoneInfo }
  | { kind: "ambiguous"; zones: ZoneInfo[] }
  | { kind: "missing" }
  | { kind: "mismatch"; zone: ZoneInfo };

export type ZoneWanted = { org: string | null; team: string | null; active: string | null };

/** `team` is the --team flag and names a folder or nothing. `active` is taken like --team when its folder exists, ahead of the repo's own claims; when its folder is absent the claims decide. A team whose pack never compiled is free: init carries it on. */
export function chooseZone(zones: ZoneInfo[], repo: RepoRef, wanted: ZoneWanted): ZoneChoice {
  const inOrg = wanted.org ? zones.filter((z) => z.org === wanted.org) : zones;
  const onHost = (z: ZoneInfo) => z.host === null || z.host === repo.host;
  const declares = (z: ZoneInfo) => z.projects.includes(repo.path);

  const named = wanted.team ?? wanted.active;
  if (named) {
    const zone = inOrg.find((z) => z.team === named);
    if (zone) return onHost(zone) ? { kind: "found", zone } : { kind: "mismatch", zone };
    if (wanted.team) return { kind: "missing" };
  }

  const declared = inOrg.filter((z) => onHost(z) && declares(z));
  if (declared.length === 1) return { kind: "found", zone: declared[0]! };
  if (declared.length > 1) return { kind: "ambiguous", zones: declared };
  const free = inOrg.filter((z) => onHost(z) && !z.packCompiled);
  if (free.length === 1) return { kind: "found", zone: free[0]! };
  if (free.length > 1) return { kind: "ambiguous", zones: free };
  return { kind: "missing" };
}

/** A pack that compile has written into: its public verbs live under skills/, its stages and fills under attachments/. */
export function packIsCompiled(fs: Pick<InitFs, "readDir" | "exists">, packDir: string): boolean {
  return ["skills", "attachments"].some((side) =>
    fs.readDir(join(packDir, side)).some((name) => fs.exists(join(packDir, side, name, "SKILL.md"))),
  );
}

export const PIPELINE_STAGES = [
  "stage-provision",
  "stage-plan",
  "stage-gates",
  "stage-evidence",
  "stage-implement",
  "stage-self-review",
  "stage-ship",
  "stage-watch-ci",
] as const;

const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

export function packDescription(pack: string): string {
  return `The ${pack} team pack for mattstack pipelines: the team's verb roster and bindings fragment, plus the domain fills bound to the generic stages.`;
}

export function renderPackFiles(opts: { pack: string; workDescription: string }): Record<string, string> {
  const { pack, workDescription } = opts;
  const plugin = { name: pack, version: "0.1.0", description: packDescription(pack), skills: "./skills/" };
  const stubs = { verbs: { work: { engine: "work", description: workDescription } } };
  const manifest = {
    version: 1,
    skills: { enabled: ["mattstack:work", "mattstack:model-tiering"] },
    pipelines: { feature: PIPELINE_STAGES.map((s) => `mattstack:${s}`) },
    bindings: {
      "mattstack:work": { tiering: "mattstack:model-tiering" },
      "mattstack:stage-watch-ci": { forge: "mattstack:ci-forge-gitlab" },
    },
  };
  return {
    ".claude-plugin/plugin.json": JSON.stringify(plugin, null, 2) + "\n",
    "PACK.md": renderPackMd(pack),
    "pack/surface.jsonc":
      "// Public verbs live under skills/; everything else under attachments/.\n" +
      "// Flip a verb with: rt skills surface set <verb> --public\n" +
      JSON.stringify({ public: ["work"] }, null, 2) + "\n",
    "pack/stubs.jsonc":
      "// Verb roster: rt skills compile renders one skill per entry from the named\n" +
      "// mattstack engine. Each description here is a placeholder seeded from the\n" +
      "// engine; rewrite it in your team's words.\n" +
      JSON.stringify(stubs, null, 2) + "\n",
    "pack/skills.jsonc":
      `// ${pack} bindings fragment. rt skills materialize layers it under mattstack's\n` +
      "// defaults and over any base pack into the per-pack file at\n" +
      `// ~/.mattstack/repos/<repo>/packs/${pack}/skills.jsonc. Every domain slot is\n` +
      "// optional; bind one with rt skills bind (see mattstack:extending-a-pack).\n" +
      JSON.stringify(manifest, null, 2) + "\n",
  };
}

function renderPackMd(pack: string): string {
  return [
    `# ${pack} pack`,
    "",
    "Scaffolded by `rt skills init`. The roster (`pack/stubs.jsonc`) names one",
    "verb, `work`, compiled from the mattstack engine with every domain slot",
    "unbound, so `/" + pack + ":work` runs the generic pipeline until the team",
    "adds rules. The verb's description is a placeholder seeded from the",
    "engine; rewrite it in your team's words.",
    "",
    "- Add a rule, a verb, or reword one: `mattstack:extending-a-pack`.",
    "- How this pack came to be: `mattstack:creating-a-pack`.",
    "- Publish a change: `mattstack:editing-skills`.",
    "",
    "`skills/` holds public verbs, `attachments/` the compiled stages and the",
    "team's fills. Compiled files are overwritten by `rt skills compile`; edit",
    "the roster, the fragment, or a fill instead.",
    "",
  ].join("\n");
}

export function addMarketplacePlugin(marketplaceJson: string, pack: string, description: string, source: string): string {
  const parsed = JSON.parse(stripJsonc(marketplaceJson)) as { plugins?: { name?: unknown }[] };
  const plugins = Array.isArray(parsed.plugins) ? parsed.plugins : [];
  if (plugins.some((p) => p?.name === pack)) return marketplaceJson;
  const entry = { name: pack, source, description };
  const edits = modify(marketplaceJson, ["plugins", plugins.length], entry, { ...FORMAT, isArrayInsertion: true });
  return applyEdits(marketplaceJson, edits);
}

function marketplaceSourceOf(marketplaceJson: string, pack: string): unknown {
  const parsed = JSON.parse(stripJsonc(marketplaceJson)) as { plugins?: { name?: unknown; source?: unknown }[] };
  return (Array.isArray(parsed.plugins) ? parsed.plugins : []).find((p) => p?.name === pack)?.source;
}

export type RunResult = { code: number; stdout: string; stderr: string };

export type InitDeps = {
  mayWrite(zone: ZoneInfo, relPath: string): { message: string; why: string } | null;
  fs: InitFs;
  home: string;
  gitRemote(repoDir: string): Promise<{ kind: "ok"; url: string } | { kind: "not-a-repo" } | { kind: "no-remote" }>;
  isTTY: boolean;
  activeTeam(): string | null;
  currentOrg(): string | null;
  promptZone(): Promise<{ name: string; remote: string }>;
  createZone(name: string, remote: string): Promise<{ slug: string; team: string; dir: string }>;
  declareClaim(zone: ZoneInfo, projects: string[]): void;
  engineDescription(engine: string): string | null;
  claude: ((args: string[]) => Promise<RunResult>) | null;
  registerRepo(repoDir: string): Promise<string>;
  materialize(repoName: string, pack: string): Promise<{ ok: boolean; detail: string }>;
  compile(packDir: string, manifestPath: string): Promise<{ ok: boolean; errors: string[] }>;
  check(packDir: string, manifestPath: string): Promise<{ drift: boolean }>;
  /** `paths` are relative to the org clone. */
  sharePack(zone: ZoneInfo, paths: string[]): Promise<PackShare>;
  /** Remembers a share for `rt team publish` to finish if init stops before its own share. */
  rememberShare(zone: ZoneInfo, paths: string[]): void;
};

/** The pack folder plus every other file init wrote, relative to the org clone. */
function sharePathsFor(zone: ZoneInfo, packDir: string, wrote: string[]): string[] {
  return [packDir, ...wrote.filter((path) => !path.startsWith(`${packDir}/`))].map((path) => relative(zone.orgDir, path));
}

export type InitRefusalCode =
  | "not-yours" | "other-org"
  | "not-a-repo" | "no-remote" | "zone-ambiguous" | "zone-missing" | "zone-mismatch" | "zone-no-host"
  | "pack-exists" | "mattstack-missing" | "claude-missing" | "team-marketplace-conflict";

export type FailureCode = "write-failed" | "materialize-failed" | "compile-failed" | "check-drift" | "install-failed";

export type InitRemedy = { commands: string[]; folder?: string };

export type InitOutcome =
  | {
      ok: true;
      pack: { name: string; dir: string; zone: string; marketplace: string };
      repo: { slug: string; manifest: string };
      wrote: string[];
      installed: { plugin: string; version: string };
      restartNeeded: true;
      tryNext: string;
      published: PackShare;
    }
  | { ok: false; refused: true; code: InitRefusalCode; detail: string; next?: string; why?: string }
  | { ok: false; refused: false; code: FailureCode; detail: string; wrote: string[]; remedy?: InitRemedy; why?: string; next?: string };

/** rt declining by rule, drawn as refused; every other refusal code is a missing prerequisite or a usage slip, drawn as a failure. */
export const POLICY_REFUSALS: ReadonlySet<InitRefusalCode> = new Set(["not-yours", "other-org", "pack-exists", "zone-mismatch", "team-marketplace-conflict"]);

/** A missing setting only the user can supply: drawn as needs-you, never as a failure. */
export const NEEDS_YOU_REFUSALS: ReadonlySet<InitRefusalCode> = new Set(["zone-no-host"]);

function refuse(code: InitRefusalCode, detail: string, next?: string, why?: string): InitOutcome {
  return { ok: false, refused: true, code, detail, ...(next ? { next } : {}), ...(why ? { why } : {}) };
}

/** Anchored to the CLI's own "already ..." phrasings so a failing call that merely mentions the word does not read as success. */
function isAlreadyDone(res: RunResult): boolean {
  return /already (on disk|added|installed|exists)/i.test(`${res.stdout}\n${res.stderr}`);
}

async function marketplaceNames(claude: NonNullable<InitDeps["claude"]>): Promise<Set<string> | null> {
  const res = await claude(["plugin", "marketplace", "list", "--json"]);
  if (res.code !== 0) return null;
  try {
    const parsed: unknown = JSON.parse(res.stdout);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.map((m) => (m as { name?: unknown })?.name).filter((n): n is string => typeof n === "string"));
  } catch {
    return null;
  }
}

export async function initPack(opts: { repoDir: string; zone: string | null; team: string | null }, deps: InitDeps): Promise<InitOutcome> {
  const remote = await deps.gitRemote(opts.repoDir);
  if (remote.kind === "not-a-repo") return refuse("not-a-repo", "This folder is not a git repo");
  if (remote.kind === "no-remote") return refuse("no-remote", "This repo has no git remote", "git remote add origin <url>");
  const repo = parseRemote(remote.url);
  if (!repo) return refuse("no-remote", `rt could not read a host and path from the remote ${withoutCredentials(remote.url)}`);

  const workDescription = deps.engineDescription("work");
  if (workDescription === null) {
    return refuse("mattstack-missing", "The mattstack plugin is not installed, so rt cannot read the work engine", "rt setup pack");
  }
  if (!deps.claude) return refuse("claude-missing", "Claude Code is not on your PATH. Install it, then run this again");
  const claude = deps.claude;

  if (opts.team !== null && !TEAM_NAME_RE.test(opts.team)) {
    return refuse("zone-missing", `${opts.team || "An empty name"} is not a team name. A team name is lowercase letters, digits and hyphens, starting with a letter`, "rt skills init --team <name>");
  }
  let orgs = readOrgSlugs(deps.fs, deps.home);
  if (opts.zone !== null && !orgs.includes(opts.zone)) {
    return refuse("zone-missing", `There is no org called ${opts.zone} on this Mac${orgs.length > 0 ? `. Orgs here: ${orgs.join(", ")}` : ""}`);
  }
  let current = deps.currentOrg();
  if (opts.zone !== null && current !== null && opts.zone !== current) {
    return refuse("other-org", `The ${opts.zone} org is not the one this Mac uses`, undefined, `rt works with one org per Mac, and this Mac uses ${current}`);
  }
  const activeRaw = deps.activeTeam();
  const active = activeRaw !== null && TEAM_NAME_RE.test(activeRaw) ? activeRaw : null;
  let wantedTeam = opts.team;
  const wanted = (): ZoneWanted => ({ org: opts.zone, team: wantedTeam, active });
  const currentZones = () => readZones(deps.fs, deps.home).filter((z) => z.org === current);
  let zones = currentZones();
  let choice = chooseZone(zones, repo, wanted());
  if (choice.kind === "missing" && orgs.length === 0) {
    if (!deps.isTTY || opts.team !== null) {
      return refuse("zone-missing", "This Mac has no org yet, so there is no team to hold a pack", `rt team create <name> --remote <url> --first-team ${opts.team ?? "<team>"}`);
    }
    const answer = await deps.promptZone();
    const created = await deps.createZone(answer.name, answer.remote);
    wantedTeam = created.team;
    orgs = readOrgSlugs(deps.fs, deps.home);
    current = deps.currentOrg();
    zones = currentZones();
    choice = chooseZone(zones, repo, wanted());
  }
  if (current === null && orgs.length > 0) {
    const copies = orgs.length === 1 ? `Your copy of the ${orgs[0]} org is` : `Your copies of the ${orgs.join(", ")} orgs are`;
    return refuse("zone-missing", `${copies} not set up yet`, "rt team pull");
  }
  const adminsOnly = "Only an org admin can add a team";
  if (choice.kind === "missing" && wantedTeam === null && zones.length === 0) {
    return refuse("zone-missing", `The ${current ?? orgs[0]} org has no team folders yet, so there is no team to hold a pack`, "rt team add <team> --owner <username>", adminsOnly);
  }
  if (choice.kind === "missing") {
    return wantedTeam
      ? refuse("zone-missing", `There is no team called ${wantedTeam}`, `rt team add ${wantedTeam} --owner <username>`, adminsOnly)
      : refuse("zone-missing", `No team on ${repo.host} is free for a new pack`, "rt team add <team> --owner <username>", adminsOnly);
  }
  if (choice.kind === "ambiguous") {
    return refuse("zone-ambiguous", `More than one team could hold this pack: ${choice.zones.map((z) => z.team).join(", ")}`, "rt skills init --team <name>");
  }
  if (choice.kind === "mismatch") {
    return refuse("zone-mismatch", `The ${choice.zone.team} team is on ${choice.zone.host}, but this repo is on ${repo.host}`);
  }
  const zone = choice.zone;
  const pack = zone.team;
  const packDir = zonePackDir(zone);
  if (packIsCompiled(deps.fs, packDir)) {
    return refuse("pack-exists", "This team already has a pack, and rt never changes an existing pack. To add to it, use the mattstack:extending-a-pack skill");
  }
  const packSource = teamPackSource(zone.team);
  const marketOnDiskEarly = deps.fs.readFile(join(zone.orgDir, ".claude-plugin", "marketplace.json"));
  const entryThere = marketOnDiskEarly !== null && addMarketplacePlugin(marketOnDiskEarly, pack, packDescription(pack), packSource) === marketOnDiskEarly;
  for (const relPath of [`mattstack/teams/${zone.team}`, ...(entryThere ? [] : [".claude-plugin/marketplace.json"])]) {
    const refusal = deps.mayWrite(zone, relPath);
    if (refusal) return refuse("not-yours", `${refusal.message}. ${refusal.why}`);
  }
  if (entryThere && marketplaceSourceOf(marketOnDiskEarly, pack) !== packSource) {
    return refuse("team-marketplace-conflict", `Your org's marketplace points ${pack} at another pack`, undefined, "Ask an org admin to correct its source, then try again.");
  }
  if (zone.host === null) {
    return refuse("zone-no-host", `The ${zone.team} team has no forge host set, so rt cannot tell which host this repo is on`, `rt settings set board.gitlabHost '"${repo.host}"' --scope team --team ${zone.team}`);
  }
  const marketplace = zone.marketplace ?? zone.org;
  const pluginId = `${pack}@${marketplace}`;

  const wrote: string[] = [];

  const share = `rt team publish --team ${zone.org}`;
  const remedyFor = (code: FailureCode): InitRemedy => {
    if (code === "write-failed") return { commands: ["rt skills init"], folder: packDir };
    if (code === "materialize-failed") return { commands: [`rt skills materialize --dir ${opts.repoDir}`, share] };
    if (code === "compile-failed" || code === "check-drift") {
      return { commands: [`rt skills compile --pack-dir ${packDir}`, `rt skills check --pack-dir ${packDir}`, share] };
    }
    return { commands: [`claude plugin marketplace add ${zone.orgDir}`, `claude plugin install ${pluginId}`, share] };
  };

  const failed = (code: FailureCode, detail: string, from?: { why?: string; next?: string }): InitOutcome => ({
    ok: false, refused: false, code, detail, wrote, remedy: remedyFor(code),
    ...(from?.why ? { why: from.why } : {}),
    ...(from?.next ? { next: from.next } : {}),
  });

  /** A daemon-backed dep can throw instead of returning a failure shape; the throw must still carry `wrote` forward, same as a returned failure. */
  const attempt = async <T>(code: FailureCode, fn: () => Promise<T>): Promise<{ value: T } | { outcome: InitOutcome }> => {
    try {
      return { value: await fn() };
    } catch (err) {
      if (err instanceof UserActionableError) {
        logFailureDetail(err);
        return { outcome: failed(code, err.message, { why: err.why, next: err.next }) };
      }
      return { outcome: failed(code, err instanceof Error ? err.message : String(err)) };
    }
  };

  try {
    for (const [rel, text] of Object.entries(renderPackFiles({ pack, workDescription }))) {
      const full = join(packDir, rel);
      if (deps.fs.exists(full)) continue;
      deps.fs.mkdirp(join(full, ".."));
      deps.fs.writeFile(full, text);
      wrote.push(full);
    }
    if (!zone.projects.includes(repo.path)) {
      deps.declareClaim(zone, [...zone.projects, repo.path]);
      wrote.push(join(zone.dir, "settings.team.jsonc"));
    }
    const marketPath = join(zone.orgDir, ".claude-plugin", "marketplace.json");
    const marketOnDisk = deps.fs.readFile(marketPath);
    const marketBefore = marketOnDisk ?? JSON.stringify({ name: marketplace, owner: { name: zone.org }, plugins: [] }, null, 2) + "\n";
    const marketAfter = addMarketplacePlugin(marketBefore, pack, packDescription(pack), packSource);
    if (marketAfter !== marketOnDisk) {
      deps.fs.mkdirp(join(zone.orgDir, ".claude-plugin"));
      deps.fs.writeFile(marketPath, marketAfter);
      wrote.push(marketPath);
    }
    deps.rememberShare(zone, sharePathsFor(zone, packDir, wrote));
  } catch (err) {
    return failed("write-failed", err instanceof Error ? err.message : String(err));
  }

  const registered = await attempt("materialize-failed", () => deps.registerRepo(opts.repoDir));
  if ("outcome" in registered) return registered.outcome;
  const materializedAttempt = await attempt("materialize-failed", () => deps.materialize(registered.value, pack));
  if ("outcome" in materializedAttempt) return materializedAttempt.outcome;
  const materialized = materializedAttempt.value;
  const manifestPath = packManifestPath(join(deps.home, ".mattstack"), repo.slug, pack);
  if (!materialized.ok || !deps.fs.exists(manifestPath)) {
    return failed("materialize-failed", `${materialized.detail}. rt expected the bindings file at ${manifestPath}`);
  }
  const compiledAttempt = await attempt("compile-failed", () => deps.compile(packDir, manifestPath));
  if ("outcome" in compiledAttempt) return compiledAttempt.outcome;
  const compiled = compiledAttempt.value;
  if (!compiled.ok) return failed("compile-failed", compiled.errors.join("\n"));
  const checkedAttempt = await attempt("check-drift", () => deps.check(packDir, manifestPath));
  if ("outcome" in checkedAttempt) return checkedAttempt.outcome;
  if (checkedAttempt.value.drift) return failed("check-drift", "The pack was out of date right after it compiled");

  const known = await attempt("install-failed", () => marketplaceNames(claude));
  if ("outcome" in known) return known.outcome;
  if (!known.value || !known.value.has(marketplace)) {
    const added = await attempt("install-failed", () => claude(["plugin", "marketplace", "add", zone.orgDir]));
    if ("outcome" in added) return added.outcome;
    if (added.value.code !== 0 && !isAlreadyDone(added.value)) {
      return failed("install-failed", `Adding the team's marketplace to Claude Code failed (exit ${added.value.code}): ${added.value.stderr.trim() || added.value.stdout.trim()}`);
    }
  }
  const installed = await attempt("install-failed", () => claude(["plugin", "install", pluginId]));
  if ("outcome" in installed) return installed.outcome;
  if (installed.value.code !== 0 && !isAlreadyDone(installed.value)) {
    return failed("install-failed", `Installing ${pluginId} in Claude Code failed (exit ${installed.value.code}): ${installed.value.stderr.trim() || installed.value.stdout.trim()}`);
  }

  const published = await deps.sharePack(zone, sharePathsFor(zone, packDir, wrote));

  return {
    ok: true,
    pack: { name: pack, dir: packDir, zone: zone.slug, marketplace },
    repo: { slug: repo.slug, manifest: manifestPath },
    wrote,
    installed: { plugin: pluginId, version: "0.1.0" },
    restartNeeded: true,
    tryNext: `/${pack}:work <ticket>`,
    published,
  };
}
