# Org admin-only secrets (plan 4 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the switchboard admin token from one Mac's local rt secrets into an org file only the org's owners and admins can open, keep that file locked to exactly them as roles change, and make every reader of the token look there first.

**Architecture:** `lib/secrets/team-store.ts` grows from one `.sops.yaml` creation rule to exactly two: the existing members rule (`mattstack/org/secrets/.*`) and a new admins rule (`mattstack/org/admin-secrets/.*`). Recipients, writes and re-encryption all take the rule. A new `lib/team/admin-secrets.ts` derives the admins rule's recipients from the org store (roles plus the roster's age keys) and brings the rule, the file and the token in line; `rt team admin-secrets`, `rt team members sync` and `rt team members remove` run it, and a setup row asks for it when it drifts. The token's readers (invite, join, board peering, `rt team peer`, the `account.board-peering` row) read the admin-only file first and the local secret second.

**Tech Stack:** Bun, TypeScript, bun:test, sops + age (through the existing `SecretsSeams`; the age private key only ever crosses into sops as `SOPS_AGE_KEY`).

**Spec:** `docs/superpowers/specs/2026-10-15-org-data-branch-and-roles-design.md`, section "Forge access", subsections "Admin-only secrets" and "Demotion and removal" (the secrets half only). Plan 1 (`docs/superpowers/plans/2026-10-15-org-roles.md`) is merged before this runs; plans 2 and 3 run in parallel with this one in other worktrees.

## Global Constraints

- No em dashes or en dashes anywhere: code, comments, copy, docs, commit messages.
- This repo is public: placeholders only (`acme`, `widgets`, `dev1`, `dev2`, `age1dev1`), never a real company, person, repo or key.
- Every person-facing sentence follows the output layer rules (`.claude/rules/output-layer.md`): plain copy, the command to run in `next` (or as the last words of a manual-step string), a refusal by policy is `refused`, never `failed`. `--json` goes through `out.json`/`deps.print(JSON.stringify(envelope(...)))`; no existing envelope gains or loses a key.
- The age private key is never written to disk. Every sops call gets it through `sopsAgeKeyEnv` (`lib/secrets/store.ts`); tests fake the keychain through an `AgeKeySeam`, never a key file.
- Run bun tests from the repo root (`bun test <path>`), never from a subdirectory. Typecheck with `bun run typecheck`.
- Consumes from plan 1: `OrgRoles.owners` (`packages/rt-client/src/settings/active-team.ts`), `roleOf` returning `{ kind: "org-owner" }`, and `isOrgAdmin(role)` (`packages/rt-client/src/settings/org-roles.ts`). "Owners and admins" always means `isOrgAdmin(roleOf(username, roles))`; never an inline `kind === "admin"` test.
- Parallel-plan boundaries: plan 2 also edits `lib/team/invite.ts` and `lib/team/join.ts`, only their clone and branch logic (the `main` hard-coding and the clone command). This plan touches only the token-reading code in those two files: the seams interfaces, the real-seams factories, the token read in `mintInvite`, and `peerBoard`. Do not touch `lib/daemon/home-snapshot.ts`, `lib/team/org-marker.ts` or `lib/team/forge.ts`. Plan 3 may edit `membersRemove`'s forge-access lines in `lib/team/members.ts` and the membership gate in `commands/team.ts`; keep this plan's hunks in those files to the lines each task names.
- Plan 2 (running in parallel) adds `mattstack/org/admin-secrets/*.tmp` to `.gitignore` in `rt team create`'s scaffold and the data branch conversion script, so the sops temporary files this plan's writes create are never committed. This plan does not edit `.gitignore` or `lib/team/create.ts`.
- The switchboard rule (`.claude/rules/team-switchboard.md`): invite, join, peer and the `account.board-peering` row change together. Tasks 4, 5 and 6 land in the same PR, and Task 10 (the board's reader through the daemon) lands with them.
- From the spec, verbatim in effect: the admin-only file lives under `mattstack/org/admin-secrets/` with its own `.sops.yaml` creation rule whose recipients are the org owners' and admins' age keys; the existing org secrets (`mattstack/org/secrets/`, every member a recipient) are unchanged; per-team secrets are out of scope.
- An admins rule is written only from roster age keys (`agePublicKey` on a `mattstack.roster` entry); a key not on the roster is never added by rt.
- `TeamSopsYamlHandEditedError` still refuses any `.sops.yaml` holding a rule rt did not write, a third rule, or one rule twice.
- Commit after each task with only the files that task touched.

## Review Focus

1. A Mac that is not an owner or admin reads the admin-only file as absent: a sops key mismatch is `null`, with no warning shown and no failure, and the reader falls through to the local secret. (Task 2 tests `readAdminSecret`; Task 4 tests the fall-through.)
2. An older rt on another admin's Mac reads only the first `age:` line of `.sops.yaml`. With both rules written, that first line must be the members rule, so an older rt still sees the right member recipients. (Task 1 test.)
3. A re-encryption that fails part way through the admin-only files restores the admins rule to exactly what it was, including "no admins rule at all". (Task 3 tests.)
4. Removing a member who is an admin locks the admin-only files away from them even though the org store's `admins` list still names them. (Task 7 test.)
5. Running `rt team admin-secrets` twice in a row changes nothing the second time: no `.sops.yaml` write, no `sops updatekeys`, no `sops -e`, so the daemon's auto-commit has nothing to push. (Task 3 test.)

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `lib/rt-paths.ts` | `orgAdminSecretsDir(org)` | 1 |
| `lib/home/age-key.ts` | `renderSopsYamlRules`, the one renderer of creation rules | 1 |
| `lib/secrets/team-store.ts` | owns both rules; admin-only file read and write | 1, 2 |
| `lib/secrets/__tests__/team-fakes.ts` (new) | the team-store fakes, shared | 1 |
| `lib/team/admin-secrets.ts` (new) | who the admins rule names; `syncAdminSecrets` | 3 |
| `lib/team/board-peers.ts` | `readAdminToken` and `readStoredAdminToken` read the admin-only file; `realReadAdminSecret` | 4, 10 |
| `lib/team/peer.ts`, `lib/team/members.ts`, `commands/team.ts` | pass the org and the admin reader through | 4, 7, 9 |
| `lib/team/invite.ts`, `lib/team/join.ts`, `lib/setup/steps/team.ts` | invite and join read the admin-only file first | 5 |
| `lib/setup/validators/accounts.ts`, `lib/setup/plan.ts` | the board-peering row sees the admin-only file | 6, 8 |
| `lib/setup/validators/admin-secrets.ts` (new) | the `org.admin-secrets` drift row | 8 |
| `lib/command-tree-def.ts`, `website/docs/rt/reference/team/` | `rt team admin-secrets` | 9 |
| `.claude/rules/team-switchboard.md` | the rule, updated | 9, 10 |
| `lib/daemon/handlers/secrets.ts` | the board's admin token, admin-only file first | 10 |

---

### Task 1: team-store owns two creation rules

**Files:**
- Modify: `lib/rt-paths.ts:250-252` (add `orgAdminSecretsDir` after `orgSecretsDir`)
- Modify: `lib/home/age-key.ts:216-226` (`renderSopsYamlFor` and its doc comment)
- Modify: `lib/secrets/team-store.ts` (module doc lines 29-33, `TeamSopsYamlHandEditedError` lines 71-79, `TEAM_PATH_REGEX` line 104, `ruleCount` lines 153-156, `parseAgeRecipients`, `readTeamRecipients` lines 175-180, `writeTeamRecipients` lines 182-203, `listTeamDomainFiles` lines 257-264, `reencryptTeamSecrets` lines 266-304)
- Create: `lib/secrets/__tests__/team-fakes.ts`
- Modify: `lib/secrets/__tests__/team-store.test.ts` (move the fakes out, add tests)

**Interfaces:**
- Produces:
  - `orgAdminSecretsDir(org: string): string` in `lib/rt-paths.ts` (`<orgDir>/mattstack/org/admin-secrets`)
  - `renderSopsYamlRules(rules: { pathRegex: string; recipients: string[] }[]): string` in `lib/home/age-key.ts`
  - In `lib/secrets/team-store.ts`: `type TeamSopsRule = "members" | "admins"`; `ADMIN_PATH_REGEX = "mattstack/org/admin-secrets/.*"`; `interface SopsRule { pathRegex: string; recipients: string[] }`; `parseSopsRules(content: string): SopsRule[] | null`; `readTeamRecipients(slug, seams, rule: TeamSopsRule = "members"): string[]`; `writeTeamRecipients(slug, recipients, seams, rule: TeamSopsRule = "members"): void`; `listRuleFiles(slug: string, seams: SecretsSeams, rule: TeamSopsRule): string[]`; `reencryptTeamSecrets(slug, seams, probes = createRealProbes(), rule: TeamSopsRule = "members"): Promise<string[]>`
  - In `lib/secrets/__tests__/team-fakes.ts`: `FakeTeamExecSeam`, `fakeAgeKeySeamWithKey(key)`, `fakeAgeKeySeamAbsent()`, `seamsWithKey(key?, slug?)`, `teamCloneRootFor(slug)`, all exported unchanged from today's `team-store.test.ts`.

- [ ] **Step 1: Move the fakes into a shared file**

Create `lib/secrets/__tests__/team-fakes.ts` holding, verbatim and with `export` added, these definitions from `lib/secrets/__tests__/team-store.test.ts`: `teamCloneRootFor` (lines 49-51), `fakeAgeKeySeamWithKey` (53-62), `fakeAgeKeySeamAbsent` (64-70), `type Call` (72), the `FakeTeamExecSeam` class with its doc comment (74-191) and `seamsWithKey` with its doc comment (192-197). Its imports:

```ts
import { join } from "path";
import type { AgeExecResult, AgeKeySeam } from "../../home/age-key.ts";
import { orgsDir } from "../../rt-paths.ts";
import type { SecretsExecResult, SecretsExecSeam, SecretsSeams } from "../store.ts";
```

In `team-store.test.ts`, delete those definitions and import them:

```ts
import { FakeTeamExecSeam, fakeAgeKeySeamAbsent, fakeAgeKeySeamWithKey, seamsWithKey, teamCloneRootFor } from "./team-fakes.ts";
```

Drop imports the test file no longer uses (`AgeExecResult`, `AgeKeySeam`, `SecretsExecResult`, `SecretsExecSeam` if unused; `bun run typecheck` names them).

Run: `bun test lib/secrets/__tests__/team-store.test.ts`
Expected: PASS, same count as before.

- [ ] **Step 2: Write the failing tests**

Add to `team-store.test.ts` (import `ADMIN_PATH_REGEX`, `listRuleFiles`, `parseSopsRules` from `../team-store.ts` and `renderSopsYamlFor` from `../../home/age-key.ts`):

```ts
describe("the members and admins rules", () => {
  const twoRules = [
    "creation_rules:",
    "  - path_regex: mattstack/org/secrets/.*",
    "    age: age1aaa,age1bbb",
    "  - path_regex: mattstack/org/admin-secrets/.*",
    "    age: age1aaa",
    "",
  ].join("\n");

  test("with only the members rule, the file is byte for byte what rt wrote before", () => {
    const { execSeam, seams } = seamsWithKey();
    writeTeamRecipients("acme", ["age1bbb", "age1aaa"], seams);
    expect(execSeam.readFile(teamSopsYamlPath("acme"))).toBe(renderSopsYamlFor(TEAM_PATH_REGEX, ["age1aaa", "age1bbb"]));
  });

  test("writing the admins rule keeps the members rule and writes it first", () => {
    const { execSeam, seams } = seamsWithKey();
    writeTeamRecipients("acme", ["age1aaa", "age1bbb"], seams);
    writeTeamRecipients("acme", ["age1aaa"], seams, "admins");
    expect(execSeam.readFile(teamSopsYamlPath("acme"))).toBe(twoRules);
  });

  test("writing the members rule keeps the admins rule", () => {
    const { execSeam, seams } = seamsWithKey();
    execSeam.writeFile(teamSopsYamlPath("acme"), twoRules);
    writeTeamRecipients("acme", ["age1aaa", "age1bbb", "age1ccc"], seams);
    expect(readTeamRecipients("acme", seams)).toEqual(["age1aaa", "age1bbb", "age1ccc"]);
    expect(readTeamRecipients("acme", seams, "admins")).toEqual(["age1aaa"]);
  });

  test("each rule reads its own recipients", () => {
    const { execSeam, seams } = seamsWithKey();
    execSeam.writeFile(teamSopsYamlPath("acme"), twoRules);
    expect(readTeamRecipients("acme", seams, "members")).toEqual(["age1aaa", "age1bbb"]);
    expect(readTeamRecipients("acme", seams, "admins")).toEqual(["age1aaa"]);
  });

  test("an empty admins rule is dropped, not written with no recipients", () => {
    const { execSeam, seams } = seamsWithKey();
    execSeam.writeFile(teamSopsYamlPath("acme"), twoRules);
    writeTeamRecipients("acme", [], seams, "admins");
    expect(execSeam.readFile(teamSopsYamlPath("acme"))).toBe(renderSopsYamlFor(TEAM_PATH_REGEX, ["age1aaa", "age1bbb"]));
    expect(readTeamRecipients("acme", seams, "admins")).toEqual([]);
  });

  test("the first age line names the members rule, which is all an older rt reads", () => {
    const { execSeam, seams } = seamsWithKey();
    writeTeamRecipients("acme", ["age1aaa", "age1bbb"], seams);
    writeTeamRecipients("acme", ["age1aaa"], seams, "admins");
    expect(execSeam.readFile(teamSopsYamlPath("acme")).match(/age:\s*(\S+)/)?.[1]).toBe("age1aaa,age1bbb");
  });

  test("a rule rt did not write is refused, even when it is the only one", () => {
    const { execSeam, seams } = seamsWithKey();
    const foreign = "creation_rules:\n  - path_regex: other/.*\n    age: age1aaa\n";
    execSeam.writeFile(teamSopsYamlPath("acme"), foreign);
    expect(() => writeTeamRecipients("acme", ["age1bbb"], seams)).toThrow(TeamSopsYamlHandEditedError);
    expect(execSeam.readFile(teamSopsYamlPath("acme"))).toBe(foreign);
  });

  test("one rule written twice, or a list entry rt cannot read, is refused", () => {
    const { execSeam, seams } = seamsWithKey();
    const twice = `${twoRules}  - path_regex: mattstack/org/admin-secrets/.*\n    age: age1bbb\n`;
    execSeam.writeFile(teamSopsYamlPath("acme"), twice);
    expect(() => writeTeamRecipients("acme", ["age1aaa"], seams, "admins")).toThrow(TeamSopsYamlHandEditedError);
    const ageFirst = "creation_rules:\n  - age: age1aaa\n    path_regex: mattstack/org/secrets/.*\n";
    execSeam.writeFile(teamSopsYamlPath("acme"), ageFirst);
    expect(() => writeTeamRecipients("acme", ["age1aaa"], seams)).toThrow(TeamSopsYamlHandEditedError);
  });

  test("a hand-edited single rule still reads the way it did, for the members rule only", () => {
    const { execSeam, seams } = seamsWithKey();
    execSeam.writeFile(teamSopsYamlPath("acme"), "creation_rules:\n  - path_regex: other/.*\n    age: age1aaa\n");
    expect(readTeamRecipients("acme", seams)).toEqual(["age1aaa"]);
    expect(readTeamRecipients("acme", seams, "admins")).toEqual([]);
  });

  test("parseSopsRules returns every rule in file order", () => {
    expect(parseSopsRules(twoRules)).toEqual([
      { pathRegex: TEAM_PATH_REGEX, recipients: ["age1aaa", "age1bbb"] },
      { pathRegex: ADMIN_PATH_REGEX, recipients: ["age1aaa"] },
    ]);
  });

  test("re-encryption walks only the named rule's files", async () => {
    const { execSeam, seams } = seamsWithKey();
    execSeam.writeFile(teamSopsYamlPath("acme"), twoRules);
    const memberFile = teamSecretsFile("acme", "board");
    const adminFile = join(teamCloneRootFor("acme"), "mattstack", "org", "admin-secrets", "rt.json");
    execSeam.writeFile(memberFile, "ciphertext");
    execSeam.writeFile(adminFile, "ciphertext");

    expect(listRuleFiles("acme", seams, "admins")).toEqual([adminFile]);
    expect(await reencryptTeamSecrets("acme", seams, undefined, "admins")).toEqual([adminFile]);
    expect(await reencryptTeamSecrets("acme", seams)).toEqual([memberFile]);
    const updated = execSeam.calls.filter((c) => c.cmd[1] === "updatekeys").map((c) => c.cmd[3]);
    expect(updated).toEqual([adminFile, memberFile]);
  });
});
```

The existing test "an existing .sops.yaml with more than one creation rule -> TeamSopsYamlHandEditedError, never silently collapsed" keeps passing unchanged (its second rule is `other/.*`).

- [ ] **Step 3: Run them to verify they fail**

Run: `bun test lib/secrets/__tests__/team-store.test.ts`
Expected: FAIL (`ADMIN_PATH_REGEX`, `parseSopsRules`, `listRuleFiles` are not exported; the rule argument is ignored).

- [ ] **Step 4: Implement**

`lib/rt-paths.ts`, after `orgSecretsDir`:

```ts
export function orgAdminSecretsDir(org: string): string {
  return join(orgDir(org), "mattstack", "org", "admin-secrets");
}
```

`lib/home/age-key.ts`: replace the doc comment and body of `renderSopsYamlFor` (lines 216-226) with:

```ts
/**
 * Renders `.sops.yaml` creation rules, each encrypting to every recipient it
 * names (sops accepts a comma-separated `age:` value). team-store.ts writes
 * an org's members and admins rules through this; `renderSopsYamlFor` is the
 * one-rule case `lib/team/create.ts` and `renderSopsYaml` use.
 */
export function renderSopsYamlRules(rules: { pathRegex: string; recipients: string[] }[]): string {
  return ["creation_rules:", ...rules.flatMap((r) => [`  - path_regex: ${r.pathRegex}`, `    age: ${r.recipients.join(",")}`]), ""].join("\n");
}

export function renderSopsYamlFor(pathRegex: string, recipients: string[]): string {
  return renderSopsYamlRules([{ pathRegex, recipients }]);
}
```

`lib/secrets/team-store.ts`:

Replace the module doc paragraph at lines 29-33 with:

```ts
 * `.sops.yaml` holds exactly the two creation rules this store writes: the
 * members rule (`mattstack/org/secrets/.*`, every member's key) and the
 * admins rule (`mattstack/org/admin-secrets/.*`, the org owners' and admins'
 * keys). The members rule is always written first, because an older rt
 * reads only the first `age:` line. A rule rt did not write, a third rule,
 * or one rule written twice is refused (`TeamSopsYamlHandEditedError`)
 * rather than silently rewritten.
```

Replace `TeamSopsYamlHandEditedError`:

```ts
/** Thrown by `writeTeamRecipients` when `.sops.yaml` holds a creation rule this store did not write, so rewriting it would lose that rule. */
export class TeamSopsYamlHandEditedError extends Error {
  constructor(slug: string) {
    super(
      `team "${slug}"'s .sops.yaml has a creation rule rt did not write. rt manages only its ` +
        `"mattstack/org/secrets/.*" and "mattstack/org/admin-secrets/.*" rules; edit recipients by hand instead of through rt.`,
    );
  }
}
```

After `TEAM_PATH_REGEX` (keep its doc comment and value), add:

```ts
export const ADMIN_PATH_REGEX = "mattstack/org/admin-secrets/.*";

