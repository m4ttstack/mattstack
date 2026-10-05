import { sameUser } from "../../packages/rt-client/src/settings/active-team.ts";
import { parse, parseTree, printParseErrorCode, type Node, type ParseError } from "jsonc-parser";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";

export interface ConvertInput {
  files: Record<string, string>;
  packs: string[];
  hasSecrets: boolean;
}

export interface ConvertOpts {
  org: string;
  admin: string;
  team?: string;
  teamRepos?: string[];
}

export interface ConvertPlan {
  team: string;
  writes: Record<string, string>;
  moves: [from: string, to: string][];
  deletes: string[];
  report: string[];
  rosterUsernames: string[];
}

type Json = Record<string, unknown>;

const ORG_KEYS = new Set([
  "board.gitlabHost",
  "mattstack.integrations",
  "board.botUsernames",
  "boxscore.botPatterns",
  "board.projects",
  "mattstack.tracking",
  "claude.marketplaces",
  "mattstack.roster",
]);
const SLACK_ORG_FIELDS = new Set(["appId", "clientId", "callbackPort"]);
const ORG_HEADER = "// mattstack org settings, shared by every team. JSONC: comments and trailing commas are fine.\n";
const TEAM_HEADER = "// mattstack team settings. JSONC: comments and trailing commas are fine.\n";

/** The file's object, `{}` when the file is absent. A file that is there but does not parse stops the conversion: splitting what could be read and deleting the original would lose the rest. */
function objOf(files: Record<string, string>, rel: string): Json {
  const text = files[rel];
  if (text === undefined) return {};
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) throw new Error(`${rel} is not valid JSONC (${printParseErrorCode(errors[0]!.error)} at offset ${errors[0]!.offset}); fix it before converting`);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${rel} is not a JSON object; fix it before converting`);
  const check = (node: Node): void => {
    if (node.type === "object") {
      const seen = new Set<string>();
      for (const property of node.children ?? []) {
        const key = String(property.children?.[0]?.value);
        if (seen.has(key)) throw new Error(`${rel} has a duplicate key ${key}; fix it before converting`);
        seen.add(key);
      }
    }
    for (const child of node.children ?? []) check(child);
  };
  check(parseTree(text)!);
  return value as Json;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bumpPatch(version: unknown): string {
  const m = typeof version === "string" ? /^(\d+)\.(\d+)\.(\d+)$/.exec(version) : null;
  if (!m) throw new Error(`The team pack's version (${String(version)}) is not x.y.z, so the script cannot bump it`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

function rewritePaths(value: unknown, swaps: [string, string][], note: (from: string, to: string) => void): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const [from, to] of swaps) {
      // A folder name, not a prefix: `packs/acme` must not match inside `packs/acme-base`.
      const whole = new RegExp(`${escapeRegExp(from)}(?![A-Za-z0-9._-])`, "g");
      const next = out.replace(whole, () => to);
      if (next !== out) {
        note(out, next);
        out = next;
      }
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => rewritePaths(item, swaps, note));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, rewritePaths(v, swaps, note)]));
  }
  return value;
}

function rewriteSopsRules(text: string): { text?: string; needsReview: boolean } {
  const doc = parseDocument(text);
  if (doc.errors.length > 0 || !isMap(doc.contents)) return { needsReview: true };
  const rules = doc.contents.get("creation_rules", true);
  if (!isSeq(rules)) return { needsReview: true };
  let updated = false;
  let needsReview = rules.items.length === 0;
  for (const rule of rules.items) {
    const path = isMap(rule) ? rule.get("path_regex", true) : undefined;
    if (!isScalar(path) || typeof path.value !== "string" || !/^\^?mattstack\/secrets\//.test(path.value)) {
      needsReview = true;
      continue;
    }
    path.value = path.value.replaceAll("mattstack/secrets/", "mattstack/org/secrets/");
    updated = true;
  }
  return { ...(updated ? { text: doc.toString() } : {}), needsReview };
}