/** Which creation rule a call means: every member's, or the org owners' and admins'. */
export type TeamSopsRule = "members" | "admins";

const RULE_REGEX: Record<TeamSopsRule, string> = { members: TEAM_PATH_REGEX, admins: ADMIN_PATH_REGEX };
const RULE_ORDER: readonly TeamSopsRule[] = ["members", "admins"];

export interface SopsRule {
  pathRegex: string;
  recipients: string[];
}
```

Change the import of `orgSecretsDir` to `import { orgAdminSecretsDir, orgDir, orgSecretsDir } from "../rt-paths.ts";` and the age-key import to `import { createRealAgeKeySeam, renderSopsYamlRules } from "../home/age-key.ts";`. Add, after `teamSecretsDir`:

```ts
function adminSecretsDir(slug: string): string {
  validateSlug(slug);
  return orgAdminSecretsDir(slug);
}

const RULE_DIR: Record<TeamSopsRule, (slug: string) => string> = { members: teamSecretsDir, admins: adminSecretsDir };
```

Delete `ruleCount`. Keep `parseAgeRecipients` as it is. Add after it:

```ts
/** Every creation rule in file order, or null when a list entry is not a `path_regex:` rule this store can read. */
export function parseSopsRules(content: string): SopsRule[] | null {
  const entries = [...content.matchAll(/^[ \t]*-[ \t]+\S/gm)].length;
  const starts = [...content.matchAll(/^[ \t]*-[ \t]*path_regex:[ \t]*(\S+)[ \t]*$/gm)];
  if (entries !== starts.length) return null;
  return starts.map((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]!.index! : content.length;
    return { pathRegex: m[1]!, recipients: parseAgeRecipients(content.slice(m.index! + m[0].length, end)) };
  });
}

function ruleOf(pathRegex: string): TeamSopsRule | null {
  return RULE_ORDER.find((rule) => RULE_REGEX[rule] === pathRegex) ?? null;
}

/** The rules an existing `.sops.yaml` holds, refusing one this store did not write. */
function ownedRules(slug: string, seams: SecretsSeams): Partial<Record<TeamSopsRule, string[]>> {
  const path = teamSopsYamlPath(slug);
  if (!seams.execSeam.fileExists(path)) return {};
  const rules = parseSopsRules(seams.execSeam.readFile(path));
  if (rules === null) throw new TeamSopsYamlHandEditedError(slug);
  const owned: Partial<Record<TeamSopsRule, string[]>> = {};
  for (const r of rules) {
    const rule = ruleOf(r.pathRegex);
    if (rule === null || owned[rule] !== undefined) throw new TeamSopsYamlHandEditedError(slug);
    owned[rule] = r.recipients;
  }
  return owned;
}
```

Replace `readTeamRecipients` and `writeTeamRecipients` (keep `writeTeamRecipients`'s doc comment, adding one sentence: "An empty admins rule is dropped from the file."):

```ts
/** The rule's current `age:` recipients; [] when `.sops.yaml` or the rule does not exist yet. A file with no rule this store wrote reads its first rule as the members rule, as it always has. */
export function readTeamRecipients(slug: string, seams: SecretsSeams, rule: TeamSopsRule = "members"): string[] {
  const path = teamSopsYamlPath(slug);
  if (!seams.execSeam.fileExists(path)) return [];
  const content = seams.execSeam.readFile(path);
  const rules = parseSopsRules(content) ?? [];
  if (rules.some((r) => ruleOf(r.pathRegex) !== null)) return rules.find((r) => r.pathRegex === RULE_REGEX[rule])?.recipients ?? [];
  return rule === "members" ? parseAgeRecipients(content) : [];
}

export function writeTeamRecipients(slug: string, recipients: string[], seams: SecretsSeams, rule: TeamSopsRule = "members"): void {
  const root = teamCloneRoot(slug);
  if (!seams.execSeam.fileExists(root)) throw new NoTeamCloneError(slug);

  const owned = ownedRules(slug, seams);
  owned[rule] = [...new Set(recipients)].sort();
  const rules = RULE_ORDER.filter((r) => owned[r] !== undefined && (r === "members" || owned[r]!.length > 0)).map((r) => ({
    pathRegex: RULE_REGEX[r],
    recipients: owned[r]!,
  }));
  seams.execSeam.writeFile(teamSopsYamlPath(slug), renderSopsYamlRules(rules));
}
```

Replace `listTeamDomainFiles` with an exported, rule-aware version:

```ts
/** The rule's encrypted domain files, sorted. */
export function listRuleFiles(slug: string, seams: SecretsSeams, rule: TeamSopsRule): string[] {
  const dir = RULE_DIR[rule](slug);
  const names = seams.execSeam.listDir ? seams.execSeam.listDir(dir) : [];
  return names
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(dir, name))
    .sort();
}
```

In `reencryptTeamSecrets`, add the parameter and use it; add one sentence to its doc comment: "`rule` picks which rule's files are walked; sops re-encrypts each file to the recipients of the rule its path matches, so each rule keeps its own recipients."

```ts
export async function reencryptTeamSecrets(
  slug: string,
  seams: SecretsSeams,
  probes: Pick<Probes, "readFile" | "home"> = createRealProbes(),
  rule: TeamSopsRule = "members",
): Promise<string[]> {
  assertMayWrite(probes, slug, ".sops.yaml");
  const files = listRuleFiles(slug, seams, rule);
  // ...the rest unchanged
```

The regexes never overlap: `mattstack/org/secrets/` is not a substring of `mattstack/org/admin-secrets/...` and the other way round, so sops matches each file to exactly one rule whatever the order.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `bun test lib/secrets/__tests__/ lib/home/__tests__/age-key.test.ts lib/team/__tests__/create.test.ts lib/team/__tests__/members.test.ts && bun run typecheck`
Expected: PASS. `create.test.ts` pins the scaffold's one-rule `.sops.yaml`, which `renderSopsYamlFor` still renders byte for byte.

- [ ] **Step 6: Commit**

```bash
git add lib/rt-paths.ts lib/home/age-key.ts lib/secrets/team-store.ts lib/secrets/__tests__/team-fakes.ts lib/secrets/__tests__/team-store.test.ts
git commit -m "team-store: own the members and admins sops rules"
```

---

### Task 2: Read and write the admin-only file

**Files:**
- Modify: `lib/secrets/team-store.ts` (new exports after `writeTeamSecret`)
- Test: `lib/secrets/__tests__/team-store.test.ts`, `lib/secrets/__tests__/team-store.real-sops.test.ts`

**Interfaces:**
- Consumes: `TeamSopsRule`, `readTeamRecipients(..., "admins")`, `adminSecretsDir` (Task 1).
- Produces, in `lib/secrets/team-store.ts`:
  - `adminSecretsFile(slug: string, domain: string): string`
  - `class NoAdminRecipientsError extends Error`
  - `adminSecretsUnreadable(slug: string, cause: SopsDecryptError): UserActionableError` (code `admin-secrets-unreadable`)
  - `readAdminSecret(slug: string, domain: string, key: string, seams: SecretsSeams): Promise<string | null>`: null when the file or key is absent, when this Mac holds no age key, or when this Mac's key is not a recipient; any other failure throws.
  - `writeAdminSecret(slug, domain, key, value, seams, probes = createRealProbes()): Promise<void>`: owners and admins only (`assertMayWrite(probes, slug, ".sops.yaml")`).

- [ ] **Step 1: Write the failing tests**

Add to `team-store.test.ts` (import the new exports):

```ts
describe("the admin-only file", () => {
  const ADMINS = "creation_rules:\n  - path_regex: mattstack/org/secrets/.*\n    age: age1aaa,age1bbb\n  - path_regex: mattstack/org/admin-secrets/.*\n    age: age1aaa\n";
  const MISMATCH = "Failed to get the data key required to decrypt the SOPS file.\n  age: no identity matched any of the recipients";

  test("lives at mattstack/org/admin-secrets/<domain>.json", () => {
    expect(adminSecretsFile("acme", "rt")).toBe(join(teamCloneRootFor("acme"), "mattstack", "org", "admin-secrets", "rt.json"));
  });

  test("a write pins --filename-override to the admin path, and the value round-trips", async () => {
    const { execSeam, seams } = seamsWithKey();
    execSeam.writeFile(teamSopsYamlPath("acme"), ADMINS);

    await writeAdminSecret("acme", "rt", "switchboardAdminToken", "admin-1", seams);

    const encrypt = execSeam.calls.find((c) => c.cmd[1] === "-e")!;
    expect(encrypt.cmd[encrypt.cmd.indexOf("--filename-override") + 1]).toBe(join("mattstack", "org", "admin-secrets", "rt.json"));
    expect(await readAdminSecret("acme", "rt", "switchboardAdminToken", seams)).toBe("admin-1");
  });

  test("with no admins rule yet, a write is refused before any sops call", async () => {
    const { execSeam, seams } = seamsWithKey();
    writeTeamRecipients("acme", ["age1aaa"], seams);

    await expect(writeAdminSecret("acme", "rt", "switchboardAdminToken", "admin-1", seams)).rejects.toThrow(NoAdminRecipientsError);
    expect(execSeam.calls).toEqual([]);
  });

  test("a team owner's Mac may not write it", async () => {
    const { execSeam, seams } = seamsWithKey();
    execSeam.writeFile(teamSopsYamlPath("acme"), ADMINS);
    const probes = fakeProbes({
      home: "/home/x",
      files: {
        "/home/x/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc": JSON.stringify({ "mattstack.org": { owners: [], admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } } }),
        [teamLocalPath("/home/x", "acme")]: JSON.stringify({ joinedByRt: true, forgeUsername: "dev2" }),
      },
    });

    await expect(writeAdminSecret("acme", "rt", "switchboardAdminToken", "admin-1", seams, probes)).rejects.toMatchObject({ code: "team-pull-only" });
  });

  test("a missing file reads as absent with no sops call", async () => {
    const { execSeam, seams } = seamsWithKey();
    expect(await readAdminSecret("acme", "rt", "switchboardAdminToken", seams)).toBeNull();
    expect(execSeam.calls).toEqual([]);
  });

  test("a Mac whose key is not a recipient reads it as absent, not as a failure", async () => {
    const execSeam = new FakeTeamExecSeam({ decrypt: { code: 128, stdout: "", stderr: MISMATCH } });
    execSeam.files.set(teamCloneRootFor("acme"), "");
    execSeam.writeFile(adminSecretsFile("acme", "rt"), "ciphertext");

    expect(await readAdminSecret("acme", "rt", "switchboardAdminToken", { ageKeySeam: fakeAgeKeySeamWithKey("AGE-X"), execSeam })).toBeNull();
  });

  test("a Mac with no age key reads it as absent", async () => {
    const execSeam = new FakeTeamExecSeam();
    execSeam.files.set(teamCloneRootFor("acme"), "");
    execSeam.writeFile(adminSecretsFile("acme", "rt"), "ciphertext");

    expect(await readAdminSecret("acme", "rt", "switchboardAdminToken", { ageKeySeam: fakeAgeKeySeamAbsent(), execSeam })).toBeNull();
  });

  test("any other sops failure is still an error", async () => {
    const execSeam = new FakeTeamExecSeam({ decrypt: { code: 1, stdout: "", stderr: "sops: no matching creation rule" } });
    execSeam.files.set(teamCloneRootFor("acme"), "");
    execSeam.writeFile(adminSecretsFile("acme", "rt"), "ciphertext");

    await expect(readAdminSecret("acme", "rt", "switchboardAdminToken", { ageKeySeam: fakeAgeKeySeamWithKey("AGE-X"), execSeam })).rejects.toBeInstanceOf(SopsDecryptError);
  });

  test("a write over a file this Mac cannot open says so plainly, with sops output kept for the log", async () => {
    const execSeam = new FakeTeamExecSeam({ decrypt: { code: 128, stdout: "", stderr: MISMATCH } });
    execSeam.files.set(teamCloneRootFor("acme"), "");
    execSeam.writeFile(teamSopsYamlPath("acme"), ADMINS);
    execSeam.writeFile(adminSecretsFile("acme", "rt"), "ciphertext");

    const err = await writeAdminSecret("acme", "rt", "switchboardAdminToken", "admin-1", { ageKeySeam: fakeAgeKeySeamWithKey("AGE-X"), execSeam }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "admin-secrets-unreadable", message: "This Mac cannot open the acme org's admin-only secrets" });
    expect((err as UserActionableError).log).toContain("no identity matched");
  });
});
```

Add to `team-store.real-sops.test.ts`, inside the `describe.skipIf(!hasRealSops)` block (import `readAdminSecret`, `writeAdminSecret`):

```ts
  test("the admins rule locks the admin-only file to its own recipients, and re-encryption follows each rule", async () => {
    const slug = `realsops-admins-${process.pid}`;
    seedOrg({ org: slug, username: "dev1", roles: { admins: ["dev1"], teams: {} } });
    const root = join(orgsDir(), slug);
    mkdirSync(join(root, "mattstack", "org", "secrets"), { recursive: true });
    mkdirSync(join(root, "mattstack", "org", "admin-secrets"), { recursive: true });

    const admin = await generateAgeKeypair();
    const member = await generateAgeKeypair();
    const execSeam = createRealSecretsExecSeam(root);
    const asAdmin: SecretsSeams = { ageKeySeam: fakeAgeKeySeamWithKey(admin.privateKey), execSeam };
    const asMember: SecretsSeams = { ageKeySeam: fakeAgeKeySeamWithKey(member.privateKey), execSeam };

    writeTeamRecipients(slug, [admin.publicKey, member.publicKey], asAdmin);
    writeTeamRecipients(slug, [admin.publicKey], asAdmin, "admins");
    await writeTeamSecret(slug, "board", "slackClientSecret", "for-everyone", asAdmin);
    await writeAdminSecret(slug, "rt", "switchboardAdminToken", "admins-only", asAdmin);

    expect(await readTeamSecret(slug, "board", "slackClientSecret", asMember)).toBe("for-everyone");
    expect(await readAdminSecret(slug, "rt", "switchboardAdminToken", asAdmin)).toBe("admins-only");
    expect(await readAdminSecret(slug, "rt", "switchboardAdminToken", asMember)).toBeNull();

    // Promote: the member's key joins the admins rule, and only the admin file is re-encrypted.
    writeTeamRecipients(slug, [admin.publicKey, member.publicKey], asAdmin, "admins");
    expect(await reencryptTeamSecrets(slug, asAdmin, undefined, "admins")).toHaveLength(1);
    expect(await readAdminSecret(slug, "rt", "switchboardAdminToken", asMember)).toBe("admins-only");

    // Demote: their key leaves the admins rule; the member-wide file is untouched.
    writeTeamRecipients(slug, [admin.publicKey], asAdmin, "admins");
    await reencryptTeamSecrets(slug, asAdmin, undefined, "admins");
    expect(await readAdminSecret(slug, "rt", "switchboardAdminToken", asMember)).toBeNull();
    expect(await readTeamSecret(slug, "board", "slackClientSecret", asMember)).toBe("for-everyone");
  }, 30_000);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/secrets/__tests__/team-store.test.ts lib/secrets/__tests__/team-store.real-sops.test.ts`
Expected: FAIL (`adminSecretsFile`, `readAdminSecret`, `writeAdminSecret`, `NoAdminRecipientsError` are not exported).

- [ ] **Step 3: Implement**

In `lib/secrets/team-store.ts`, import `NoAgeKeyError` from `./store.ts` beside the existing names, then add after `writeTeamSecret`:

```ts
/** Thrown by `writeAdminSecret` when `.sops.yaml` has no admins rule yet: nothing can be encrypted to nobody. */
export class NoAdminRecipientsError extends Error {
  constructor(slug: string) {
    super(`org "${slug}" has no admin-only recipients yet; run rt team admin-secrets`);
  }
}

/** `~/.mattstack/orgs/<slug>/mattstack/org/admin-secrets/<domain>.json`, encrypted only to the org owners' and admins' keys. */
export function adminSecretsFile(slug: string, domain: string): string {
  validateDomain(domain);
  return join(adminSecretsDir(slug), `${domain}.json`);
}

function adminLocation(slug: string, domain: string): SecretsLocation {
  return {
    filePath: adminSecretsFile(slug, domain),
    filenameOverride: join("mattstack", "org", "admin-secrets", `${domain}.json`),
    cwd: teamCloneRoot(slug),
  };
}

export function adminSecretsUnreadable(slug: string, cause: SopsDecryptError): UserActionableError {
  return new UserActionableError("admin-secrets-unreadable", `This Mac cannot open the ${slug} org's admin-only secrets`, { team: slug }, {
    why: "They are not locked to this Mac's age key. An org owner or admin whose Mac can open them adds yours by running rt team admin-secrets.",
    log: cause.message,
  });
}

/** Null when the file or key is absent, or when this Mac cannot open the file: every Mac that is not an org owner's or admin's reads it that way. */
export async function readAdminSecret(slug: string, domain: string, key: string, seams: SecretsSeams): Promise<string | null> {
  validateKey(key);
  try {
    const payload = await decryptAtLocation(adminLocation(slug, domain), seams);
    return payload === null ? null : payload[key] ?? null;
  } catch (err) {
    if (err instanceof NoAgeKeyError) return null;
    if (err instanceof SopsDecryptError && sopsKeyMismatch(err.stderr)) return null;
    throw err;
  }
}

export async function writeAdminSecret(
  slug: string,
  domain: string,
  key: string,
  value: string,
  seams: SecretsSeams,
  probes: Pick<Probes, "readFile" | "home"> = createRealProbes(),
): Promise<void> {
  assertMayWrite(probes, slug, ".sops.yaml");
  validateKey(key);
  if (readTeamRecipients(slug, seams, "admins").length === 0) throw new NoAdminRecipientsError(slug);
  try {
    await writeAtLocation(adminLocation(slug, domain), `admin-${slug}-${domain}`, key, value, seams);
  } catch (err) {
    if (err instanceof SopsDecryptError) throw adminSecretsUnreadable(slug, err);
    throw err;
  }
}
```

Extend the module doc with one sentence: "The admin-only file under `mattstack/org/admin-secrets/` uses the same machinery, matched by the admins rule; a Mac whose key the rule does not name reads it as absent (`readAdminSecret`)."

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/secrets/__tests__/ && bun run typecheck`
Expected: PASS. On a Mac with `sops` and `age-keygen` on PATH the real-sops test runs; if it fails on the member's read, real sops's wrong-key stderr no longer matches `sopsKeyMismatch` and that regex needs the new wording, never a looser catch.

- [ ] **Step 5: Commit**

```bash
git add lib/secrets/team-store.ts lib/secrets/__tests__/team-store.test.ts lib/secrets/__tests__/team-store.real-sops.test.ts
git commit -m "team-store: read and write the admin-only secrets file"
```

---

### Task 3: Keep the admin-only file locked to the org's owners and admins

**Files:**
- Create: `lib/team/admin-secrets.ts`
- Test: `lib/team/__tests__/admin-secrets.test.ts`