export function planConversion(input: ConvertInput, opts: ConvertOpts): ConvertPlan {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(opts.org)) throw new Error("Choose a safe org folder name");
  if (opts.admin.trim() === "") throw new Error("Choose the admin's forge username");
  for (const pack of input.packs) {
    if (!/^[a-z][a-z0-9-]*$/.test(pack)) throw new Error(`The pack name ${pack} is not a safe team name`);
    objOf(input.files, `mattstack/packs/${pack}/.claude-plugin/plugin.json`);
  }
  const marker = objOf(input.files, "mattstack/mattstack.jsonc");
  if (marker.role === "org") throw new Error("This clone already has the org layout; there is nothing to convert");
  if (marker.role !== "team") throw new Error("This is not a mattstack team repo (mattstack/mattstack.jsonc does not say role: team)");

  const isBase = (pack: string) => objOf(input.files, `mattstack/packs/${pack}/pack/skills.jsonc`).base === true;
  const teamPacks = input.packs.filter((pack) => !isBase(pack));
  if (teamPacks.length !== 1) throw new Error(`The script converts one team, so it needs exactly one team pack; found ${teamPacks.length} (${teamPacks.join(", ") || "none"})`);
  const pack = teamPacks[0]!;
  if (opts.team !== undefined && opts.team !== pack) throw new Error(`The team has to be named "${pack}", after its pack, so plugin ids do not change`);
  const team = pack;

  const report: string[] = [];
  const old = objOf(input.files, "mattstack/settings.team.jsonc");
  const shim = objOf(input.files, "mattstack/team.jsonc");
  const { repos: oldRepos, $migrated: oldBaselines, ...global } = old as Json & { repos?: Json; $migrated?: Json };
  for (const key of ["repos", "$migrated"]) {
    const value = old[key];
    if (value !== undefined && (value === null || typeof value !== "object" || Array.isArray(value))) throw new Error(`${key} in the old store is not a JSON object`);
  }
  for (const key of ["mattstack.roster", "board.members"]) {
    const value = global[key];
    if (value !== undefined && (!Array.isArray(value) || value.some((entry) => entry === null || typeof entry !== "object" || Array.isArray(entry) || typeof entry.username !== "string" || entry.username.trim() === ""))) throw new Error(`${key} in the old store must list members with forge usernames`);
  }

  if (global["board.projects"] === undefined && Array.isArray(shim.projects)) {
    global["board.projects"] = shim.projects;
    report.push("board.projects was only in team.jsonc; copied to the org");
  }
  if (global["board.gitlabHost"] === undefined && typeof shim.gitlabHost === "string") {
    global["board.gitlabHost"] = shim.gitlabHost.replace(/^https?:\/\//, "").split("/")[0]!.toLowerCase();
    report.push("board.gitlabHost was only in team.jsonc; copied to the org");
  }

  const market = objOf(input.files, ".claude-plugin/marketplace.json");
  if (market.plugins !== undefined && (!Array.isArray(market.plugins) || market.plugins.some((entry) => entry === null || typeof entry !== "object" || Array.isArray(entry)))) throw new Error("The marketplace plugins must be a list of JSON objects");
  const marketName = typeof market.name === "string" ? market.name : opts.org;
  const ownPlugin = `${pack}@${marketName}`;

  const org: Json = {};
  const teamStore: Json = {};
  for (const [key, value] of Object.entries(global)) {
    if (key === "board.members") continue;
    if (key === "claude.plugins" && Array.isArray(value)) {
      const mine = value.filter((p) => p === ownPlugin);
      const shared = value.filter((p) => p !== ownPlugin);
      if (shared.length > 0) org[key] = shared;
      if (mine.length > 0) teamStore[key] = mine;
      continue;
    }
    if (key === "board.slack" && value !== null && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value as Json);
      const atOrg = Object.fromEntries(entries.filter(([field]) => SLACK_ORG_FIELDS.has(field)));
      const atTeam = Object.fromEntries(entries.filter(([field]) => !SLACK_ORG_FIELDS.has(field)));
      if (Object.keys(atOrg).length > 0) org[key] = atOrg;
      if (Object.keys(atTeam).length > 0) teamStore[key] = atTeam;
      continue;
    }
    (ORG_KEYS.has(key) ? org : teamStore)[key] = value;
  }

  const roster: Json[] = (Array.isArray(global["mattstack.roster"]) ? (global["mattstack.roster"] as Json[]) : []).map((entry) => ({ ...entry, teams: [team] }));
  const has = (username: string) => roster.some((entry) => typeof entry.username === "string" && sameUser(entry.username, username));
  for (const member of Array.isArray(global["board.members"]) ? (global["board.members"] as Json[]) : []) {
    if (typeof member.username !== "string") continue;
    const { hidden, username, ...rest } = member;
    if (hidden === true) report.push(`board.members hid ${username}; the roster has no hidden flag, so ${username} shows in the apps until someone hides them there`);
    const at = roster.findIndex((entry) => typeof entry.username === "string" && sameUser(entry.username, username as string));
    // board.members sometimes carries a name or a key the roster entry lacks; the roster's own value wins where both have one.
    if (at === -1) roster.push({ username, ...rest, teams: [team] });
    else {
      const key = member.agePublicKey;
      if (typeof key === "string" && key.trim() !== "" && Object.hasOwn(roster[at]!, "agePublicKey") && key !== roster[at]!.agePublicKey && !roster.some((entry) => typeof entry.username === "string" && sameUser(entry.username, username) && entry.agePublicKey === key)) {
        report.push(`warning: ${username}'s board-only age key ${key} differs from the roster; inspect and revoke that recipient if needed, because member removal cannot find it automatically`);
      }
      roster[at] = { ...rest, ...roster[at] };
    }
  }
  if (!has(opts.admin)) roster.push({ username: opts.admin, teams: [team] });
  org["mattstack.roster"] = roster;
  org["mattstack.org"] = { admins: [opts.admin], teams: { [team]: { owners: [opts.admin] } } };

  const teamRepos = new Set(opts.teamRepos ?? []);
  const orgRepos: Json = {};
  const ownRepos: Json = {};
  for (const [identity, section] of Object.entries(oldRepos ?? {})) (teamRepos.has(identity) ? ownRepos : orgRepos)[identity] = section;
  if (Object.keys(orgRepos).length > 0) org.repos = orgRepos;
  if (Object.keys(ownRepos).length > 0) teamStore.repos = ownRepos;

  if (oldBaselines !== undefined) {
    const baseKey = (name: string) => name.replace(/@\d+$/, "");
    const split = (store: Json) => Object.fromEntries(Object.entries(oldBaselines).filter(([name]) => baseKey(name) in store));
    const orgBaselines = split(org);
    const teamBaselines = split(teamStore);
    if (Object.keys(orgBaselines).length > 0) org.$migrated = orgBaselines;
    if (Object.keys(teamBaselines).length > 0) teamStore.$migrated = teamBaselines;
  }

  const clone = `\${team:${opts.org}}/mattstack`;
  const swaps: [string, string][] = [
    [`${clone}/packs/${pack}`, `${clone}/teams/${team}/packs/${team}`],
    ...input.packs.filter(isBase).map((base): [string, string] => [`${clone}/packs/${base}`, `${clone}/org/packs/${base}`]),
    [`${clone}/secrets`, `${clone}/org/secrets`],
  ];
  const noteRewrite = (from: string, to: string) => report.push(`rewrote ${from} to ${to}`);
  const orgOut = rewritePaths(org, swaps, noteRewrite) as Json;
  const teamOut = rewritePaths(teamStore, swaps, noteRewrite) as Json;

  for (const key of Object.keys(orgOut)) if (key !== "repos" && key !== "$migrated") report.push(`org: ${key}`);
  for (const identity of Object.keys(orgRepos)) report.push(`org: repo section ${identity}`);
  for (const key of Object.keys(teamOut)) if (key !== "repos" && key !== "$migrated") report.push(`team ${team}: ${key}`);
  for (const identity of Object.keys(ownRepos)) report.push(`team ${team}: repo section ${identity}`);
  if (Array.isArray(global["board.members"])) report.push("board.members: retired; its usernames are on the roster");

  const rosterUsernames = roster.map((entry) => String(entry.username));
  report.push(`roster usernames to confirm as forge logins: ${rosterUsernames.join(", ")}`);

  const writes: Record<string, string> = {
    "mattstack/mattstack.jsonc": `${JSON.stringify({ role: "org", org: opts.org }, null, 2)}\n`,
    "mattstack/org/settings.org.jsonc": `${ORG_HEADER}${JSON.stringify(orgOut, null, 2)}\n`,
    [`mattstack/teams/${team}/settings.team.jsonc`]: `${TEAM_HEADER}${JSON.stringify(teamOut, null, 2)}\n`,
  };
  const moves: [string, string][] = [];
  const deletes = ["mattstack/settings.team.jsonc"];
  if (input.files["mattstack/team.jsonc"] !== undefined) deletes.push("mattstack/team.jsonc");

  if (input.hasSecrets) moves.push(["mattstack/secrets", "mattstack/org/secrets"]);
  const sops = input.files[".sops.yaml"];
  if (sops !== undefined) {
    const rewritten = rewriteSopsRules(sops);
    if (rewritten.text !== undefined) writes[".sops.yaml"] = rewritten.text;
    if (rewritten.needsReview) report.push("warning: .sops.yaml contains unresolved creation rules; fix its path_regex by hand");
  } else if (input.hasSecrets) report.push("warning: .sops.yaml is missing; add its secrets creation rule before publishing");
  const ignore = input.files[".gitignore"];
  if (ignore?.includes("mattstack/secrets/")) writes[".gitignore"] = ignore.split("mattstack/secrets/").join("mattstack/org/secrets/");

  const packTo = `mattstack/teams/${team}/packs/${team}`;
  moves.push([`mattstack/packs/${pack}`, packTo]);
  for (const base of input.packs.filter(isBase)) moves.push([`mattstack/packs/${base}`, `mattstack/org/packs/${base}`]);

  const manifest = objOf(input.files, `mattstack/packs/${pack}/.claude-plugin/plugin.json`);
  writes[`${packTo}/.claude-plugin/plugin.json`] = `${JSON.stringify({ ...manifest, version: bumpPatch(manifest.version) }, null, 2)}\n`;

  const marketSwaps: [string, string][] = moves.filter(([from]) => from.startsWith("mattstack/packs/")).map(([from, to]) => [`./${from}`, `./${to}`]);
  const plugins = (Array.isArray(market.plugins) ? (market.plugins as Json[]) : []).map((entry) => entry.name === pack ? { ...entry, source: `./${packTo}` } : { ...entry, ...(typeof entry.source === "string" ? { source: rewritePaths(entry.source, marketSwaps, noteRewrite) } : {}) });
  writes[".claude-plugin/marketplace.json"] = `${JSON.stringify({ ...market, plugins }, null, 2)}\n`;

  return { team, writes, moves, deletes, report, rosterUsernames };
}