**Interfaces:**
- Consumes: `rolesFrom`, `rosterFrom`, `sameUser`, `OrgRoles.owners` (rt-client, plan 1); `roleOf`, `isOrgAdmin` (plan 1); `readTeamRecipients`, `writeTeamRecipients`, `reencryptTeamSecrets`, `listRuleFiles` (Task 1); `readAdminSecret`, `writeAdminSecret` (Task 2); `assertMayWrite` (`lib/team/roles.ts`).
- Produces, in `lib/team/admin-secrets.ts`:
  - `SWITCHBOARD_ADMIN_TOKEN = "switchboardAdminToken"`, `ADMIN_TOKEN_DOMAIN = "rt"`
  - `interface AdminKeys { keys: string[]; holders: string[]; withoutKey: string[] }`
  - `adminKeysIn(orgStore: Record<string, unknown>): AdminKeys` (pure; `orgStore` is the org store's top-level keys)
  - `type TokenOutcome = "seeded" | "replaced" | "kept" | "differs" | "none"`
  - `interface AdminSecretsResult { state: "unused" | "current" | "updated"; holders: string[]; withoutKey: string[]; added: string[]; removed: string[]; reencrypted: string[]; token: TokenOutcome }`
  - `interface AdminSecretsOpts { token?: string | null; replaceToken?: boolean }`
  - `syncAdminSecrets(p: Pick<Probes, "readFile" | "home">, slug: string, orgStore: Record<string, unknown>, secrets: SecretsSeams, opts?: AdminSecretsOpts): Promise<AdminSecretsResult>`
  - `followRosterChange(p, slug, orgStore, secrets): Promise<{ reencrypted: string[]; failure: string | null }>`: `syncAdminSecrets` with no token, never throws.

- [ ] **Step 1: Write the failing tests**

`lib/team/__tests__/admin-secrets.test.ts`:

```ts
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeStateDb } from "../../state/index.ts";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { teamLocalPath } from "../team-local.ts";
import { adminSecretsFile, readAdminSecret, readTeamRecipients, teamSecretsFile, teamSopsYamlPath, writeTeamRecipients } from "../../secrets/team-store.ts";
import { FakeTeamExecSeam, fakeAgeKeySeamWithKey, seamsWithKey, teamCloneRootFor } from "../../secrets/__tests__/team-fakes.ts";
import { adminKeysIn, followRosterChange, syncAdminSecrets } from "../admin-secrets.ts";

let fixtureHome: string;
let priorHome: string | undefined;
beforeEach(() => {
  priorHome = process.env.HOME;
  closeStateDb();
  fixtureHome = realpathSync(mkdtempSync(`${tmpdir()}/rt-admin-secrets-`));
  process.env.HOME = fixtureHome;
});
afterEach(() => {
  closeStateDb();
  process.env.HOME = priorHome;
  rmSync(fixtureHome, { recursive: true, force: true });
});

const OWNER = { username: "dev1", agePublicKey: "age1dev1", teams: [] };
const ADMIN = { username: "dev2", agePublicKey: "age1dev2", teams: ["widgets"] };
const MEMBER = { username: "dev3", agePublicKey: "age1dev3", teams: ["widgets"] };
const org = (roles: { owners?: string[]; admins: string[] }, roster: unknown[] = [OWNER, ADMIN, MEMBER]) => ({
  "mattstack.org": { owners: roles.owners ?? [], admins: roles.admins, teams: {} },
  "mattstack.roster": roster,
});
const MEMBERS_RULE = "creation_rules:\n  - path_regex: mattstack/org/secrets/.*\n    age: age1dev1,age1dev2,age1dev3\n";

function probesAs(username: string) {
  return fakeProbes({
    home: "/home/x",
    files: {
      "/home/x/.mattstack/orgs/acme/mattstack/org/settings.org.jsonc": JSON.stringify({ "mattstack.org": { owners: [], admins: ["dev1"], teams: { widgets: { owners: ["dev3"] } } } }),
      [teamLocalPath("/home/x", "acme")]: JSON.stringify({ forgeUsername: username }),
    },
  });
}

function orgWithMembersRule() {
  const made = seamsWithKey();
  made.execSeam.writeFile(teamSopsYamlPath("acme"), MEMBERS_RULE);
  return made;
}

describe("adminKeysIn", () => {
  test("names the owners' and admins' roster keys, never a member's", () => {
    expect(adminKeysIn(org({ owners: ["dev1"], admins: ["dev2"] }))).toEqual({ keys: ["age1dev1", "age1dev2"], holders: ["dev1", "dev2"], withoutKey: [] });
  });
  test("with no owners listed, the admins are the owners", () => {
    expect(adminKeysIn(org({ admins: ["dev1"] })).keys).toEqual(["age1dev1"]);
  });
  test("usernames match without case", () => {
    expect(adminKeysIn(org({ admins: ["dev2"] }, [{ ...ADMIN, username: "Dev2" }])).keys).toEqual(["age1dev2"]);
  });
  test("an owner or admin with no key on the roster is named, not guessed at", () => {
    expect(adminKeysIn(org({ admins: ["dev1", "dev4"] }))).toMatchObject({ keys: ["age1dev1"], withoutKey: ["dev4"] });
  });
});

describe("syncAdminSecrets", () => {
  test("an org that keeps no admin-only secrets, with no token to add, is left exactly as it was", async () => {
    const { execSeam, seams } = orgWithMembersRule();
    const result = await syncAdminSecrets(probesAs("dev1"), "acme", org({ admins: ["dev1"] }), seams);
    expect(result).toMatchObject({ state: "unused", token: "none", added: [], removed: [] });
    expect(execSeam.readFile(teamSopsYamlPath("acme"))).toBe(MEMBERS_RULE);
    expect(execSeam.calls).toEqual([]);
  });

  test("the first run writes the admins rule and puts this Mac's token in", async () => {
    const { execSeam, seams } = orgWithMembersRule();
    const result = await syncAdminSecrets(probesAs("dev1"), "acme", org({ owners: ["dev1"], admins: ["dev2"] }), seams, { token: "admin-1" });
    expect(result).toMatchObject({ state: "updated", token: "seeded", added: ["age1dev1", "age1dev2"], holders: ["dev1", "dev2"] });
    expect(readTeamRecipients("acme", seams, "admins")).toEqual(["age1dev1", "age1dev2"]);
    expect(readTeamRecipients("acme", seams)).toEqual(["age1dev1", "age1dev2", "age1dev3"]);
    expect(await readAdminSecret("acme", "rt", "switchboardAdminToken", seams)).toBe("admin-1");
    expect(execSeam.calls.some((c) => c.cmd.includes(teamSecretsFile("acme", "board")))).toBe(false);
  });

  test("a second run with nothing changed writes nothing", async () => {
    const { execSeam, seams } = orgWithMembersRule();
    const store = org({ admins: ["dev1"] });
    await syncAdminSecrets(probesAs("dev1"), "acme", store, seams, { token: "admin-1" });
    const before = execSeam.readFile(teamSopsYamlPath("acme"));
    execSeam.calls = [];

    const again = await syncAdminSecrets(probesAs("dev1"), "acme", store, seams, { token: "admin-1" });

    expect(again).toMatchObject({ state: "current", token: "kept", added: [], removed: [] });
    expect(execSeam.readFile(teamSopsYamlPath("acme"))).toBe(before);
    expect(execSeam.calls.filter((c) => c.cmd[1] === "updatekeys" || c.cmd[1] === "-e")).toEqual([]);
  });

  test("a promotion adds the new admin's key and re-encrypts only the admin-only files", async () => {
    const { execSeam, seams } = orgWithMembersRule();
    writeTeamRecipients("acme", ["age1dev1"], seams, "admins");
    execSeam.writeFile(adminSecretsFile("acme", "rt"), "ciphertext");
    execSeam.writeFile(teamSecretsFile("acme", "board"), "ciphertext");

    const result = await syncAdminSecrets(probesAs("dev1"), "acme", org({ admins: ["dev1", "dev3"] }), seams);

    expect(result).toMatchObject({ state: "updated", added: ["age1dev3"], removed: [], reencrypted: [adminSecretsFile("acme", "rt")] });
    expect(readTeamRecipients("acme", seams, "admins")).toEqual(["age1dev1", "age1dev3"]);
    expect(execSeam.calls.filter((c) => c.cmd[1] === "updatekeys").map((c) => c.cmd[3])).toEqual([adminSecretsFile("acme", "rt")]);
  });

  test("a demotion takes the key off", async () => {
    const { execSeam, seams } = orgWithMembersRule();
    writeTeamRecipients("acme", ["age1dev1", "age1dev2"], seams, "admins");
    execSeam.writeFile(adminSecretsFile("acme", "rt"), "ciphertext");

    const result = await syncAdminSecrets(probesAs("dev1"), "acme", org({ admins: ["dev1"] }), seams);

    expect(result).toMatchObject({ removed: ["age1dev2"], added: [] });
    expect(readTeamRecipients("acme", seams, "admins")).toEqual(["age1dev1"]);
  });

  test("a failed re-encryption puts the admins rule back as it was", async () => {
    const execSeam = new FakeTeamExecSeam({ failUpdatekeysOnCall: 1 });
    execSeam.files.set(teamCloneRootFor("acme"), "");
    const seams = { ageKeySeam: fakeAgeKeySeamWithKey("AGE-TEAM-KEY"), execSeam };
    execSeam.writeFile(teamSopsYamlPath("acme"), MEMBERS_RULE);
    writeTeamRecipients("acme", ["age1dev1"], seams, "admins");
    execSeam.writeFile(adminSecretsFile("acme", "rt"), "ciphertext");
    const before = execSeam.readFile(teamSopsYamlPath("acme"));

    const err = await syncAdminSecrets(probesAs("dev1"), "acme", org({ admins: ["dev1", "dev2"] }), seams).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: "admin-secrets-not-reencrypted", next: "rt team admin-secrets" });
    expect(execSeam.readFile(teamSopsYamlPath("acme"))).toBe(before);
  });

  test("a failed re-encryption with no admins rule before leaves no admins rule", async () => {
    const execSeam = new FakeTeamExecSeam({ failUpdatekeysOnCall: 1 });
    execSeam.files.set(teamCloneRootFor("acme"), "");
    const seams = { ageKeySeam: fakeAgeKeySeamWithKey("AGE-TEAM-KEY"), execSeam };
    execSeam.writeFile(teamSopsYamlPath("acme"), MEMBERS_RULE);
    execSeam.writeFile(adminSecretsFile("acme", "rt"), "ciphertext");

    await expect(syncAdminSecrets(probesAs("dev1"), "acme", org({ admins: ["dev1"] }), seams)).rejects.toMatchObject({ code: "admin-secrets-not-reencrypted" });
    expect(execSeam.readFile(teamSopsYamlPath("acme"))).toBe(MEMBERS_RULE);
  });

  test("with no owner or admin key on the roster, nothing is written", async () => {
    const { execSeam, seams } = orgWithMembersRule();
    await expect(syncAdminSecrets(probesAs("dev1"), "acme", org({ admins: ["dev9"] }), seams, { token: "admin-1" })).rejects.toMatchObject({ code: "no-admin-keys", next: "rt team members sync" });
    expect(execSeam.readFile(teamSopsYamlPath("acme"))).toBe(MEMBERS_RULE);
  });

  test("a different token already shared is kept unless replacing is asked for", async () => {
    const { seams } = orgWithMembersRule();
    const store = org({ admins: ["dev1"] });
    await syncAdminSecrets(probesAs("dev1"), "acme", store, seams, { token: "old" });

    expect((await syncAdminSecrets(probesAs("dev1"), "acme", store, seams, { token: "new" })).token).toBe("differs");
    expect(await readAdminSecret("acme", "rt", "switchboardAdminToken", seams)).toBe("old");
    expect((await syncAdminSecrets(probesAs("dev1"), "acme", store, seams, { token: "new", replaceToken: true })).token).toBe("replaced");
    expect(await readAdminSecret("acme", "rt", "switchboardAdminToken", seams)).toBe("new");
  });

  test("a team owner's Mac is refused", async () => {
    const { seams } = orgWithMembersRule();
    await expect(syncAdminSecrets(probesAs("dev3"), "acme", org({ admins: ["dev1"] }), seams, { token: "admin-1" })).rejects.toMatchObject({ code: "team-pull-only" });
  });
});

describe("followRosterChange", () => {
  test("never throws: a failure comes back as text", async () => {
    const { execSeam, seams } = orgWithMembersRule();
    writeTeamRecipients("acme", ["age1dev1"], seams, "admins");
    execSeam.writeFile(adminSecretsFile("acme", "rt"), "ciphertext");
    const result = await followRosterChange(probesAs("dev1"), "acme", org({ admins: ["dev9"] }), seams);
    expect(result.reencrypted).toEqual([]);
    expect(result.failure).toContain("No org owner or admin");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/admin-secrets.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/team/admin-secrets.ts`:

```ts
/**
 * The org's admin-only secrets: sops files under `mattstack/org/admin-secrets/`,
 * locked by `.sops.yaml`'s admins rule to the age keys the roster records for
 * the org's owners and admins. The org store decides who that is; the rule
 * only follows it. Today the one secret kept here is the switchboard admin
 * token, which every reader looks for here before this Mac's own rt secret.
 */

import { rolesFrom, rosterFrom, sameUser } from "../../packages/rt-client/src/settings/active-team.ts";
import { isOrgAdmin, roleOf } from "../../packages/rt-client/src/settings/org-roles.ts";
import type { StoreFile } from "../../packages/rt-client/src/settings/stores.ts";
import { UserActionableError } from "../errors.ts";
import type { SecretsSeams } from "../secrets/store.ts";
import { listRuleFiles, readAdminSecret, readTeamRecipients, reencryptTeamSecrets, writeAdminSecret, writeTeamRecipients } from "../secrets/team-store.ts";
import type { Probes } from "../setup/probes.ts";
import { assertMayWrite } from "./roles.ts";

export const SWITCHBOARD_ADMIN_TOKEN = "switchboardAdminToken";
export const ADMIN_TOKEN_DOMAIN = "rt";

export interface AdminKeys {
  keys: string[];
  /** Owners and admins whose roster entry carries a key. */
  holders: string[];
  /** Owners and admins with no key on the roster, so no Mac of theirs can open the file yet. */
  withoutKey: string[];
}

function asStore(global: Record<string, unknown>): StoreFile {
  return { global, repos: {}, file: "", exists: true };
}

export function adminKeysIn(orgStore: Record<string, unknown>): AdminKeys {
  const store = asStore(orgStore);
  const roles = rolesFrom(store);
  const keys = new Set<string>();
  const holders: string[] = [];
  for (const entry of rosterFrom(store)) {
    const key = typeof entry.agePublicKey === "string" ? entry.agePublicKey.trim() : "";
    if (key === "" || !isOrgAdmin(roleOf(entry.username, roles))) continue;
    keys.add(key);
    holders.push(entry.username);
  }
  const named = [...(roles.owners ?? []), ...roles.admins].filter((name, i, all) => all.findIndex((other) => sameUser(other, name)) === i);
  const withoutKey = named.filter((name) => !holders.some((holder) => sameUser(holder, name)));
  return { keys: [...keys].sort(), holders: holders.sort(), withoutKey: withoutKey.sort() };
}

export type TokenOutcome = "seeded" | "replaced" | "kept" | "differs" | "none";

export interface AdminSecretsResult {
  /** `unused`: the org keeps no admin-only secrets and this run had no token to add, so nothing was touched. */
  state: "unused" | "current" | "updated";
  holders: string[];
  withoutKey: string[];
  /** Keys the admins rule gained, and lost. */
  added: string[];
  removed: string[];
  reencrypted: string[];
  token: TokenOutcome;
}

export interface AdminSecretsOpts {
  /** This Mac's own switchboard admin token, put in when the file holds none. */
  token?: string | null;
  /** Put `token` in even when the file already holds a different one. */
  replaceToken?: boolean;
}

function noAdminKeys(slug: string): UserActionableError {
  return new UserActionableError("no-admin-keys", "No org owner or admin has an age key on the roster yet, so rt cannot lock the admin-only secrets to anyone", { team: slug }, {
    why: "A key lands on the roster when someone's invite is collected. Bring the roster up to date, then run this again.",
    next: "rt team members sync",
  });
}

function notReencrypted(slug: string, err: unknown): UserActionableError {
  return new UserActionableError("admin-secrets-not-reencrypted", "rt could not lock the admin-only secrets to the org's owners and admins", { team: slug }, {
    why: "This Mac's age key may not open them yet, so nothing changed. An owner or admin whose Mac already can runs this instead.",
    next: "rt team admin-secrets",
    log: err instanceof Error ? err.message : String(err),
  });
}

async function placeToken(p: Pick<Probes, "readFile" | "home">, slug: string, secrets: SecretsSeams, token: string | null, replace: boolean): Promise<TokenOutcome> {
  if (token === null) return "none";
  const stored = await readAdminSecret(slug, ADMIN_TOKEN_DOMAIN, SWITCHBOARD_ADMIN_TOKEN, secrets);
  if (stored === token) return "kept";
  if (stored !== null && !replace) return "differs";
  await writeAdminSecret(slug, ADMIN_TOKEN_DOMAIN, SWITCHBOARD_ADMIN_TOKEN, token, secrets, p);
  return stored === null ? "seeded" : "replaced";
}

/**
 * Brings the admins rule to the owners' and admins' roster keys, re-encrypts
 * the admin-only files when that set changed (putting the rule back if sops
 * fails), then puts `opts.token` in. Writes nothing at all when nothing changed.
 */
export async function syncAdminSecrets(
  p: Pick<Probes, "readFile" | "home">,
  slug: string,
  orgStore: Record<string, unknown>,
  secrets: SecretsSeams,
  opts: AdminSecretsOpts = {},
): Promise<AdminSecretsResult> {
  assertMayWrite(p, slug, ".sops.yaml");
  const want = adminKeysIn(orgStore);
  const current = readTeamRecipients(slug, secrets, "admins");
  const token = opts.token ? opts.token : null;
  const base = { holders: want.holders, withoutKey: want.withoutKey };
  if (current.length === 0 && listRuleFiles(slug, secrets, "admins").length === 0 && token === null) {
    return { ...base, state: "unused", added: [], removed: [], reencrypted: [], token: "none" };
  }
  if (want.keys.length === 0) throw noAdminKeys(slug);

  const added = want.keys.filter((key) => !current.includes(key));
  const removed = current.filter((key) => !want.keys.includes(key));
  let reencrypted: string[] = [];
  if (added.length > 0 || removed.length > 0) {
    writeTeamRecipients(slug, want.keys, secrets, "admins");
    try {
      reencrypted = await reencryptTeamSecrets(slug, secrets, p, "admins");
    } catch (err) {
      // Until every file is re-encrypted, the files' own recipients are the old ones; the rule must say so.
      writeTeamRecipients(slug, current, secrets, "admins");
      throw notReencrypted(slug, err);
    }
  }
  const outcome = await placeToken(p, slug, secrets, token, opts.replaceToken === true);
  const changed = added.length > 0 || removed.length > 0 || outcome === "seeded" || outcome === "replaced";
  return { ...base, state: changed ? "updated" : "current", added, removed, reencrypted, token: outcome };
}

/** For a verb whose own roster change already landed: the admin-only files follow it, and a failure is reported, never thrown. */
export async function followRosterChange(
  p: Pick<Probes, "readFile" | "home">,
  slug: string,
  orgStore: Record<string, unknown>,
  secrets: SecretsSeams,
): Promise<{ reencrypted: string[]; failure: string | null }> {
  try {
    return { reencrypted: (await syncAdminSecrets(p, slug, orgStore, secrets)).reencrypted, failure: null };
  } catch (err) {
    return { reencrypted: [], failure: err instanceof Error ? err.message : String(err) };
  }
}
```

Check `rolesFrom` returns `owners` (plan 1 Task 1); `roles.owners ?? []` only guards a hand-built `OrgRoles` and can be `roles.owners` if the typecheck says the field is required.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/admin-secrets.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/admin-secrets.ts lib/team/__tests__/admin-secrets.test.ts
git commit -m "team: lock the admin-only secrets to the org's owners and admins"
```

---

### Task 4: Board peering, `rt team peer` and `rt team status` read the admin-only file

**Files:**
- Modify: `lib/team/board-peers.ts` (imports; `readAdminToken` lines 19-22; `readPeeredBoards` line 35 and 52; `revokeBoard` lines 66-67)
- Modify: `lib/team/peer.ts` (`PeerSeams` lines 24-31, `realPeerSeams` lines 56-64, `peerOwnBoard` line 92)
- Modify: `lib/team/members.ts` (`MembersSeams` lines 165-180, `realMembersSeams` lines 190-200, the `revokeBoard` call at line 458)
- Modify: `commands/team.ts` (`TeamDeps` after line 106, `peerSeamsFor` line 285, `teamStatus`'s `readPeeredBoards` call at line 933, `teamMembersRemove`'s seams spread at lines 806-809)
- Test: `lib/team/__tests__/board-peers.test.ts`, `lib/team/__tests__/peer.test.ts`, `lib/team/__tests__/members.test.ts`, `commands/__tests__/team-status.test.ts`, `commands/__tests__/team.test.ts` (the full `MembersSeams` at line 1070)

**Interfaces:**
- Consumes: `readAdminSecret`, `createRealTeamSecretsSeams` (Task 2 and existing).
- Produces, in `lib/team/board-peers.ts`:
  - `type ReadAdminSecret = (org: string, key: string) => Promise<string | null>`
  - `realReadAdminSecret: ReadAdminSecret` (reads the org's `rt` admin-only domain; never throws; logs an unexpected failure)
  - `interface AdminSource { org: string; read: ReadAdminSecret }`
  - `readAdminToken(p, readSecret: ReadLocalSecret, admin: AdminSource | null): Promise<string | null>`: environment, the board's `.env`, the admin-only file, then the local secret.
  - `readPeeredBoards(p: Probes, readSecret: ReadLocalSecret, admin: AdminSource | null)`, `revokeBoard(p: Probes, readSecret: ReadLocalSecret, handle: string, admin: AdminSource | null)`
  - `PeerSeams.readAdminSecret: ReadAdminSecret`; `MembersSeams.readAdminSecret: ReadAdminSecret`; `TeamDeps.readAdminSecret?: ReadAdminSecret`

- [ ] **Step 1: Write the failing tests**

`board-peers.test.ts`: pass `null` as the new last argument in every existing `readPeeredBoards(...)` call, then add:

```ts
describe("the admin-only file", () => {
  const listing = () => fakeProbes({ fetch: async () => ({ status: 200, body: JSON.stringify({ boards: [{ username: "dev1" }] }), headers: {} }) });
  const adminFile = (value: string | null) => ({ org: "acme", read: async (org: string, key: string) => (org === "acme" && key === "switchboardAdminToken" ? value : null) });

  test("an admin whose token is only in the org's admin-only file lists every board", async () => {
    const p = listing();
    expect([...(await readPeeredBoards(p, secrets({}), adminFile("admin-file")))!]).toEqual(["dev1"]);
    expect(p.calls.fetchInits[0]!.init?.headers?.Authorization).toBe("Bearer admin-file");
  });

  test("the admin-only file is read before this Mac's own secret", async () => {
    expect(await readAdminToken(fakeProbes({}), secrets({ switchboardAdminToken: "admin-local" }), adminFile("admin-file"))).toBe("admin-file");
  });

  test("a Mac that cannot open it falls through to its own secret", async () => {
    expect(await readAdminToken(fakeProbes({}), secrets({ switchboardAdminToken: "admin-local" }), adminFile(null))).toBe("admin-local");
  });

  test("a reader that throws falls through too", async () => {
    const failing = { org: "acme", read: async () => { throw new Error("sops crashed"); } };
    expect(await readAdminToken(fakeProbes({}), secrets({ switchboardAdminToken: "admin-local" }), failing)).toBe("admin-local");
  });

  test("the environment still comes first", async () => {
    expect(await readAdminToken(fakeProbes({ env: { SWITCHBOARD_ADMIN_TOKEN: "env-admin" } }), secrets({}), adminFile("admin-file"))).toBe("env-admin");
  });
});
```

(Import `readAdminToken` beside `readPeeredBoards`.)

`peer.test.ts`: add `readAdminSecret: async () => null,` to the `PeerSeams` literal in `seams()`, then:

```ts
  test("an admin whose token sits only in the org's admin-only file connects their board", async () => {
    const asked: Array<[string, string]> = [];
    const { s, written } = seams({}, {
      readAdminSecret: async (org, key) => {
        asked.push([org, key]);
        return "admin-file";
      },
    });
    const p = probes((url, method) => (method === "POST" ? reply(201, { token: "board-tok" }) : reply(200, { boards: [] })));

    const result = await peerOwnBoard(p, "acme", { rotate: false }, s);

    expect(result.outcome).toBe("connected");
    expect(asked).toEqual([["acme", "switchboardAdminToken"]]);
    expect(p.calls.fetchInits.find((c) => c.init?.method === "POST")?.init?.headers?.Authorization).toBe("Bearer admin-file");
    expect(written).toEqual([["switchboardToken", "board-tok"]]);
  });
```

`members.test.ts`: add `readAdminSecret: async () => null,` to `fakeMembersSeams`'s literal, then inside `describe("membersRemove: the member's board on the switchboard", ...)`:

```ts
  test("disconnects the board with the token from the org's admin-only file when this Mac holds none of its own", async () => {
    const p = fakeProbes({ home: HOME, fetch: async () => ({ status: 200, body: "", headers: {} }) });
    const { execSeam, secrets } = seamsWithClone();
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    execSeam.writeFile(teamSecretsFile(SLUG, "board"), JSON.stringify({ data: "opaque", sops: {} }));
    const { seams } = fakeMembersSeams({
      readTeamStore: () => ({ "mattstack.roster": [{ username: "matt" }, { username: "alice", agePublicKey: ALICE_PUBLIC_KEY }] }),
      readAdminSecret: async (org, key) => (org === SLUG && key === "switchboardAdminToken" ? "admin-file" : null),
    });

    const result = await membersRemove(p, secrets, SLUG, "alice", undefined, seams);

    expect(result.boardPeering).toBe("revoked");
    expect(p.calls.fetchInits.find((c) => c.url.endsWith("/boards/alice"))?.init?.headers?.Authorization).toBe("Bearer admin-file");
  });
```

`team-status.test.ts`, beside "peered is true or false per member when the switchboard lists the boards":

```ts
  test("an admin whose token is only in the org's admin-only file still sees who is peered", async () => {
    const fetched: Array<{ url: string; auth?: string }> = [];
    const deps = clonedDeps({
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
      fetch: async (url, init) => {
        fetched.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
        return { status: 200, body: JSON.stringify({ boards: [{ username: "dev1" }] }), headers: {} };
      },
      read: { "mattstack.roster": [{ username: "dev1" }, { username: "dev2" }] },
    });
    deps.readLocalSecret = async () => null;
    deps.readAdminSecret = async (org, key) => (org === SLUG && key === "switchboardAdminToken" ? "admin-file" : null);

    await teamStatus(["--team", SLUG, "--json"], {}, deps);

    expect(JSON.parse(deps.lines[0]!).members).toEqual([
      { username: "dev1", peered: true },
      { username: "dev2", peered: false },
    ]);
    expect(fetched).toEqual([{ url: `${switchboardUrl()}/boards`, auth: "Bearer admin-file" }]);
  });
```

`commands/__tests__/team.test.ts:1070`: add `readAdminSecret: async () => null,` to that `MembersSeams` literal.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/board-peers.test.ts lib/team/__tests__/peer.test.ts lib/team/__tests__/members.test.ts commands/__tests__/team-status.test.ts`
Expected: FAIL (the admin reader is never asked).

- [ ] **Step 3: Implement**

`lib/team/board-peers.ts`:

```ts
import { createRealTeamSecretsSeams, readAdminSecret } from "../secrets/team-store.ts";
import { warn as warnLine } from "../ui/warn.ts";

/** Reads one key of an org's admin-only `rt` secrets, or null when the file, the key or this Mac's access is missing. */
export type ReadAdminSecret = (org: string, key: string) => Promise<string | null>;

/** Where an org keeps its admin-only secrets, for a reader that should look there. */
export interface AdminSource {
  org: string;
  read: ReadAdminSecret;
}

/** A failure other than "this Mac cannot open it" goes to the log only: the token still has the local secret to come from. */
export const realReadAdminSecret: ReadAdminSecret = async (org, key) => {
  try {
    return await readAdminSecret(org, "rt", key, createRealTeamSecretsSeams(org));
  } catch (err) {
    warnLine("team", `admin-only secrets for ${org} could not be read: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
};

/** The switchboard admin token from wherever this Mac keeps it, in the order the setup row checks: the environment, the board's .env, the org's admin-only file, then rt's secret. */
export async function readAdminToken(p: Pick<Probes, "home" | "env" | "readFile">, readSecret: ReadLocalSecret, admin: AdminSource | null): Promise<string | null> {
  return (
    p.env.SWITCHBOARD_ADMIN_TOKEN ||
    boardEnvValue(p, "SWITCHBOARD_ADMIN_TOKEN") ||
    (admin ? await admin.read(admin.org, "switchboardAdminToken").catch(() => null) : null) ||
    (await readSecret("switchboardAdminToken").catch(() => null))
  );
}
```

`readPeeredBoards(p, readSecret, admin: AdminSource | null)` passes `admin` to `readAdminToken`; `revokeBoard(p, readSecret, handle, admin: AdminSource | null)` does the same.

`lib/team/peer.ts`: import `realReadAdminSecret, type ReadAdminSecret` from `./board-peers.ts`; add to `PeerSeams`:

```ts
  /** The org's admin-only secrets, read before `readLocalSecret` for the admin token. */
  readAdminSecret: ReadAdminSecret;
```

`realPeerSeams` gains `readAdminSecret: realReadAdminSecret,`; `peerOwnBoard`'s first line becomes:

```ts
  const admin = await readAdminToken(p, seams.readLocalSecret, { org: slug, read: seams.readAdminSecret });
```

`lib/team/members.ts`: import `realReadAdminSecret, type ReadAdminSecret` from `./board-peers.ts`; add to `MembersSeams` after `readLocalSecret`:

```ts
  /** The org's admin-only secrets, where the switchboard admin token is looked for first. */
  readAdminSecret: ReadAdminSecret;
```

`realMembersSeams` gains `readAdminSecret: realReadAdminSecret,`; line 458 becomes:

```ts
  const board = await revokeBoard(p, seams.readLocalSecret, handle, { org: slug, read: seams.readAdminSecret });
```

`commands/team.ts`: import `realReadAdminSecret, type ReadAdminSecret` from `../lib/team/board-peers.ts`; add to `TeamDeps` after `readLocalSecret`:

```ts
  /** The org's admin-only secrets reader (`teamStatus`, `teamPeer`, `members remove`); real by default. */
  readAdminSecret?: ReadAdminSecret;
```

`peerSeamsFor`:

```ts
function peerSeamsFor(deps: TeamDeps): PeerSeams {
  return {
    ...realPeerSeams(),
    ...(deps.readLocalSecret ? { readLocalSecret: deps.readLocalSecret } : {}),
    ...(deps.readAdminSecret ? { readAdminSecret: deps.readAdminSecret } : {}),
    ...deps.peerSeams,
  };
}
```

`teamStatus`:

```ts
    const peeredBoards = await readPeeredBoards(deps.probes, deps.readLocalSecret ?? realReadLocalSecret, { org: slug, read: deps.readAdminSecret ?? realReadAdminSecret });
```

`teamMembersRemove`'s seams object gains `...(deps.readAdminSecret ? { readAdminSecret: deps.readAdminSecret } : {}),` after the `readLocalSecret` spread.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/board-peers.test.ts lib/team/__tests__/peer.test.ts lib/team/__tests__/members.test.ts commands/__tests__/team-status.test.ts commands/__tests__/team.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/board-peers.ts lib/team/peer.ts lib/team/members.ts commands/team.ts lib/team/__tests__/board-peers.test.ts lib/team/__tests__/peer.test.ts lib/team/__tests__/members.test.ts commands/__tests__/team-status.test.ts commands/__tests__/team.test.ts
git commit -m "board peering reads the admin token from the org's admin-only file first"
```

---

### Task 5: Invite and join read the admin-only file first

Plan 2 edits these two files' clone and branch logic in parallel. Touch only the lines named here.

**Files:**
- Modify: `lib/team/invite.ts` (`MintInviteSeams.readLocalSecret` doc at line 135, a new field after it; `realMintInviteSeams` line 253; the token read at lines 363-366)
- Modify: `lib/team/join.ts` (imports lines 23 and 26; `JoinRedeemSeams` lines 292-307; `realJoinRedeemSeams` lines 327-339; `peerBoard`'s token read at lines 394-399)
- Modify: `lib/setup/steps/team.ts` (import line 11; `teamJoinRun`'s seams at lines 155-161)
- Test: `lib/team/__tests__/invite.test.ts`, `lib/team/__tests__/join.test.ts`

**Interfaces:**
- Consumes: `ReadAdminSecret`, `realReadAdminSecret` (Task 4); `readAdminSecret` (Task 2).
- Produces: `MintInviteSeams.readAdminSecret: ReadAdminSecret`; `JoinRedeemSeams.readAdminSecret: typeof readAdminSecret` and `JoinRedeemSeams.readLocalSecret: (key: string) => Promise<string | null>`.

- [ ] **Step 1: Write the failing tests**

`invite.test.ts`: add `readAdminSecret: async () => null,` to `baseSeams`'s literal, then beside "an admin token on this Mac: mint registers the member's board on the built-in switchboard and seals only the token":

```ts
  test("the org's admin-only file is read before this Mac's own secret", async () => {
    const fetchCalls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    const p = fakeProbes({
      home: HOME,
      files: { [GIT_CONFIG_PATH]: gitConfigWithRemote(REMOTE), ...TEAM_FILES },
      fetch: async (url, init) => {
        fetchCalls.push({ url, init });
        return { status: 201, body: JSON.stringify({ username: "zaphod", token: "tok-9" }), headers: {} };
      },
    });
    const { seams } = baseSeams({
      readAdminSecret: async (org, key) => (org === SLUG && key === "switchboardAdminToken" ? "admin-file" : null),
      readLocalSecret: async () => "admin-local",
    });

    const result = await mintInvite(p, fakeRelayClient().client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(result.peering).toBe("embedded");
    expect(fetchCalls[0]!.init?.headers?.Authorization).toBe("Bearer admin-file");
  });

  test("a Mac that cannot open the admin-only file still uses its own secret", async () => {
    const fetchCalls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    const p = fakeProbes({
      home: HOME,
      files: { [GIT_CONFIG_PATH]: gitConfigWithRemote(REMOTE), ...TEAM_FILES },
      fetch: async (url, init) => {
        fetchCalls.push({ url, init });
        return { status: 201, body: JSON.stringify({ username: "zaphod", token: "tok-9" }), headers: {} };
      },
    });
    const { seams } = baseSeams({ readAdminSecret: async () => null, readLocalSecret: async () => "admin-local" });

    await mintInvite(p, fakeRelayClient().client, { slug: SLUG, handle: "zaphod", teams: ["widgets"], now: NOW }, seams);

    expect(fetchCalls[0]!.init?.headers?.Authorization).toBe("Bearer admin-local");
  });
```

`join.test.ts`: add to `baseJoinRedeemSeams`'s literal `readAdminSecret: (async () => null) as JoinRedeemSeams["readAdminSecret"],` and `readLocalSecret: async () => null,`. Then, inside the `describe` that defines `redeemProbes`, beside "no pointer token + a readable admin token":

```ts
  const posting = (fetchCalls: { url: string; init?: Parameters<Probes["fetch"]>[1] }[]) =>
    redeemProbes({
      fetch: async (url, init) => {
        fetchCalls.push({ url, init });
        return { status: 201, body: JSON.stringify({ username: "dev2", token: "tok-1" }), headers: {} };
      },
    });

  test("a re-join reads the org's admin-only file first", async () => {
    const fetchCalls: { url: string; init?: Parameters<Probes["fetch"]>[1] }[] = [];
    // readTeamSecret keeps the default recording stub, so the last assertion proves it was never asked.
    const { seams, calls } = baseJoinRedeemSeams({
      readAdminSecret: (async (_slug: string, _domain: string, key: string) => (key === "switchboardAdminToken" ? "admin-file" : null)) as JoinRedeemSeams["readAdminSecret"],
      readLocalSecret: async () => "admin-local",
    });

    const result = await joinRedeem(posting(fetchCalls), fakeRelay().client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("applied");
    expect(fetchCalls[0]!.init?.headers?.Authorization).toBe("Bearer admin-file");
    expect(calls.readTeamSecret).toEqual([]);
  });

  test("then this Mac's own secret", async () => {
    const fetchCalls: { url: string; init?: Parameters<Probes["fetch"]>[1] }[] = [];
    const { seams } = baseJoinRedeemSeams({ readLocalSecret: async (key) => (key === "switchboardAdminToken" ? "admin-local" : null), readTeamSecret: async () => "admin-legacy" });

    await joinRedeem(posting(fetchCalls), fakeRelay().client, () => NO_SECRETS, { code: CODE }, seams);

    expect(fetchCalls[0]!.init?.headers?.Authorization).toBe("Bearer admin-local");
  });

  test("and last the member-wide team secrets an older org kept it in", async () => {
    const fetchCalls: { url: string; init?: Parameters<Probes["fetch"]>[1] }[] = [];
    const { seams } = baseJoinRedeemSeams({ readTeamSecret: async () => "admin-legacy" });

    await joinRedeem(posting(fetchCalls), fakeRelay().client, () => NO_SECRETS, { code: CODE }, seams);

    expect(fetchCalls[0]!.init?.headers?.Authorization).toBe("Bearer admin-legacy");
  });

  test("a local secret that throws falls through to the team secrets", async () => {
    const fetchCalls: { url: string; init?: Parameters<Probes["fetch"]>[1] }[] = [];
    const { seams } = baseJoinRedeemSeams({ readLocalSecret: async () => { throw new Error("keychain sulking"); }, readTeamSecret: async () => "admin-legacy" });

    await joinRedeem(posting(fetchCalls), fakeRelay().client, () => NO_SECRETS, { code: CODE }, seams);

    expect(fetchCalls[0]!.init?.headers?.Authorization).toBe("Bearer admin-legacy");
  });
```

Every existing join test that stubs `readTeamSecret` keeps passing, because the two new readers default to null.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/invite.test.ts lib/team/__tests__/join.test.ts`
Expected: FAIL (the new seams are never read).

- [ ] **Step 3: Implement**

`lib/team/invite.ts`: import `realReadAdminSecret, type ReadAdminSecret` from `./board-peers.ts`. Replace the `readLocalSecret` doc comment and add the field after it:

```ts
  /** This Mac's own LOCAL rt secret: where the switchboard admin token comes from when the org's admin-only file does not hold it or this Mac cannot open it. */
  readLocalSecret: (key: string) => Promise<string | null>;
  /** The org's admin-only secrets, read first for the switchboard admin token. */
  readAdminSecret: ReadAdminSecret;
```

`realMintInviteSeams` gains `readAdminSecret: realReadAdminSecret,` after `readLocalSecret`. The read at lines 364-365 becomes:

```ts
    adminToken = (await seams.readAdminSecret(opts.slug, "switchboardAdminToken")) || (await seams.readLocalSecret("switchboardAdminToken"));
```

The `requirePeering` refusal's `why` stays; it already names "switchboard admin token".

`lib/team/join.ts`: add `readSecret` to the `../secrets/store.ts` import and `readAdminSecret` to the `../secrets/team-store.ts` import. In `JoinRedeemSeams`, after `readTeamSecret`:

```ts
  /** The org's admin-only secrets: a re-join on an owner's or admin's Mac reads the switchboard admin token here first. */
  readAdminSecret: typeof readAdminSecret;
  /** This Mac's own LOCAL rt secret, the admin token's second source. */
  readLocalSecret: (key: string) => Promise<string | null>;
```

`realJoinRedeemSeams` gains, after `readTeamSecret`:

```ts
    readAdminSecret,
    readLocalSecret: (key) => readSecret("rt", key, { ageKeySeam, execSeam: createRealSecretsExecSeam() }),
```

Add above `peerBoard`:

```ts
/** The admin token in the order every reader keeps: the org's admin-only file, this Mac's own secret, then the member-wide team secrets an older org may have kept it in. */
async function rejoinAdminToken(seams: JoinRedeemSeams, secrets: SecretsSeamsFactory, slug: string): Promise<string | null> {
  return (
    (await seams.readAdminSecret(slug, "rt", "switchboardAdminToken", secrets(slug))) ||
    (await seams.readLocalSecret("switchboardAdminToken").catch(() => null)) ||
    (await seams.readTeamSecret(slug, "rt", "switchboardAdminToken", secrets(slug)))
  );
}
```

In `peerBoard`, replace the comment "Only a re-join by a member whose age key is already a team-secrets recipient can read the admin token here; a first join cannot." with "Only a re-join on a Mac that can open the org's admin-only file or holds the token itself can register a board here; a first join cannot." and the read at line 399 with:

```ts
    const adminToken = await rejoinAdminToken(seams, secrets, pointer.team);
```

`lib/setup/steps/team.ts`: import `readSecret` beside `personalStoreReady, writeSecret`; in `teamJoinRun`'s seams, after `writeLocalSecret`:

```ts
    readLocalSecret: (key: string) => readSecret("rt", key, ctx.secrets),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/invite.test.ts lib/team/__tests__/join.test.ts lib/setup/__tests__/ commands/__tests__/team.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/invite.ts lib/team/join.ts lib/setup/steps/team.ts lib/team/__tests__/invite.test.ts lib/team/__tests__/join.test.ts
git commit -m "invite and join read the admin token from the org's admin-only file first"
```

---

### Task 6: The board-peering row sees the admin-only file

**Files:**
- Modify: `lib/setup/validators/accounts.ts` (`SecretPresence` lines 33-36; `canSelfInvite` lines 263-265)
- Modify: `lib/setup/plan.ts` (`realSecretPresence` lines 205-219)
- Test: `lib/setup/__tests__/validators-accounts.test.ts`

**Interfaces:**
- Consumes: `realReadAdminSecret` (Task 4).
- Produces: `SecretPresence.hasAdmin?(org: string, key: string): Promise<string | null>`; optional, so every existing fake still type-checks and reads every org as holding no admin-only secret.

- [ ] **Step 1: Write the failing tests**

In `validators-accounts.test.ts`, inside the board-peering `describe`, after "the admin token in the environment counts for the creator's Mac":

```ts
  const withAdminFile = (org: string): SecretPresence => ({
    has: async () => null,
    hasAdmin: async (asked, key) => (asked === org && key === "switchboardAdminToken" ? "admin-file" : null),
  });

  test("the admin token in the org's admin-only file counts for the creator's Mac", async () => {
    const r = await peeringRow(machine({ acme: { joinedByRt: false } }), withAdminFile("acme"));
    expect(r.status).toBe("needs-you");
    expect(r.detail).toContain("This Mac holds the switchboard admin token");
  });

  test("a joined owner or admin who can open the admin-only file is pointed at rt team peer", async () => {
    const r = await peeringRow(machine({ acme: { joinedByRt: true } }), withAdminFile("acme"));
    expect(r.detail).toContain("This Mac holds the switchboard admin token");
    expect(r.detail).not.toContain("invite you again");
  });

  test("a Mac that cannot open the admin-only file and holds no token keeps the re-invite remedy", async () => {
    const r = await peeringRow(machine({ acme: { joinedByRt: true } }), withAdminFile("other"));
    expect(r.detail).toContain("invite you again");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/setup/__tests__/validators-accounts.test.ts`
Expected: FAIL (the first two rows still read the re-invite remedy or are absent).

- [ ] **Step 3: Implement**

`accounts.ts`, `SecretPresence`:

```ts
export interface SecretPresence {
  has(domain: string, key: string): Promise<string | null>;
  /** A key from an org's admin-only secrets, or null when absent or this Mac cannot open them. Left out, every org reads as holding none. */
  hasAdmin?(org: string, key: string): Promise<string | null>;
}
```

In `boardPeeringRow`, replace the `canSelfInvite` statement:

```ts
    // Registering a board takes only the switchboard admin token, whoever holds it and wherever it is kept.
    const orgs = peering.teams;
    const inAdminFile = async () => {
      for (const org of orgs) if ((await secrets.hasAdmin?.(org, "switchboardAdminToken")) != null) return true;
      return false;
    };
    const canSelfInvite =
      Boolean(p.env.SWITCHBOARD_ADMIN_TOKEN) ||
      boardEnvHas(p, "SWITCHBOARD_ADMIN_TOKEN") ||
      (await inAdminFile()) ||
      (await secrets.has("rt", "switchboardAdminToken")) !== null;
```

`plan.ts`: import `realReadAdminSecret` from `../team/board-peers.ts`; `realSecretPresence` returns `{ async has(...) {...unchanged}, hasAdmin: (org, key) => realReadAdminSecret(org, key) }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/setup/__tests__/ commands/__tests__/setup-copy.test.ts commands/__tests__/setup-plan.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/validators/accounts.ts lib/setup/plan.ts lib/setup/__tests__/validators-accounts.test.ts
git commit -m "setup: the board-peering row counts the org's admin-only token"
```

---

### Task 7: Members sync and remove keep the admin-only file in step

**Files:**
- Modify: `lib/team/members.ts` (import `followRosterChange`, `* as out from "../ui/out.ts"`; the end of `membersSync` before its `return` at line 360; the end of `membersRemove` after the `removeTeamRecipient` loop at lines 473-477 and its returned `manualSteps`)
- Test: `lib/team/__tests__/members.test.ts`

**Interfaces:**
- Consumes: `followRosterChange` (Task 3); `MembersSeams.readTeamStore` (existing).
- Produces: no new exports. `MembersSyncResult` and `MembersRemoveResult` keep their keys; admin-only files re-encrypted by this run join `reencrypted`, and a failure in `membersRemove` adds one string to `manualSteps`.

- [ ] **Step 1: Write the failing tests**

In `members.test.ts` (import `adminSecretsFile`, `teamSopsYamlPath` from `../../secrets/team-store.ts`), a new `describe`:

```ts
describe("the admin-only secrets follow the roster", () => {
  function storeSeams(initial: Record<string, unknown>) {
    let store = initial;
    return fakeMembersSeams({
      readTeamStore: () => store,
      writeSetting: ((key: string, value: unknown) => {
        store = { ...store, [key]: value };
      }) as MembersSeams["writeSetting"],
    });
  }

  test("removing an admin locks the admin-only file away from them, though the admins list still names them", async () => {
    const { execSeam, secrets } = seamsWithClone();
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets, "admins");
    execSeam.writeFile(adminSecretsFile(SLUG, "rt"), JSON.stringify({ data: "opaque", sops: {} }));
    const { seams } = storeSeams({
      "mattstack.org": { owners: [], admins: ["dev1", "alice"], teams: {} },
      "mattstack.roster": [{ username: "dev1", agePublicKey: OWNER_PUBLIC_KEY }, { username: "alice", agePublicKey: ALICE_PUBLIC_KEY }],
    });

    const result = await membersRemove(fakeProbes({ home: HOME }), secrets, SLUG, "alice", undefined, seams);

    expect(readTeamRecipients(SLUG, secrets, "admins")).toEqual([OWNER_PUBLIC_KEY]);
    expect(result.reencrypted).toContain(adminSecretsFile(SLUG, "rt"));
    expect(result.manualSteps.join(" ")).not.toContain("admin-only");
  });

  test("when that re-encryption fails, the removal still lands and says what is left to do", async () => {
    const { execSeam, secrets } = seamsWithClone(SLUG, { failUpdatekeysOnCall: 1 });
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets);
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY], secrets, "admins");
    execSeam.writeFile(adminSecretsFile(SLUG, "rt"), JSON.stringify({ data: "opaque", sops: {} }));
    const { seams } = storeSeams({
      "mattstack.org": { owners: [], admins: ["dev1", "alice"], teams: {} },
      "mattstack.roster": [{ username: "dev1", agePublicKey: OWNER_PUBLIC_KEY }, { username: "alice", agePublicKey: ALICE_PUBLIC_KEY }],
    });

    const result = await membersRemove(fakeProbes({ home: HOME }), secrets, SLUG, "alice", undefined, seams);

    expect(result.rosterRemoved).toBe(true);
    expect(readTeamRecipients(SLUG, secrets, "admins")).toEqual([OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY]);
    expect(result.manualSteps.at(-1)).toBe("rt could not lock the org's admin-only secrets away from alice yet. Retry with rt team admin-secrets");
  });

  test("a sync that records an admin's key adds it to the admin-only file", async () => {
    const p = fakeProbes({ home: HOME });
    upsertInviteRecord(p, SLUG, "alice", aliceRecord());
    const { execSeam, secrets } = seamsWithClone();
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY], secrets);
    writeTeamRecipients(SLUG, [OWNER_PUBLIC_KEY], secrets, "admins");
    execSeam.writeFile(adminSecretsFile(SLUG, "rt"), JSON.stringify({ data: "opaque", sops: {} }));
    const { seams } = storeSeams({
      "mattstack.org": { owners: [], admins: ["dev1", "alice"], teams: {} },
      "mattstack.roster": [{ username: "dev1", agePublicKey: OWNER_PUBLIC_KEY }],
    });
    const relay = fakeRelay({ readReply: async () => ({ blob: await replyBlob(ALICE_PUBLIC_KEY, "alice") }) });

    const result = await membersSync(p, relay, secrets, SLUG, seams);

    expect(readTeamRecipients(SLUG, secrets, "admins")).toEqual([OWNER_PUBLIC_KEY, ALICE_PUBLIC_KEY]);
    expect(result.reencrypted).toContain(adminSecretsFile(SLUG, "rt"));
  });

  test("an org that keeps no admin-only secrets gets no admins rule from a sync", async () => {
    const p = fakeProbes({ home: HOME });
    const { execSeam, secrets } = seamsWithClone();
    const { seams } = storeSeams({ "mattstack.org": { owners: [], admins: ["dev1"], teams: {} }, "mattstack.roster": [{ username: "dev1", agePublicKey: OWNER_PUBLIC_KEY }] });

    await membersSync(p, fakeRelay(), secrets, SLUG, seams);

    expect(execSeam.readFile(teamSopsYamlPath(SLUG))).not.toContain("admin-secrets");
  });
});
```

`aliceRecord`, `replyBlob`, `fakeRelay`, `upsertInviteRecord` and `seamsWithClone` are this file's existing helpers.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/members.test.ts`
Expected: FAIL (the admins rule never changes).

- [ ] **Step 3: Implement**

`lib/team/members.ts`: `import { followRosterChange } from "./admin-secrets.ts";` and `import * as out from "../ui/out.ts";`.

In `membersSync`, between the `catch` block's end and `return`:

```ts
  const admin = await followRosterChange(p, slug, seams.readTeamStore(slug), secrets);
  for (const f of admin.reencrypted) reencrypted.add(f);
  if (admin.failure) {
    seams.warn(`rt team members sync: admin-only secrets: ${admin.failure}`, {
      title: "rt could not lock the org's admin-only secrets to its owners and admins",
      next: out.cmd("rt team admin-secrets"),
    });
  }
```

In `membersRemove`, after the `for (const key of keysToRemove)` loop:

```ts
  // The roster no longer carries their key, so the admins rule loses it even while the admins list still names them.
  const admin = await followRosterChange(p, slug, seams.readTeamStore(slug), secrets);
  reencrypted = [...new Set([...reencrypted, ...admin.reencrypted])];
  if (admin.failure) warnLine("team", `admin-only secrets after removing ${handle}: ${admin.failure}`);
  const adminSteps = admin.failure ? [`rt could not lock the org's admin-only secrets away from ${handle} yet. Retry with rt team admin-secrets`] : [];
```

and the returned `manualSteps` becomes `[...revoke.manualSteps, ...boardSteps, ...adminSteps]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/members.test.ts commands/__tests__/team-blocks.test.ts commands/__tests__/team.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/team/members.ts lib/team/__tests__/members.test.ts
git commit -m "members sync and remove keep the admin-only secrets in step with the roster"
```

---

### Task 8: The `org.admin-secrets` row

A promotion or demotion made through `rt settings set mattstack.org` or a console edit runs no rt verb that could re-encrypt, so this row is where it surfaces, on the Macs that can fix it.

**Files:**
- Create: `lib/setup/validators/admin-secrets.ts`
- Modify: `lib/setup/plan.ts` (import; the `accounts` group at lines 176-182)
- Test: `lib/setup/__tests__/validators-admin-secrets.test.ts`

**Interfaces:**
- Consumes: `adminKeysIn` (Task 3); `ADMIN_PATH_REGEX`, `parseSopsRules` (Task 1); `SecretPresence` (Task 6); `roleFor` (`lib/team/roles.ts`), `isOrgAdmin` (plan 1).
- Produces: `ADMIN_SECRETS_ROW_ID = "org.admin-secrets"`; `adminSecretsRow(p: Probes, org: string, secrets: SecretPresence): Promise<Row | null>`; `adminSecretsRowSafe(...)` (same signature, a throw becomes an `error` row).

- [ ] **Step 1: Write the failing tests**

`lib/setup/__tests__/validators-admin-secrets.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { fakeProbes } from "./fakes.ts";
import { teamLocalPath } from "../../team/team-local.ts";
import { adminSecretsRow, adminSecretsRowSafe, ADMIN_SECRETS_ROW_ID } from "../validators/admin-secrets.ts";
import type { SecretPresence } from "../validators/accounts.ts";

const HOME = "/home/x";
const ORG = `${HOME}/.mattstack/orgs/acme`;
const ROSTER = [
  { username: "dev1", agePublicKey: "age1dev1", teams: [] },
  { username: "dev2", agePublicKey: "age1dev2", teams: ["widgets"] },
];

function machine(opts: { me?: string; admins?: string[]; locked?: string[] | null; env?: Record<string, string> } = {}) {
  const locked = opts.locked === undefined ? ["age1dev1"] : opts.locked;
  const sops = [
    "creation_rules:",
    "  - path_regex: mattstack/org/secrets/.*",
    "    age: age1dev1,age1dev2",
    ...(locked ? ["  - path_regex: mattstack/org/admin-secrets/.*", `    age: ${locked.join(",")}`] : []),
    "",
  ].join("\n");
  return fakeProbes({
    home: HOME,
    env: opts.env ?? {},
    files: {
      [`${ORG}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": { owners: [], admins: opts.admins ?? ["dev1"], teams: {} }, "mattstack.roster": ROSTER }),
      [`${ORG}/.sops.yaml`]: sops,
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: opts.me ?? "dev1" }),
    },
  });
}

const holding = (token: string | null): SecretPresence => ({ has: async (domain, key) => (domain === "rt" && key === "switchboardAdminToken" ? token : null) });

describe("the org.admin-secrets row", () => {
  test("no row while the file is locked to exactly the owners and admins", async () => {
    expect(await adminSecretsRow(machine(), "acme", holding(null))).toBeNull();
  });

  test("a promotion the file has not caught up with asks for the sync", async () => {
    const r = await adminSecretsRow(machine({ admins: ["dev1", "dev2"] }), "acme", holding(null));
    expect(r).toMatchObject({ id: ADMIN_SECRETS_ROW_ID, status: "needs-you", required: false });
    expect(r!.detail).toBe("The org's owners and admins changed since its admin-only secrets were last locked to them");
    expect(r!.action).toEqual({ type: "steps", label: "Show steps…", steps: ["Run rt team admin-secrets", "Re-check this row"] });
  });

  test("so does a demotion", async () => {
    expect((await adminSecretsRow(machine({ locked: ["age1dev1", "age1dev2"] }), "acme", holding(null)))?.status).toBe("needs-you");
  });

  test("a member's Mac never shows it", async () => {
    expect(await adminSecretsRow(machine({ me: "dev2", admins: ["dev1"], locked: ["age1dev1", "age1dev2"] }), "acme", holding("admin-1"))).toBeNull();
  });

  test("before the token is shared, an admin holding it is asked to share it", async () => {
    const r = await adminSecretsRow(machine({ locked: null }), "acme", holding("admin-1"));
    expect(r?.status).toBe("needs-you");
    expect(r!.detail).toBe("This Mac holds the switchboard admin token, but the org's other owners and admins cannot use it yet");
  });

  test("the environment's token counts too", async () => {
    expect((await adminSecretsRow(machine({ locked: null, env: { SWITCHBOARD_ADMIN_TOKEN: "admin-1" } }), "acme", holding(null)))?.status).toBe("needs-you");
  });

  test("before the token is shared, an admin without it sees nothing", async () => {
    expect(await adminSecretsRow(machine({ locked: null }), "acme", holding(null))).toBeNull();
  });

  test("a check that throws fails only this row", async () => {
    const failing: SecretPresence = { has: async () => { throw new Error("keychain locked"); } };
    expect((await adminSecretsRowSafe(machine({ locked: null }), "acme", failing))?.status).toBe("error");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/setup/__tests__/validators-admin-secrets.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/setup/validators/admin-secrets.ts`:

```ts
/**
 * `org.admin-secrets`: on an org owner's or admin's Mac, says when the org's
 * admin-only secrets are not locked to exactly its current owners and admins,
 * or when this Mac holds the switchboard admin token the org does not share
 * yet. Never required: the token still works from this Mac's own secret.
 */

import { join } from "path";
import { isOrgAdmin } from "../../../packages/rt-client/src/settings/org-roles.ts";
import { ADMIN_PATH_REGEX, parseSopsRules } from "../../secrets/team-store.ts";
import { parseStoreText } from "../../settings/stores.ts";
import { adminKeysIn } from "../../team/admin-secrets.ts";
import { boardEnvHas } from "../../team/board-token.ts";
import { orgStoreFile } from "../../team/org-store.ts";
import { roleFor } from "../../team/roles.ts";
import { orgDirUnder } from "../../rt-paths.ts";
import { row, type Action, type Row } from "../contract.ts";
import type { Probes } from "../probes.ts";
import type { SecretPresence } from "./accounts.ts";

export const ADMIN_SECRETS_ROW_ID = "org.admin-secrets";

const BASE = {
  id: ADMIN_SECRETS_ROW_ID,
  kind: "access" as const,
  title: "Admin-only secrets",
  why: "Lets every org owner and admin use the switchboard admin token, and keeps it from everyone else.",
  required: false,
  optionalNote: "Only the org's owners and admins see this.",
  recheck: "on-activate" as const,
};

const SYNC_STEPS: Action = { type: "steps", label: "Show steps…", steps: ["Run rt team admin-secrets", "Re-check this row"] };

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}

export async function adminSecretsRow(p: Probes, org: string, secrets: SecretPresence): Promise<Row | null> {
  if (!isOrgAdmin(roleFor(p, org))) return null;
  const sops = p.readFile(join(orgDirUnder(p.home, org), ".sops.yaml"));
  const locked = (sops === null ? null : parseSopsRules(sops))?.find((r) => r.pathRegex === ADMIN_PATH_REGEX)?.recipients ?? null;

  if (locked === null) {
    const holds = Boolean(p.env.SWITCHBOARD_ADMIN_TOKEN) || boardEnvHas(p, "SWITCHBOARD_ADMIN_TOKEN") || (await secrets.has("rt", "switchboardAdminToken")) !== null;
    if (!holds) return null;
    return row({ ...BASE, status: "needs-you", detail: "This Mac holds the switchboard admin token, but the org's other owners and admins cannot use it yet", action: SYNC_STEPS });
  }

  const file = orgStoreFile(p.home, org);
  const raw = p.readFile(file);
  const want = adminKeysIn(raw === null ? {} : parseStoreText(file, raw).global).keys;
  if (sameKeys(want, locked)) return null;
  return row({ ...BASE, status: "needs-you", detail: "The org's owners and admins changed since its admin-only secrets were last locked to them", action: SYNC_STEPS });
}

export async function adminSecretsRowSafe(p: Probes, org: string, secrets: SecretPresence): Promise<Row | null> {
  try {
    return await adminSecretsRow(p, org, secrets);
  } catch (err) {
    return row({ ...BASE, status: "error", detail: err instanceof Error ? err.message : String(err), action: { type: "run", label: "Re-check", verb: ["setup", "status"] } });
  }
}
```

`lib/setup/plan.ts`: `import { adminSecretsRowSafe } from "./validators/admin-secrets.ts";` and in the `accounts` group:

```ts
      const adminSecrets = i.orgs.includes(team.slug) ? await adminSecretsRowSafe(i.p, team.slug, i.secrets) : null;
      return [...accounts, ...org, ...(adminSecrets ? [adminSecrets] : [])];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/setup/__tests__/ commands/__tests__/setup-copy.test.ts commands/__tests__/setup-plan.test.ts commands/__tests__/verify-output.test.ts && bun run typecheck`
Expected: PASS. If a plan or copy snapshot moves, confirm the only change is this row on an admin Mac that holds the token, then update it with `bun test --update-snapshots <file>`; any other movement is a bug.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/validators/admin-secrets.ts lib/setup/plan.ts lib/setup/__tests__/validators-admin-secrets.test.ts
git commit -m "setup: org.admin-secrets row for an admins rule that drifted from the roles"
```

---

### Task 9: `rt team admin-secrets`, and the rule

This is how the token first gets into the admin-only file. **It is this plan's proposal; the caller confirms it before execution.** One verb, no positional, owners and admins only:

- locks the admin-only file to the org's current owners and admins (re-encrypting when the set changed),
- puts this Mac's own switchboard admin token (environment, the board's `.env`, or the local rt secret) into the file when the file holds none,
- `--replace-token` puts it in even when the file holds a different one (after the token changes on the switchboard, since readers take the file's copy first),
- never deletes the local secret.

**Files:**
- Modify: `commands/team.ts` (imports; new `adminSecretsBlocks` and `teamAdminSecrets` after `teamPeer`; `REFUSAL_CODES` untouched)
- Modify: `lib/command-tree-def.ts` (new `admin-secrets` node under `team`, beside `peer` at line 2985)
- Modify: `.claude/rules/team-switchboard.md`
- Generated: `website/docs/rt/reference/team/admin-secrets.mdx` (and any index `docs:gen` rewrites)
- Test: `commands/__tests__/team-blocks.test.ts`

**Interfaces:**
- Consumes: `syncAdminSecrets`, `AdminSecretsResult`, `TokenOutcome` (Task 3); `readAdminToken`, `realReadLocalSecret` (Task 4); `createRealTeamSecretsSeams`, `realMembersSeams` (existing).
- Produces: `adminSecretsBlocks(result: AdminSecretsResult): Block[]`; `teamAdminSecrets(args, ctx, deps)`; `--json` prints `envelope(result)`: `{ state, holders, withoutKey, added, removed, reencrypted, token, contract, at }`.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/team-blocks.test.ts` (import `adminSecretsBlocks` from `../team.ts` and `type AdminSecretsResult` from `../../lib/team/admin-secrets.ts`):

```ts
const adminSecrets = (extra: Partial<AdminSecretsResult> = {}): AdminSecretsResult => ({
  state: "updated",
  holders: ["dev1", "dev2"],
  withoutKey: [],
  added: ["age1dev2"],
  removed: [],
  reencrypted: [],
  token: "none",
  ...extra,
});

test("admin-secrets says who the file is locked to and what happened to the token", () => {
  expect(renderPlain(adminSecretsBlocks(adminSecrets({ token: "seeded" })))).toBe(
    "[ok] Locked the admin-only secrets to the org's owners and admins  dev1, dev2\n[ok] Shared this Mac's switchboard admin token with them\n",
  );
});

test("admin-secrets with nothing to change says so", () => {
  expect(renderPlain(adminSecretsBlocks(adminSecrets({ state: "current", added: [], token: "kept" })))).toBe(
    "[skipped] The admin-only secrets already open for exactly the org's owners and admins  dev1, dev2\n",
  );
});

test("admin-secrets in an org that keeps none, on a Mac with no token", () => {
  expect(renderPlain(adminSecretsBlocks(adminSecrets({ state: "unused", added: [], holders: [] })))).toBe(
    "[skipped] This org keeps no admin-only secrets yet  this Mac holds no switchboard admin token to share\n",
  );
});

test("admin-secrets warns that someone taken off keeps what they opened, and names who has no key", () => {
  const text = renderPlain(adminSecretsBlocks(adminSecrets({ added: [], removed: ["age1dev3"], withoutKey: ["dev4"] })));
  expect(text).toContain("dev4 cannot open them yet: the roster has no age key for them.");
  expect(text).toContain("Anyone taken off keeps any value they already opened. Change the switchboard admin token to shut them out.");
});

test("admin-secrets never overwrites a different shared token unasked", () => {
  const text = renderPlain(adminSecretsBlocks(adminSecrets({ state: "current", added: [], token: "differs" })));
  expect(text).toContain("[needs you] The org shares a different switchboard admin token from this Mac's");
  expect(text).toContain("rt team admin-secrets --replace-token");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test commands/__tests__/team-blocks.test.ts`
Expected: FAIL (`adminSecretsBlocks` is not exported).

- [ ] **Step 3: Implement**

`commands/team.ts` imports: `syncAdminSecrets, type AdminSecretsResult, type TokenOutcome` from `../lib/team/admin-secrets.ts`; add `readAdminToken` to the `../lib/team/board-peers.ts` import. After `teamPeer`:

```ts
const TOKEN_BLOCKS: Record<TokenOutcome, () => Block[]> = {
  seeded: () => [out.line("done", "Shared this Mac's switchboard admin token with them")],
  replaced: () => [out.line("done", "Replaced the switchboard admin token they share with this Mac's")],
  differs: () => [
    out.line("needs-you", "The org shares a different switchboard admin token from this Mac's", "keep theirs unless yours is the newer one"),
    out.callout("next", out.cmd("rt team admin-secrets --replace-token")),
  ],
  kept: () => [],
  none: () => [],
};

export function adminSecretsBlocks(result: AdminSecretsResult): Block[] {
  if (result.state === "unused") {
    return [out.line("skipped", "This org keeps no admin-only secrets yet", "this Mac holds no switchboard admin token to share")];
  }
  const who = result.holders.join(", ");
  const relocked = result.added.length > 0 || result.removed.length > 0;
  return [
    relocked
      ? out.line("done", "Locked the admin-only secrets to the org's owners and admins", who)
      : out.line("skipped", "The admin-only secrets already open for exactly the org's owners and admins", who),
    ...TOKEN_BLOCKS[result.token](),
    ...(result.withoutKey.length > 0 ? [out.callout("note", `${result.withoutKey.join(", ")} cannot open them yet: the roster has no age key for them.`)] : []),
    ...(result.removed.length > 0 ? [out.callout("note", "Anyone taken off keeps any value they already opened. Change the switchboard admin token to shut them out.")] : []),
  ];
}

export async function teamAdminSecrets(args: string[], _ctx: CommandContext = {}, deps: TeamDeps = realTeamDeps()): Promise<void> {
  const json = args.includes("--json");
  try {
    const slug = resolveTeamSlug(args, "team admin-secrets");
    const token = await readAdminToken(deps.probes, deps.readLocalSecret ?? realReadLocalSecret, null);
    const orgStore = (deps.membersSeams ?? realMembersSeams()).readTeamStore(slug);
    const result = await syncAdminSecrets(deps.probes, slug, orgStore, createRealTeamSecretsSeams(slug), {
      token,
      replaceToken: args.includes("--replace-token"),
    });
    if (json) {
      deps.print(JSON.stringify(envelope(result)));
      return;
    }
    out.print(...adminSecretsBlocks(result));
  } catch (err) {
    if (err instanceof UserActionableError) exitTeamError(err, json, deps);
    throw err;
  }
}
```

`readAdminToken(..., null)` reads only this Mac's own copies (environment, the board's `.env`, the local secret), never the file being written.

`lib/command-tree-def.ts`, under `team`, after `peer`:

```ts
      "admin-secrets": {
        description: "Share the switchboard admin token with your org's owners and admins, and keep it locked to them",
        module: "./commands/team.ts",
        fn: "teamAdminSecrets",
        args: [
          { name: "Team", flag: "--team", type: "text", placeholder: "acme", hint: "Which org clone; your only one when left out" },
          { name: "Replace token", flag: "--replace-token", type: "boolean", default: false, hint: "Put this Mac's token in even when the org already shares a different one" },
          SETUP_JSON_ARG,
        ],
      },
```

The node has no positional, so it needs no `omitBehavior`; `./commands/team.ts` is already in `lib/module-registry.ts`.

`.claude/rules/team-switchboard.md`:
- Add `  - "lib/secrets/team-store.ts"` to the frontmatter `paths`.
- In the `account.board-peering` sentence, change "(in rt's secrets, the environment or the board's `.env`)" to "(in the environment, the board's `.env`, the org's admin-only secrets or rt's secrets)".
- Add this paragraph before "Change invite, join, peer and the row together":

```markdown
The switchboard admin token lives in the org's admin-only secrets
(`mattstack/org/admin-secrets/rt.json`, key `switchboardAdminToken`),
locked by `.sops.yaml`'s admins rule to the age keys the roster records for
the org's owners and admins (`lib/team/admin-secrets.ts`).
`lib/secrets/team-store.ts` owns exactly that rule and the members rule,
writes the members rule first, and refuses any other. Every reader
(`readAdminToken` in `lib/team/board-peers.ts`, invite, join, the
`account.board-peering` row) reads the admin-only file before this Mac's
own `rt` secret, so a Mac that has not pulled the move keeps working, and a
Mac that cannot open the file reads it as absent. `rt team admin-secrets`
(owners and admins) locks the file to the current owners and admins and
puts this Mac's token in when the file holds none (`--replace-token` after
the token changes); `rt team members sync` and `remove` run the same sync,
and the `org.admin-secrets` row asks for it when the roles drift or this
Mac's token is not shared yet. An rt older than this refuses a `.sops.yaml`
with both rules, so share the token only once every admin runs this rt.
```

- [ ] **Step 4: Run tests, the gates and the docs**

Run: `bun test commands/__tests__/team-blocks.test.ts lib/__tests__/ && bun run picker:check && bun run docs:gen && bun run docs:check && bun run typecheck`
Expected: PASS; `docs:gen` writes `website/docs/rt/reference/team/admin-secrets.mdx`. `lib/__tests__/no-agent-docs-bloat.test.ts` checks the rule file's frontmatter globs match files.

Then the whole touched surface once: `bun test lib/secrets lib/team lib/setup commands/__tests__/team*.test.ts commands/__tests__/setup*.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/team.ts lib/command-tree-def.ts .claude/rules/team-switchboard.md website/docs/rt/reference/team commands/__tests__/team-blocks.test.ts
git commit -m "rt team admin-secrets: share the switchboard admin token with the org's owners and admins"
```

---

### Task 10: The daemon serves the board the admin token from the admin-only file first

The board gets the switchboard admin token from the daemon's `secrets:read` (scope `board`), which today reads only the local `rt` secret (`BOARD_SECRET_ENTRIES`, `lib/daemon/handlers/secrets.ts:59-66`). The board itself checks `process.env.SWITCHBOARD_ADMIN_TOKEN` before asking the daemon (`apps/board/src/config.ts:954-956`); that stays as it is, so the daemon applies only the stored half of Task 4's order: the admin-only file, then the local secret.

**Files:**
- Modify: `lib/team/board-peers.ts` (new `readStoredAdminToken`; `readAdminToken` from Task 4 calls it)
- Modify: `lib/daemon/handlers/secrets.ts` (imports at lines 46-53; the `payload.scope` paragraph of the module doc at lines 33-44; `loadBoardSecrets` at lines 115-123)
- Modify: `.claude/rules/team-switchboard.md` (one sentence in Task 9's paragraph)
- Test: `lib/team/__tests__/board-peers.test.ts`, `lib/daemon/__tests__/secrets-handler.test.ts`

**Interfaces:**
- Consumes: `AdminSource`, `ReadLocalSecret`, `realReadAdminSecret` (Task 4); `currentOrg()` (`lib/settings/stores.ts`, re-exported from rt-client).
- Produces:
  - `readStoredAdminToken(readLocal: ReadLocalSecret, admin: AdminSource | null): Promise<string | null>` in `lib/team/board-peers.ts`: the admin-only file (a throwing reader reads as absent), then `readLocal("switchboardAdminToken")`, whose throw is the caller's.
  - `loadBoardSecrets(readSecretFn: ReadSecretFn = defaultReadSecret, admin: AdminSource | null = boardAdminSource()): Promise<BoardSecretsData>`. `BoardSecretsData`, `BOARD_SECRET_ENTRIES` and the `secrets:read` envelope are unchanged.

- [ ] **Step 1: Write the failing tests**

`board-peers.test.ts` (import `readStoredAdminToken`), inside the `describe("the admin-only file", ...)` block from Task 4:

```ts
  test("readStoredAdminToken never looks at the environment or the board's .env", async () => {
    expect(await readStoredAdminToken(secrets({ switchboardAdminToken: "admin-local" }), adminFile(null))).toBe("admin-local");
    expect(await readStoredAdminToken(secrets({}), adminFile("admin-file"))).toBe("admin-file");
  });

  test("readStoredAdminToken leaves a throwing local read to its caller; readAdminToken swallows it", async () => {
    const throwing = async () => { throw new Error("keychain locked"); };
    await expect(readStoredAdminToken(throwing, adminFile(null))).rejects.toThrow("keychain locked");
    expect(await readAdminToken(fakeProbes({}), throwing, adminFile(null))).toBeNull();
  });
```

`lib/daemon/__tests__/secrets-handler.test.ts`, inside `describe("loadBoardSecrets", ...)` (import `type AdminSource` from `../../team/board-peers.ts`):

```ts
  const recording = () => {
    const calls: Array<[string, string]> = [];
    const fake: ReadSecretFn = async (domain, key) => {
      calls.push([domain, key]);
      return `${domain}:${key}`;
    };
    return { calls, fake };
  };
  const adminFile = (value: string | null): AdminSource => ({
    org: "acme",
    read: async (org, key) => (org === "acme" && key === "switchboardAdminToken" ? value : null),
  });

  test("the admin token comes from the org's admin-only file first, and the local secret is not asked", async () => {
    const { calls, fake } = recording();

    const data = await loadBoardSecrets(fake, adminFile("file-admin"));

    expect(data.switchboardAdminToken).toBe("file-admin");
    expect(calls).not.toContainEqual(["rt", "switchboardAdminToken"]);
    expect(data.switchboardToken).toBe("rt:switchboardToken");
  });

  test("a Mac that cannot open the file gets the local secret, read in its usual place", async () => {
    const { calls, fake } = recording();

    const data = await loadBoardSecrets(fake, adminFile(null));

    expect(data.switchboardAdminToken).toBe("rt:switchboardAdminToken");
    expect(calls.at(-1)).toEqual(["rt", "switchboardAdminToken"]);
  });

  test("an admin-only reader that throws reads as absent", async () => {
    const { fake } = recording();
    const failing: AdminSource = { org: "acme", read: async () => { throw new Error("sops crashed"); } };

    expect((await loadBoardSecrets(fake, failing)).switchboardAdminToken).toBe("rt:switchboardAdminToken");
  });

  test("with no org on this Mac, only the local secret is read", async () => {
    const { fake } = recording();
    expect((await loadBoardSecrets(fake, null)).switchboardAdminToken).toBe("rt:switchboardAdminToken");
  });

  test("a throwing local admin-token read still rejects the whole call", async () => {
    const fake: ReadSecretFn = async (domain, key) => {
      if (key === "switchboardAdminToken") throw new Error("sops -d exploded");
      return `${domain}:${key}`;
    };
    await expect(loadBoardSecrets(fake, adminFile(null))).rejects.toThrow("sops -d exploded");
  });
```

The existing `loadBoardSecrets` tests call it with one argument; under the test HOME no org holds an admin-only file, so the default source reads as absent with no sops call and their expectations (all six entries, in order) still hold. If a test seeds an org through `seedOrg`, `currentOrg()` names it, and the file is still absent.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test lib/team/__tests__/board-peers.test.ts lib/daemon/__tests__/secrets-handler.test.ts`
Expected: FAIL (`readStoredAdminToken` is not exported; `loadBoardSecrets` ignores its second argument).

- [ ] **Step 3: Implement**

`lib/team/board-peers.ts`, above `readAdminToken`:

```ts
/** The admin token rt keeps itself: the org's admin-only file, then this Mac's local secret. A throwing local read is the caller's to handle. */
export async function readStoredAdminToken(readLocal: ReadLocalSecret, admin: AdminSource | null): Promise<string | null> {
  return (admin ? await admin.read(admin.org, "switchboardAdminToken").catch(() => null) : null) || (await readLocal("switchboardAdminToken"));
}
```

and `readAdminToken` becomes:

```ts
export async function readAdminToken(p: Pick<Probes, "home" | "env" | "readFile">, readSecret: ReadLocalSecret, admin: AdminSource | null): Promise<string | null> {
  return (
    p.env.SWITCHBOARD_ADMIN_TOKEN ||
    boardEnvValue(p, "SWITCHBOARD_ADMIN_TOKEN") ||
    (await readStoredAdminToken((key) => readSecret(key).catch(() => null), admin))
  );
}
```

`lib/daemon/handlers/secrets.ts`: add imports

```ts
import { currentOrg } from "../../settings/stores.ts";
import { readStoredAdminToken, realReadAdminSecret, type AdminSource } from "../../team/board-peers.ts";
```

Add to the module doc's board-scope paragraph: "switchboardAdminToken is read from the org's admin-only secrets first and the local `rt` secret second (`readStoredAdminToken`); the board checks its own environment before asking." Then replace `loadBoardSecrets`:

```ts
/** The org this Mac reads, whose admin-only secrets hold the switchboard admin token; null on a Mac with no org. */
function boardAdminSource(): AdminSource | null {
  const org = currentOrg();
  return org === null ? null : { org, read: realReadAdminSecret };
}

/** Reads BOARD_SECRET_ENTRIES in order; a throw on any entry (e.g. the first `rt`-domain read after `board`'s three succeed) rejects the whole call with nothing partial returned. The switchboard admin token comes from the org's admin-only file when this Mac can open it, else from its local entry. */
export async function loadBoardSecrets(readSecretFn: ReadSecretFn = defaultReadSecret, admin: AdminSource | null = boardAdminSource()): Promise<BoardSecretsData> {
  const out: BoardSecretsData = {};
  for (const [domain, key] of BOARD_SECRET_ENTRIES) {
    const value =
      domain === "rt" && key === "switchboardAdminToken"
        ? await readStoredAdminToken((k) => readSecretFn("rt", k), admin)
        : await readSecretFn(domain, key);
    if (value !== null) out[key] = value;
  }
  return out;
}
```

`realReadAdminSecret` returns null without spawning sops when the file is absent, and logs any other failure through `warn` (the daemon sets no warning log, so it lands as an `rt:` line in the daemon's captured stderr).

`.claude/rules/team-switchboard.md`: in the paragraph Task 9 added, after "...reads it as absent.", add: "The daemon's `secrets:read` board scope serves the board the token the same way (`loadBoardSecrets`, `lib/daemon/handlers/secrets.ts`), after the board's own environment."

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/team/__tests__/board-peers.test.ts lib/daemon/__tests__/secrets-handler.test.ts lib/team/__tests__/peer.test.ts lib/team/__tests__/members.test.ts && bun run typecheck && bun test lib/__tests__/no-agent-docs-bloat.test.ts`
Expected: PASS. A merged daemon change goes live only after the dev daemon restarts on the updated checkout.

- [ ] **Step 5: Commit**

```bash
git add lib/team/board-peers.ts lib/daemon/handlers/secrets.ts .claude/rules/team-switchboard.md lib/team/__tests__/board-peers.test.ts lib/daemon/__tests__/secrets-handler.test.ts
git commit -m "daemon: serve the board the admin token from the org's admin-only file first"
```

---

## Spec gaps found while planning

1. **No verb changes roles.** A promotion or demotion today is `rt settings set mattstack.org ... --scope org`, a hand edit, or a console edit, none of which can run sops. The spec says promoting or demoting "re-encrypts it" without naming a trigger. This plan re-encrypts automatically on `rt team members sync` and `remove`, surfaces every other drift through the `org.admin-secrets` row, and leaves the fix to `rt team admin-secrets`. Plan 3's applier ("after every roster or role change that Mac makes, and on each update run") is the natural place to call `followRosterChange` automatically once both plans have merged.
2. **Join reads the member-wide org secrets today.** `peerBoard` (`lib/team/join.ts:399`) reads `switchboardAdminToken` from `mattstack/org/secrets/rt.json`, which every member can open, not from the local secret. This plan keeps that read as a third, last source so no org that kept the token there breaks. The spec should say whether to drop it: a token kept there is readable by every member, which defeats "admin-only".
3. **The board's own reader is not in the spec's list.** `apps/board` gets the admin token through the daemon's `secrets` handler (`lib/daemon/handlers/secrets.ts`, `BOARD_SECRET_ENTRIES`), which read only the local `rt` secret. Task 10 covers it.
4. **Token changes.** Because readers take the file's copy first, a token changed on the switchboard leaves a stale file winning over a fresh local secret. This plan adds `--replace-token` for that; the spec does not mention token changes.
5. **Temporary files are not ignored.** sops writes `<file>.<pid>.tmp` beside the target while encrypting. The scaffold's `.gitignore` ignores only `mattstack/org/secrets/*.tmp`, so a daemon auto-commit landing during a write could commit an encrypted `mattstack/org/admin-secrets/*.tmp`. Plan 2 covers it: it adds `mattstack/org/admin-secrets/*.tmp` to `.gitignore` in create and the conversion script (see Global Constraints); this plan stays out of `lib/team/create.ts`.
6. **Older rt and two rules.** An older rt's `writeTeamRecipients` refuses a `.sops.yaml` with more than one rule, so on an admin Mac still on an older rt, `rt team members sync` and `remove` refuse once the admins rule exists. Its reads still work (members rule first). The rule file says to share the token only once every admin runs this rt; the conversion runbook may want the same line.
7. **One key per person.** The admins rule names only the roster's `agePublicKey` for each owner or admin, so an admin's second Mac (a key in the members rule but not on the roster) cannot open the file.
8. **Reader order.** The spec says "the admin-only file first and the local secret second". `readAdminToken` keeps the environment and the board's `.env` ahead of both, since those are overrides a person set on purpose; invite and join never read those two and keep not reading them.
