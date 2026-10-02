# One Built-in Switchboard URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The switchboard URL becomes one built-in constant read through `switchboardUrl()`; no setting holds it, no setup row asks for it, and the board token only ever goes to it.

**Architecture:** `packages/rt-client/src/switchboard.ts` owns `SWITCHBOARD_URL` and `switchboardUrl(env, warn)`, with the hidden `RT_SWITCHBOARD_URL` override (https, or http to loopback). rt's invite relay, invite mint, join, daemon peer waker, the `account.board-peering` row and the board (config, server, invite parsing, setup script, triage) all call it. The three stored copies (`board.switchboardUrl`, `rt.integrations.switchboardUrl`, the board's legacy `config.json` `switchboard.url`) are retired: readers and writers go first, then the registry, then a dated setup migration deletes what machines still carry.

**Tech Stack:** Bun + TypeScript (rt CLI, daemon, rt-client), the board app (`apps/board`, bun test + tsc), zod settings registry with a JSON schema lock, Fast Browser for the board render check.

**Spec:** `docs/superpowers/specs/2026-10-02-switchboard-url-constant-design.md`

## Global Constraints

- No em dashes or en dashes anywhere: code, comments, test names, commit messages, docs. Use "...", parens, or rephrase.
- Clean-code comments only: a comment states a constraint the code cannot show. Never narrate, never cite tasks, tickets of this plan, reviews or history. Delete a comment that the change makes false rather than rewording it into history.
- Code under `lib/` never calls `console.*` (the raw-output guard `lib/__tests__/no-raw-output.test.ts` fails otherwise). `packages/rt-client` and `apps/board` are outside that guard.
- Root tests run from the repo root (`bun test <path>` or `bun run test`); board tests run from `apps/board` (`cd apps/board && bun test <path>`). A run started anywhere else skips the HOME-isolating preload.
- A child started by `Bun.spawn`/`Bun.spawnSync` gets `env: childEnv()` (from `lib/subprocess.ts`) or an explicit env built on it.
- After touching anything under `packages/rt-client/src`, run `cd packages/rt-client && bun run build` before the task's final test run; `packages/rt-client/test/dist-freshness.test.ts` fails otherwise.
- Never run a built rt binary, and never start a daemon, against the real HOME. Any `bun cli.ts ...` run in this plan uses an isolated `HOME` and `RT_BATCH=1`.
- `--json` envelopes are frozen contracts: a removed setup row simply disappears from `rt setup plan|status --json`; no other key, type or exit code changes. `rt team invite --json`'s `peering` keeps its three values (`embedded | missing | none`); `rt team join --json`'s `peering` keeps `applied | idle | unavailable`.
- Do not touch `lib/team/invite-crypto.ts` (another lane owns `assertInvitePointerShape`). The only pointer change is in `lib/setup/intent.ts`'s type (`switchboard.url` optional) plus one small, separate check in `lib/team/join.ts` that refuses a pointer whose URL differs from `switchboardUrl()`.
- Copy a person reads follows AGENTS.md's command-description style: short plain sentences, no flags, store names or file paths mid-sentence.
- Commit after each task: short imperative subject, blank line, then exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A Mac that updated rt but has not yet run the migration still has `board.switchboardUrl`, `rt.integrations.switchboardUrl` or a `config.json` `switchboard.url` on disk. Nothing may read them: the board's config must resolve to `switchboardUrl()` whatever the store or file says. Pinned in Task 4 (`config-store-latch` and `config` tests) and Task 6 (`no-switchboard-url-setting` source guard).
2. `RT_SWITCHBOARD_URL` set to plain http on a non-loopback host, to a URL with credentials, or to garbage must never be used: one warning (without echoing the value) and the built-in URL. Pinned in Task 1.
3. An invite pointer minted by an older rt still carries `switchboard.url`. When that URL differs from `switchboardUrl()`, the token is refused, nothing is stored, the secrets store is not even consulted before redeem, and join reports `unavailable`. A matching URL (trailing slash aside) is accepted. Pinned in Task 2.
4. A board invite pasted from another host must be refused before any network call, with no token written to `.env` and peering not started. Pinned in Task 4 (`peer-onboard` and `peer-invite` tests).
5. A Mac in no team must see no `account.board-peering` row, and its board must show no missing-token banner. Pinned in Task 3 (`validators-accounts`) and Task 4 (`peer-token-banner`).

---

## File Structure

Created:
- `packages/rt-client/src/switchboard.ts`: the constant and `switchboardUrl()`.
- `packages/rt-client/test/switchboard.test.ts`: helper tests through the public index.
- `lib/setup/migrations/retire-switchboard-url.ts`: the dated migration.
- `lib/setup/__tests__/migration-retire-switchboard-url.test.ts`: migration tests.
- `lib/__tests__/no-switchboard-url-setting.test.ts`: source guard that no code reads or writes a stored switchboard URL.
- `apps/board/src/__tests__/peer-token-banner.test.ts`: the banner gate.

Modified (by task):
- Task 1: `packages/rt-client/src/index.ts`, `lib/team/relay-client.ts`, `lib/team/__tests__/relay-client.test.ts`, `commands/team.ts`, `commands/setup.ts`, `commands/uninstall.ts`, `lib/daemon.ts`.
- Task 2: `lib/setup/intent.ts`, `lib/team/invite.ts`, `lib/team/join.ts`, `lib/daemon.ts`, `commands/team.ts`, tests `lib/team/__tests__/invite.test.ts`, `lib/team/__tests__/join.test.ts`, `commands/__tests__/team.test.ts`, `commands/__tests__/team-join.test.ts`, `lib/daemon/__tests__/peer-waker-relay.test.ts`.
- Task 3: `lib/setup/contract.ts`, `lib/setup/integrations.ts`, `lib/setup/team-settings.ts`, `lib/setup/validators/accounts.ts`, `lib/setup/validators/access.ts`, `lib/team/board-token.ts`, `commands/setup.ts`, `lib/command-tree-def.ts`, `lib/daemon.ts`, `lib/__tests__/no-settings-bypass.test.ts`, generated `website/docs/reference/setup/**`, tests `lib/setup/__tests__/{validators-accounts,validators-access,integrations,plan,steps-c}.test.ts`, `lib/team/__tests__/board-token.test.ts`, `commands/__tests__/setup-connect.test.ts`.
- Task 4: `apps/board/src/config.ts`, `apps/board/src/server.ts`, `apps/board/src/peer/invite.ts`, `apps/board/src/peer/onboard.ts`, `apps/board/src/peer/runtime.ts`, `apps/board/src/client/types.ts`, `apps/board/scripts/setup.ts`, `apps/board/bin/triage.ts`, tests `apps/board/src/__tests__/{config,config-store-latch,peer-invite,peer-onboard}.test.ts`.
- Task 5: `packages/rt-client/src/settings/registry-defs.ts`, `registry-schemas.ts`, `registry-machinery.ts`, `schema.lock.json`, tests `schema-examples.ts`, `registry.test.ts`, `resolve.test.ts`.
- Task 6: `lib/setup/migrations/index.ts`, `lib/team/board-token.ts` (exports).
- Task 7: `AGENTS.md`, `website/docs/guides/teams-and-invites.mdx`, `apps/board/docs/peer-boards.md`, `apps/board/docs/configuration.md`, `apps/board/docs/api.md`, `apps/board/config.example.json`, `apps/board/config.team.example.json`, `rt-tray/vm/fixtures/team-kitchen-sink/settings.team.json`, `rt-tray/vm/fixtures/team-kitchen-sink/README.md`, `rt-tray/vm/check-vm-scripts.sh`.

Line numbers below are as of commit `95645cfd7`; re-find each region by its quoted text before editing.

---

### Task 1: The constant, `switchboardUrl()`, and the invite relay folded into it

**Files:**
- Create: `packages/rt-client/src/switchboard.ts`
- Create: `packages/rt-client/test/switchboard.test.ts`
- Modify: `packages/rt-client/src/index.ts` (after the `redactCredentials` export, line 4)
- Modify: `lib/team/relay-client.ts:12-19`
- Modify: `lib/team/__tests__/relay-client.test.ts:2,50-63`
- Modify: `commands/team.ts:45,343,415,480`, `commands/setup.ts:59,176`, `commands/uninstall.ts:19,44`, `lib/daemon.ts:43,949`

**Interfaces:**
- Produces: `export const SWITCHBOARD_URL = "https://switchboard.mattstack.dev"` and `export function switchboardUrl(env?: Record<string, string | undefined>, warn?: (message: string) => void): string`, exported from `packages/rt-client/src/switchboard.ts` and re-exported from `@mattstack/rt-client`'s index. Returns the accepted `RT_SWITCHBOARD_URL` (https, or http to `localhost`/`127.0.0.1`/`[::1]`, no userinfo) with trailing slashes stripped, else `SWITCHBOARD_URL`. rt code imports it as `../../packages/rt-client/src/switchboard.ts` (path relative to the importer); the board imports it from `@mattstack/rt-client`.
- Removes: `DEFAULT_INVITE_RELAY_URL` and `inviteRelayUrl` from `lib/team/relay-client.ts`, and the `RT_INVITE_RELAY_URL` env var.

- [ ] **Step 1: Write the failing test**

Create `packages/rt-client/test/switchboard.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { SWITCHBOARD_URL, switchboardUrl } from "../src/index.ts";

function collector(): { warn: (message: string) => void; seen: string[] } {
  const seen: string[] = [];
  return { warn: (message) => seen.push(message), seen };
}

describe("switchboardUrl", () => {
  test("defaults to the built-in switchboard", () => {
    expect(SWITCHBOARD_URL).toBe("https://switchboard.mattstack.dev");
    expect(switchboardUrl({})).toBe(SWITCHBOARD_URL);
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: "" })).toBe(SWITCHBOARD_URL);
  });

  test("honours an https override and strips a trailing slash", () => {
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: "https://relay.example.test/" })).toBe("https://relay.example.test");
  });

  test("honours plain http only on this machine", () => {
    const { warn, seen } = collector();
    for (const url of ["http://localhost:7940", "http://127.0.0.1:7940", "http://[::1]:7940"]) {
      expect(switchboardUrl({ RT_SWITCHBOARD_URL: `${url}/` }, warn)).toBe(url);
    }
    expect(seen).toEqual([]);
  });

  test("refuses plain http to another host, warns once, and falls back", () => {
    const { warn, seen } = collector();
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: "http://relay.example.test" }, warn)).toBe(SWITCHBOARD_URL);
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: "http://relay.example.test" }, warn)).toBe(SWITCHBOARD_URL);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("RT_SWITCHBOARD_URL");
  });

  test("refuses an override that is not a url, carries credentials, or is not http(s), without echoing it", () => {
    const { warn, seen } = collector();
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: "not a url" }, warn)).toBe(SWITCHBOARD_URL);
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: "https://user:hunter2@relay.example.test" }, warn)).toBe(SWITCHBOARD_URL);
    expect(switchboardUrl({ RT_SWITCHBOARD_URL: "ftp://relay.example.test" }, warn)).toBe(SWITCHBOARD_URL);
    expect(seen).toHaveLength(3);
    expect(seen.join("\n")).not.toContain("hunter2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/rt-client/test/switchboard.test.ts`
Expected: FAIL, `SyntaxError: Export named 'SWITCHBOARD_URL' not found` (or `switchboardUrl is not a function`).

- [ ] **Step 3: Write the implementation**

Create `packages/rt-client/src/switchboard.ts`:

```ts
import { emitSettingsWarning } from "./settings/resolve.ts";

export const SWITCHBOARD_URL = "https://switchboard.mattstack.dev";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const warnedOverrides = new Set<string>();

/** A board token rides every relay call, so an override must be https, or plain http that never leaves this machine. */
function acceptedOverride(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.username !== "" || parsed.password !== "") return null;
  const local = parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !local) return null;
  return raw.replace(/\/+$/, "");
}

/** The one switchboard every board token and invite goes to. `RT_SWITCHBOARD_URL` exists for local relay work and tests; it is never written or shown. */
export function switchboardUrl(env: Record<string, string | undefined> = process.env, warn: (message: string) => void = emitSettingsWarning): string {
  const raw = env.RT_SWITCHBOARD_URL;
  if (!raw) return SWITCHBOARD_URL;
  const accepted = acceptedOverride(raw);
  if (accepted) return accepted;
  if (!warnedOverrides.has(raw)) {
    warnedOverrides.add(raw);
    warn(`rt: ignoring RT_SWITCHBOARD_URL, which must be https or http to this machine; using ${SWITCHBOARD_URL}`);
  }
  return SWITCHBOARD_URL;
}
```

In `packages/rt-client/src/index.ts`, after `export { redactCredentials } from "./redact.ts";` add:

```ts
export { SWITCHBOARD_URL, switchboardUrl } from "./switchboard.ts";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/rt-client/test/switchboard.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Fold the invite relay into the helper**

In `lib/team/relay-client.ts`, delete these lines (12-19):

```ts
export const DEFAULT_INVITE_RELAY_URL = "https://switchboard.mattstack.dev";

const REQUEST_TIMEOUT_MS = 10_000;

export function inviteRelayUrl(env: Record<string, string | undefined>): string {
  const override = env.RT_INVITE_RELAY_URL;
  return stripTrailingSlash(override && override.length > 0 ? override : DEFAULT_INVITE_RELAY_URL);
}
```

and put back only:

```ts
const REQUEST_TIMEOUT_MS = 10_000;
```

Keep `stripTrailingSlash` (used by `createRelayClient`).

In `lib/team/__tests__/relay-client.test.ts`, change line 2 to:

```ts
import { createRelayClient } from "../relay-client.ts";
```

and delete the whole `describe("inviteRelayUrl", () => { ... });` block (lines 50-63); its cases now live in `packages/rt-client/test/switchboard.test.ts`.

Switch every caller (each is `inviteRelayUrl(<probes>.env)` -> `switchboardUrl(<probes>.env)`):

- `commands/team.ts`: line 45 becomes `import { createRelayClient } from "../lib/team/relay-client.ts";` plus a new line `import { switchboardUrl } from "../packages/rt-client/src/switchboard.ts";`. Lines 343, 415, 480: `createRelayClient(deps.probes.fetch, switchboardUrl(deps.probes.env))`.
- `commands/setup.ts`: line 59 becomes `import { createRelayClient, type RelayClient } from "../lib/team/relay-client.ts";` plus `import { switchboardUrl } from "../packages/rt-client/src/switchboard.ts";`. Line 176: `relay: createRelayClient(probes.fetch, switchboardUrl(probes.env)),`.
- `commands/uninstall.ts`: line 19 becomes `import { createRelayClient, type RelayClient } from "../lib/team/relay-client.ts";` plus `import { switchboardUrl } from "../packages/rt-client/src/switchboard.ts";`. Line 44: `relay: createRelayClient(probes.fetch, switchboardUrl(probes.env)),`.
- `lib/daemon.ts`: line 43 becomes `import { createRelayClient } from "./team/relay-client.ts";` plus `import { switchboardUrl } from "../packages/rt-client/src/switchboard.ts";`. Line 949: `const relay = createRelayClient(probes.fetch, switchboardUrl(probes.env));`.

In `lib/team/invite.ts` line 55, the `joinLinkBase` doc comment names the removed constant. Replace it with:

```ts
/** Read only by rt, and the VM harness needs to point it elsewhere without a team store. */
```

- [ ] **Step 6: Confirm nothing still names the old relay URL**

Run: `rg -n "inviteRelayUrl|DEFAULT_INVITE_RELAY_URL|RT_INVITE_RELAY_URL" lib commands packages apps rt-tray e2e scripts`
Expected: no output.

- [ ] **Step 7: Rebuild rt-client and run the affected suites**

Run: `cd packages/rt-client && bun run build && cd ../.. && bun test packages/rt-client lib/team commands/__tests__/team.test.ts commands/__tests__/team-join.test.ts commands/__tests__/setup-connect.test.ts && bun run typecheck`
Expected: all PASS (including `dist-freshness.test.ts`), typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/rt-client/src/switchboard.ts packages/rt-client/src/index.ts packages/rt-client/test/switchboard.test.ts lib/team/relay-client.ts lib/team/__tests__/relay-client.test.ts lib/team/invite.ts commands/team.ts commands/setup.ts commands/uninstall.ts lib/daemon.ts
git commit -m "$(cat <<'EOF'
add the built-in switchboard URL and fold the invite relay into it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: rt's invite, join and peer waker use `switchboardUrl()`

Invite peering now depends only on the switchboard admin token this Mac holds. The pointer seals the token alone. Join stores the token and writes no URL setting; a pointer from an older rt that names a different URL is refused. The daemon's waker reads the helper.

Outcome table this task implements (decided from the spec; keep it exact):

| Invite side (`rt team invite`) | `peering` |
|---|---|
| No admin token in the local rt secrets | `none`, no warning |
| Admin token present, register returned a token | `embedded` |
| Admin token read threw, register failed, or no token came back | `missing`, warned; `--require-peering` refuses |

| Join side (`rt team join`) | `peering` |
|---|---|
| Pointer token, pointer URL absent or equal to `switchboardUrl()` | `applied` (token stored) |
| Pointer token, pointer URL differs | `unavailable` with the re-invite fix, nothing stored |
| No pointer token, team secrets hold no admin token | `idle` |
| No pointer token, admin token read throws, register fails, or no token back | `unavailable` with the re-invite fix |

**Files:**
- Modify: `lib/setup/intent.ts:17-24`
- Modify: `lib/team/invite.ts:95-107,244-293`
- Modify: `lib/team/join.ts` (seams 270-365, peering 367-463, `joinRedeem` 590-607)
- Modify: `lib/daemon.ts:1124`
- Modify: `commands/team.ts` (`TeamDeps`, `teamInvite` mint call at 344)
- Test: `lib/team/__tests__/invite.test.ts`, `lib/team/__tests__/join.test.ts`, `commands/__tests__/team.test.ts`, `commands/__tests__/team-join.test.ts`, `lib/daemon/__tests__/peer-waker-relay.test.ts`

**Interfaces:**
- Consumes: `switchboardUrl(env)` from Task 1.
- Produces: `InvitePointer.switchboard?: { url?: string; token: string }`. `JoinRedeemSeams` loses `writeMachineSetting` and `writeUserSetting`. `TeamDeps` gains `mintInviteSeams?: Partial<MintInviteSeams>`. `realMintInviteSeams` and `MintInviteSeams` stay exported from `lib/team/invite.ts`.

- [ ] **Step 1: Write the failing invite tests**

In `lib/team/__tests__/invite.test.ts`, add to the imports:

```ts
import { SWITCHBOARD_URL } from "../../../packages/rt-client/src/switchboard.ts";
```

Replace the four tests from `test("a team with a switchboard: mint registers the member's board and seals url+token into the pointer"` through the end of `describe("the result says whether board peering rode the invite", ...)` (lines 334-486) with:

```ts
  test("an admin token on this Mac: mint registers the member's board on the built-in switchboard and seals only the token", async () => {
    const fetchCalls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
    const p = fakeProbes({
      home: HOME,
      files: { [GIT_CONFIG_PATH]: gitConfigWithRemote(REMOTE) },
      fetch: async (url, init) => {
        fetchCalls.push({ url, init });
        return { status: 201, body: JSON.stringify({ username: "zaphod", token: "tok-9" }), headers: {} };
      },
    });
    const { seams } = baseSeams({ readLocalSecret: async () => "admin-1" });
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", now: NOW }, seams);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe(`${SWITCHBOARD_URL}/boards`);
    expect(fetchCalls[0]!.init?.headers?.Authorization).toBe("Bearer admin-1");
    expect(JSON.parse(fetchCalls[0]!.init?.body ?? "{}")).toEqual({ username: "zaphod" });
    const { idHex, key } = decodeCode(result.code);
    const pointer = await open(relay.createCalls[0]!.ciphertext, key, idHex);
    expect(pointer.switchboard).toEqual({ token: "tok-9" });
  });

  test("RT_SWITCHBOARD_URL steers the register to the override", async () => {
    const urls: string[] = [];
    const p = fakeProbes({
      home: HOME,
      env: { RT_SWITCHBOARD_URL: "http://127.0.0.1:7940" },
      files: { [GIT_CONFIG_PATH]: gitConfigWithRemote(REMOTE) },
      fetch: async (url) => {
        urls.push(url);
        return { status: 201, body: JSON.stringify({ token: "tok-9" }), headers: {} };
      },
    });
    const { seams } = baseSeams({ readLocalSecret: async () => "admin-1" });

    await mintInvite(p, fakeRelayClient().client, { slug: SLUG, handle: "zaphod", now: NOW }, seams);

    expect(urls).toEqual(["http://127.0.0.1:7940/boards"]);
  });

  test("no admin token on this Mac: no register, no warning, and the pointer carries no switchboard", async () => {
    const p = probesWithRemote(REMOTE);
    const { seams, warnings } = baseSeams({ readLocalSecret: async () => null });
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", now: NOW }, seams);

    expect(p.calls.fetch).toHaveLength(0);
    const { idHex, key } = decodeCode(result.code);
    const pointer = await open(relay.createCalls[0]!.ciphertext, key, idHex);
    expect(pointer.switchboard).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  test("a throwing readLocalSecret stays inside optional peering: the mint still succeeds, warned", async () => {
    const p = probesWithRemote(REMOTE);
    const { seams, warnings } = baseSeams({
      readLocalSecret: async () => {
        throw new Error("keychain sulking");
      },
    });
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", now: NOW }, seams);

    expect(result.code).toBeTruthy();
    expect(result.peering).toBe("missing");
    const { idHex, key } = decodeCode(result.code);
    const pointer = await open(relay.createCalls[0]!.ciphertext, key, idHex);
    expect(pointer.switchboard).toBeUndefined();
    expect(warnings).toContain("board peering: keychain sulking");
  });

  test("a failing switchboard register: the mint still succeeds without a sealed token, warned", async () => {
    const p = fakeProbes({
      home: HOME,
      files: { [GIT_CONFIG_PATH]: gitConfigWithRemote(REMOTE) },
      fetch: async () => ({ status: 500, body: "", headers: {} }),
    });
    const { seams, warnings } = baseSeams({ readLocalSecret: async () => "admin-1" });
    const relay = fakeRelayClient();

    const result = await mintInvite(p, relay.client, { slug: SLUG, handle: "zaphod", now: NOW }, seams);

    expect(result.code).toBeTruthy();
    const { idHex, key } = decodeCode(result.code);
    const pointer = await open(relay.createCalls[0]!.ciphertext, key, idHex);
    expect(pointer.switchboard).toBeUndefined();
    expect(warnings).toContain("board peering: the switchboard register answered 500");
  });

  describe("the result says whether board peering rode the invite", () => {
    const registered = () =>
      fakeProbes({
        home: HOME,
        files: { [GIT_CONFIG_PATH]: gitConfigWithRemote(REMOTE) },
        fetch: async () => ({ status: 201, body: JSON.stringify({ username: "zaphod", token: "tok-9" }), headers: {} }),
      });
    const refused = () =>
      fakeProbes({
        home: HOME,
        files: { [GIT_CONFIG_PATH]: gitConfigWithRemote(REMOTE) },
        fetch: async () => ({ status: 401, body: "", headers: {} }),
      });

    test("an embedded board token reports peering embedded, with no warning", async () => {
      const { seams } = baseSeams({ readLocalSecret: async () => "admin-1" });

      const result = await mintInvite(registered(), fakeRelayClient().client, { slug: SLUG, handle: "zaphod", now: NOW }, seams);

      expect(result.peering).toBe("embedded");
      expect(result.peeringWarning).toBeUndefined();
    });

    test("no admin token reports peering none", async () => {
      const { seams } = baseSeams();

      const result = await mintInvite(probesWithRemote(REMOTE), fakeRelayClient().client, { slug: SLUG, handle: "zaphod", now: NOW }, seams);

      expect(result.peering).toBe("none");
      expect(result.peeringWarning).toBeUndefined();
    });

    test("a token that could not be minted reports peering missing, and the reason goes to the warning's log text", async () => {
      const { seams, warnings } = baseSeams({ readLocalSecret: async () => "admin-1" });

      const result = await mintInvite(refused(), fakeRelayClient().client, { slug: SLUG, handle: "zaphod", now: NOW }, seams);

      expect(result.peering).toBe("missing");
      expect(result.peeringWarning).toBe("This invite will not connect their board. After they join, invite their board again from the board's members panel.");
      expect(warnings).toContain("board peering: the switchboard register answered 401");
    });

    test("requirePeering refuses a missing token before anything reaches the relay or the roster", async () => {
      const { seams, writeCalls } = baseSeams({ readLocalSecret: async () => "admin-1" });
      const relay = fakeRelayClient();

      const caught = await mintInvite(refused(), relay.client, { slug: SLUG, handle: "zaphod", now: NOW, requirePeering: true }, seams).catch((err: unknown) => err);

      expect(caught).toBeInstanceOf(UserActionableError);
      expect((caught as UserActionableError).code).toBe("peering-not-embedded");
      expect((caught as UserActionableError).log).toContain("the switchboard register answered 401");
      expect(relay.createCalls).toEqual([]);
      expect(writeCalls).toEqual([]);
    });

    test("requirePeering is satisfied by a Mac with no admin token", async () => {
      const { seams } = baseSeams();

      const result = await mintInvite(probesWithRemote(REMOTE), fakeRelayClient().client, { slug: SLUG, handle: "zaphod", now: NOW, requirePeering: true }, seams);

      expect(result.peering).toBe("none");
    });
  });
```

- [ ] **Step 2: Run the invite tests to verify they fail**

Run: `bun test lib/team/__tests__/invite.test.ts`
Expected: FAIL. The first test sees no fetch (the old mint only registers when the team declares a URL); the "no admin token" test sees `missing` rather than `none` only when a declaration exists, and the throwing-secret test sees `peering` `none`.

- [ ] **Step 3: Implement the invite side**

In `lib/setup/intent.ts`, replace the `switchboard` field and its doc comment (lines 17-24) with:

```ts
  /** Board peering, pre-minted at invite time: the owner's machine registers
      the invitee's board on the switchboard and seals the per-board token
      here, because at join time the invitee cannot yet decrypt team secrets
      (their age key becomes a recipient only after the owner's members sync).
      Absent when the owner's Mac holds no switchboard admin token or the
      register failed. `url` appears only in a pointer from an older rt. */
  switchboard?: { url?: string; token: string };
```

In `lib/team/invite.ts`:

Add the import:

```ts
import { switchboardUrl } from "../../packages/rt-client/src/switchboard.ts";
```

Replace the `peering` and `requirePeering` doc comments (lines 96 and 106) with:

```ts
  /** "none" when this Mac holds no switchboard admin token; "missing" means the joiner's board will not peer from this invite. */
```

```ts
  /** Refuse, before anything is minted, an invite this Mac tried and failed to give a board token. */
```

Replace the block from `const switchboardUrl = snapshot.integrations.switchboard?.url;` through `const peering: InviteResult["peering"] = !switchboardUrl ? "none" : pointer.switchboard ? "embedded" : "missing";` (lines 249-293) with:

```ts
  let peeringWarning: string | undefined;
  let embedFailure: string | null = null;
  let adminToken: string | null = null;
  try {
    adminToken = await seams.readLocalSecret("switchboardAdminToken");
  } catch (err) {
    embedFailure = err instanceof Error ? err.message : String(err);
  }
  if (adminToken) {
    try {
      const res = await p.fetch(`${switchboardUrl(p.env)}/boards`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ username: opts.handle }),
      });
      if (res.status < 200 || res.status >= 300) {
        embedFailure = `the switchboard register answered ${res.status}`;
      } else {
        let boardToken: unknown;
        try {
          boardToken = (JSON.parse(res.body) as { token?: unknown })?.token;
        } catch {
          /* an unparsable register reply reads as no token */
        }
        if (typeof boardToken === "string" && boardToken) {
          pointer.switchboard = { token: boardToken };
        } else {
          embedFailure = "the switchboard register returned no token";
        }
      }
    } catch (err) {
      embedFailure = err instanceof Error ? err.message : String(err);
    }
  }
  if (embedFailure) {
    peeringWarning = "This invite will not connect their board. After they join, invite their board again from the board's members panel.";
    if (opts.requirePeering) {
      throw new UserActionableError("peering-not-embedded", "rt did not make the invite, because it could not connect their board", {}, {
        why: "It could not register their board with the switchboard.",
        log: embedFailure,
      });
    }
    seams.warn(`board peering: ${embedFailure}`, { title: "This invite will not connect their board", hint: "invite their board again from the board's members panel after they join" });
  }
  const peering: InviteResult["peering"] = pointer.switchboard ? "embedded" : embedFailure ? "missing" : "none";
```

Keep the comment block above it (`// Board peering rides the invite: ...`) unchanged.

- [ ] **Step 4: Run the invite tests to verify they pass**

Run: `bun test lib/team/__tests__/invite.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing join tests**

In `lib/team/__tests__/join.test.ts`:

Add the import:

```ts
import { SWITCHBOARD_URL } from "../../../packages/rt-client/src/switchboard.ts";
```

and after `const NOW = ...` add:

```ts
const SB = SWITCHBOARD_URL;
```

Replace `baseJoinRedeemSeams` (lines 125-180) with:

```ts
function baseJoinRedeemSeams(overrides: Partial<JoinRedeemSeams> = {}): {
  seams: JoinRedeemSeams;
  calls: {
    readTeamSecret: unknown[][];
    forgeLogin: unknown[][];
    secretWrites: { key: string; value: string }[];
  };
} {
  const calls = {
    readTeamSecret: [] as unknown[][],
    forgeLogin: [] as unknown[][],
    secretWrites: [] as { key: string; value: string }[],
  };
  const seams: JoinRedeemSeams = {
    ageKeySeam: fakeAgeKeySeam(),
    read: fakeRead(),
    readTeamSecret: (async (...args: unknown[]) => {
      calls.readTeamSecret.push(args);
      return null;
    }) as JoinRedeemSeams["readTeamSecret"],
    forgeLogin: (async (...args: unknown[]) => {
      calls.forgeLogin.push(args);
      return "zaphod";
    }) as JoinRedeemSeams["forgeLogin"],
    forgeToken: async () => null,
    localStoreReady: async () => true,
    writeLocalSecret: async (key, value) => {
      calls.secretWrites.push({ key, value });
    },
    warn: () => {},
    ...overrides,
  };
  return { seams, calls };
}
```

Apply these mechanical edits to every remaining test in the file:

1. Delete every `read: fakeRead({ "mattstack.integrations": { switchboard: { url: "https://sb.test" } } }),` line, and every `read: fakeRead(DECLARED),` line. In `baseJoinRedeemSeams({ read: fakeRead({ "mattstack.integrations": { switchboard: { url: "https://sb.test" } } }) })` write `baseJoinRedeemSeams()`.
2. Delete the `const DECLARED = ...` line in `describe("a join never burns an invite whose board token has nowhere to go", ...)`.
3. Replace every `"https://sb.test"` literal with `SB`, and `"https://sb.test/boards"` with `` `${SB}/boards` ``.
4. Delete every `expect(calls.settingWrites)...` and `expect(calls.userSettingWrites)...` line.

Delete these tests outright (their behavior is gone):

- `a minted token confirms the switchboard for rt's own rows on top of the user's existing overrides`
- `a switchboard the user already confirmed to this URL is not written again`
- `a latch left empty or not https by a hand edit counts as unset, so the join fills it`
- `a switchboard the user confirmed to a different URL is never overwritten: the join warns with the connect command and peers anyway`
- `a failing rt.integrations write warns with the connect command and leaves peering applied: the board still peers, only rt's own row stays unconfirmed`
- `a team-declared switchboard that is not https: no admin token sent, nothing stored, peering unavailable (the board refuses to boot on a non-loopback http URL)`
- `a failing board.switchboardUrl write -> peering:unavailable, join still ok: a token the board cannot find a URL for peers nothing`
- `an embedded token with no team-declared switchboard url is refused: nothing to aim it at, nothing stored`
- `a declared switchboard whose invite carried no token never consults the store: there is nothing sealed to lose`
- `a non-https declared switchboard: the fix names the owner's team settings, not a re-invite`
- `no switchboard url → peering idle, no peer/join request`

Replace `test("an embedded token whose url differs from the team-declared switchboard is refused: unavailable, nothing stored", ...)` with:

```ts
  test("an older invite naming a different switchboard is refused: unavailable, nothing stored, its token never sent anywhere", async () => {
    const p = redeemProbes();
    const embedded = { ...POINTER, switchboard: { url: "https://evil.test", token: "tok-x" } };
    const relay = fakeRelay({ fetch: relayServing(embedded) });
    const warnings: string[] = [];
    const { seams, calls } = baseJoinRedeemSeams({ warn: (m) => warnings.push(m) });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("unavailable");
    expect(result.peeringFix).toContain("Ask matt to invite zaphod again");
    expect(calls.secretWrites).toEqual([]);
    expect(p.calls.fetch).toHaveLength(0);
    expect(warnings.some((w) => w.includes("different switchboard"))).toBe(true);
  });

  test("an older invite naming this switchboard, trailing slash and all, is accepted", async () => {
    const p = redeemProbes();
    const embedded = { ...POINTER, switchboard: { url: `${SB}/`, token: "tok-old" } };
    const relay = fakeRelay({ fetch: relayServing(embedded) });
    const { seams, calls } = baseJoinRedeemSeams();

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("applied");
    expect(calls.secretWrites).toEqual([{ key: "switchboardToken", value: "tok-old" }]);
  });

  test("an invite from this rt seals only the token: stored, applied, no network call", async () => {
    const p = redeemProbes();
    const embedded = { ...POINTER, switchboard: { token: "tok-new" } };
    const relay = fakeRelay({ fetch: relayServing(embedded) });
    const { seams, calls } = baseJoinRedeemSeams();

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("applied");
    expect(calls.secretWrites).toEqual([{ key: "switchboardToken", value: "tok-new" }]);
    expect(p.calls.fetch).toHaveLength(0);
  });

  test("RT_SWITCHBOARD_URL steers the re-join register to the override", async () => {
    const urls: string[] = [];
    const p = redeemProbes({
      env: { RT_SWITCHBOARD_URL: "http://localhost:7940" },
      fetch: async (url) => {
        urls.push(url);
        return { status: 201, body: JSON.stringify({ token: "tok-1" }), headers: {} };
      },
    });
    const { seams } = baseJoinRedeemSeams({ readTeamSecret: async () => "admin-token" });

    const result = await joinRedeem(p, fakeRelay().client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("applied");
    expect(urls).toEqual(["http://localhost:7940/boards"]);
  });
```

Rename `test("a team with no switchboard never consults the store, so a fresh machine still joins", ...)` to `test("an invite with no sealed token never consults the store, so a fresh machine still joins", ...)`; its body and `expect(result.peering).toBe("idle")` stay.

Rename `test("an embedded token for a different switchboard never consults the store: it is refused anyway", ...)` to `test("an older invite naming a different switchboard never consults the store: it is refused anyway", ...)`; its body keeps `"https://evil.test"`.

Replace `test("switchboard url present but no readable admin token → peering:unavailable (there IS something to peer, and it could not), no request attempted", ...)` with:

```ts
  test("no sealed token and no admin token in the team's secrets → peering idle, no request attempted", async () => {
    const p = redeemProbes();
    const relay = fakeRelay();
    const { seams } = baseJoinRedeemSeams({ readTeamSecret: async () => null });

    const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

    expect(result.peering).toBe("idle");
    expect("peeringFix" in result).toBe(false);
    expect(p.calls.fetch).toHaveLength(0);
  });
```

In `describe("peering unavailable carries its fix in the result", ...)`, replace the first test (`an invite that carried no board token: ...`) with:

```ts
    test("a register the switchboard refused: peeringFix asks the owner for a fresh invite for this handle", async () => {
      const p = redeemProbes({ fetch: async () => ({ status: 500, body: "", headers: {} }) });
      const relay = fakeRelay();
      const { seams } = baseJoinRedeemSeams({ readTeamSecret: async () => "admin-token" });

      const result = await joinRedeem(p, relay.client, () => NO_SECRETS, { code: CODE }, seams);

      expect(result.access).toBe("ok");
      expect(result.peering).toBe("unavailable");
      expect(result.peeringFix).toContain("Ask matt to invite zaphod again");
      expect(result.peeringFix).toContain("or ask them to invite your board again from the board's members panel");
      expect(result.message).toContain(result.peeringFix!);
    });
```

and in `a join that ends with peering unavailable records only its provenance: ...` replace its seams line with:

```ts
      const { seams } = baseJoinRedeemSeams({
        readTeamSecret: async () => {
          throw new Error("not a recipient yet");
        },
      });
```

- [ ] **Step 6: Run the join tests to verify they fail**

Run: `bun test lib/team/__tests__/join.test.ts`
Expected: FAIL. TypeScript-level seam mismatches do not fail bun, but the new tests fail: the pointer without `url` is refused today, the override is ignored, and `readTeamSecret` null still reads `unavailable` only when a URL is declared (now no declaration, so `idle` where `applied` is expected).

- [ ] **Step 7: Implement the join side**

In `lib/team/join.ts`:

Imports: delete `import { isValidHttpsUrl } from "../setup/host-validate.ts";` and `import { setSetting } from "../settings/write.ts";`, and add:

```ts
import { switchboardUrl } from "../../packages/rt-client/src/switchboard.ts";
```

In `JoinRedeemSeams`, delete the `writeMachineSetting` and `writeUserSetting` members with their doc comments, and change the `localStoreReady` doc to:

```ts
  /** Whether `writeLocalSecret` can succeed now (the home repo's recipients file and the age key both exist). Checked before the redeem whenever the invite carries a board token this rt will accept. */
```

Delete `pointBoardAt` and `confirmSwitchboardForRt` (with their doc comments). In `realJoinRedeemSeams`, delete the `writeMachineSetting` and `writeUserSetting` lines. Keep `sameUrl`.

Replace `storeBoardToken` and `peerBoard` (from `/** Stores a board token rt now holds ...` through the end of `peerBoard`) with:

```ts
/** A pointer from an older rt names the switchboard it minted against; its token is only ever trusted for this rt's own switchboard. */
function namesOtherSwitchboard(pointer: InvitePointer, switchboard: string): boolean {
  const named = pointer.switchboard?.url;
  return named !== undefined && !sameUrl(named, switchboard);
}

/** Stores a board token rt now holds. A failed store throws the resumable error rather than finishing without it. */
async function storeBoardToken(seams: JoinRedeemSeams, pointer: InvitePointer, token: string): Promise<PeeringOutcome> {
  try {
    await seams.writeLocalSecret("switchboardToken", token);
  } catch (err) {
    throw new JoinPeeringStoreError(
      `You joined ${pointer.name}, but rt could not save your board's switchboard token. Join again to finish; you do not need a new code.`,
      scrub(errorText(err), token),
    );
  }
  return { peering: "applied" };
}

/** The board token and the admin token are only ever sent to `switchboard`, never to anything the invite names. */
async function peerBoard(
  p: Probes,
  seams: JoinRedeemSeams,
  secrets: SecretsSeamsFactory,
  pointer: InvitePointer,
  switchboard: string,
  handle: string,
): Promise<PeeringOutcome> {
  const reinvite: PeeringOutcome = {
    peering: "unavailable",
    peeringFix: `Ask ${pointer.owner} to invite ${handle} again and join with the new invite, or ask them to invite your board again from the board's members panel.`,
  };

  if (pointer.switchboard?.token) {
    if (namesOtherSwitchboard(pointer, switchboard)) {
      seams.warn("board peering: the invite names a different switchboard; refusing its token", { title: "This invite names a different switchboard", hint: "its board token was not used" });
      return reinvite;
    }
    // The owner pre-minted this board's token at invite time (a fresh joiner
    // cannot decrypt team secrets yet, so the sealed pointer is the only
    // channel that works on a first join).
    return storeBoardToken(seams, pointer, pointer.switchboard.token);
  }

  // Fallback for re-joins by members whose age key is already a team-secrets
  // recipient; a first join cannot decrypt the admin token and lands on
  // unavailable.
  let token: unknown;
  try {
    const adminToken = await seams.readTeamSecret(pointer.team, "rt", "switchboardAdminToken", secrets(pointer.team));
    if (!adminToken) return { peering: "idle" };
    // The switchboard's admin register route: an upsert that mints (or
    // rotates) this member's board token.
    const res = await p.fetch(`${switchboard}/boards`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: handle }),
    });
    if (res.status < 200 || res.status >= 300) return reinvite;
    try {
      token = (JSON.parse(res.body) as { token?: unknown })?.token;
    } catch {
      /* an unparsable register reply reads as no token */
    }
  } catch (err) {
    if (err instanceof UserActionableError) logFailureDetail(err);
    seams.warn(`board peering: could not register this board (${errorText(err)})`, {
      title: "rt could not register your board with the switchboard",
      hint: errorText(err).split("\n")[0] || undefined,
      ...(err instanceof UserActionableError && err.next ? { next: out.cmd(err.next) } : {}),
    });
    return reinvite;
  }
  if (typeof token !== "string" || !token) return reinvite;
  return storeBoardToken(seams, pointer, token);
}
```

In `joinRedeem`, replace:

```ts
  const declaredUrl = snapshot.integrations.switchboard?.url;
  // A sealed board token is stored only in the personal secrets store, and
  // once the redeem runs this code can never be fetched again: refuse while
  // the store cannot take it.
  const sealedToken = declaredUrl && isValidHttpsUrl(declaredUrl) && pointer.switchboard?.token && pointer.switchboard.url === declaredUrl;
```

with:

```ts
  const switchboard = switchboardUrl(p.env);
  // A sealed board token is stored only in the personal secrets store, and
  // once the redeem runs this code can never be fetched again: refuse while
  // the store cannot take it.
  const sealedToken = !!pointer.switchboard?.token && !namesOtherSwitchboard(pointer, switchboard);
```

and replace `const { peering, peeringFix } = await peerBoard(p, seams, secrets, pointer, declaredUrl, handle);` with:

```ts
  const { peering, peeringFix } = await peerBoard(p, seams, secrets, pointer, switchboard, handle);
```

The existing warning test `a team-secrets failure inside peering keeps its next command in the warning` and `a plain error inside peering warns with no next command` assert the title `rt could not register your board with the team's switchboard`; change both expectations to `rt could not register your board with the switchboard` to match the new copy.

- [ ] **Step 8: Run the join tests to verify they pass**

Run: `bun test lib/team/__tests__/join.test.ts`
Expected: PASS.

- [ ] **Step 9: Let the invite command take mint seams, and update the command tests**

In `commands/team.ts`, change the invite import (line 39) to:

```ts
import { mintInvite, realMintInviteSeams, type InviteResult, type MintInviteSeams } from "../lib/team/invite.ts";
```

Add to `TeamDeps`, after `joinRedeemSeams`:

```ts
  /** Overrides `mintInvite`'s seams; real by default. */
  mintInviteSeams?: Partial<MintInviteSeams>;
```

Change the mint call (line 344) to:

```ts
    const result = await mintInvite(
      deps.probes,
      relay,
      { slug, handle, now: deps.probes.now(), requirePeering: args.includes("--require-peering") },
      { ...realMintInviteSeams(), ...deps.mintInviteSeams },
    );
```

In `commands/__tests__/team.test.ts`, in `describe("board peering the invite could not carry is never silent", ...)` (lines 317-360): delete `declareSwitchboard` and its three calls, and change `inviteDeps` (lines 276-290) to accept a refused register and an admin token:

```ts
  function inviteDeps(overrides: { exec?: ExecScript; record?: Partial<TeamLocalRecord>; onRelay?: () => void; adminToken?: string } = {}): TeamDeps & { lines: string[]; exitCodes: number[] } {
    const probes = fakeProbes({
      home,
      files: { [join(teamDir, ".git", "config")]: GIT_CONFIG },
      exec: overrides.exec ?? ghExec(),
      fetch: (url, init) => {
        overrides.onRelay?.();
        if (url.endsWith("/boards")) return Promise.resolve({ status: 401, body: "", headers: {} });
        return relayFetch()(url, init);
      },
    });
    if (overrides.record) {
      writeTeamLocal(probes, "acme", { createdByRt: false, joinedByRt: false, rtMayManageMembership: false, ...overrides.record });
    }
    const deps = baseDeps({ probes });
    return overrides.adminToken === undefined ? deps : { ...deps, mintInviteSeams: { readLocalSecret: async () => overrides.adminToken! } };
  }
```

and in the three tests of that describe, call `inviteDeps({ adminToken: "admin-1" })` (the `--require-peering` test: `inviteDeps({ adminToken: "admin-1", onRelay: () => { relayCalls++; } })`). The `--require-peering` test's `expect(relayCalls).toBe(0)` becomes `expect(relayCalls).toBe(1)`: the register call reaches the switchboard before the refusal, and nothing reaches the invite relay. Add right after it: `expect(deps.lines).toHaveLength(1);`.

If `baseDeps` in that file returns a type without `exitCodes`, keep the spread exactly as written: it copies `lines` and `exitCodes` through.

In `commands/__tests__/team-join.test.ts`: delete lines 67-68 (`writeMachineSetting`, `writeUserSetting`) in `fakeJoinRedeemSeams`; in the test whose name starts `redeem: switchboard url + admin token` rename the test to `redeem: an admin token in the team's secrets, explicitly faked via TeamDeps, peering applied`, delete its `read: fakeRead(...)` line, and change `expect(fetchCalls).toContain("https://sb.test/boards");` to `expect(fetchCalls).toContain(\`${SWITCHBOARD_URL}/boards\`);` with `import { SWITCHBOARD_URL } from "../../packages/rt-client/src/switchboard.ts";`. Delete the `read: fakeRead(...)` line in the `peering-store-failed` test near line 378. Change the comment on line 282 to `// no admin token in this test's team secrets`.

- [ ] **Step 10: Point the daemon's waker at the helper**

In `lib/daemon.ts` (line 1124) replace:

```ts
          readUrl: () => getSetting<string>("board.switchboardUrl").value,
```

with:

```ts
          readUrl: () => switchboardUrl(),
```

(`switchboardUrl` is already imported from Task 1.)

In `lib/daemon/__tests__/peer-waker-relay.test.ts`, add `import { switchboardUrl } from "../../../packages/rt-client/src/switchboard.ts";` and change `readUrl: () => base,` to:

```ts
    readUrl: () => switchboardUrl({ RT_SWITCHBOARD_URL: base }),
```

- [ ] **Step 11: Run every suite this task touches**

Run: `bun test lib/team commands/__tests__/team.test.ts commands/__tests__/team-join.test.ts lib/daemon/__tests__/peer-waker.test.ts lib/daemon/__tests__/peer-waker-relay.test.ts lib/setup/__tests__/steps-a.test.ts && bun run typecheck`
Expected: all PASS, typecheck exits 0.

- [ ] **Step 12: Commit**

```bash
git add lib/setup/intent.ts lib/team/invite.ts lib/team/join.ts lib/daemon.ts commands/team.ts lib/team/__tests__/invite.test.ts lib/team/__tests__/join.test.ts commands/__tests__/team.test.ts commands/__tests__/team-join.test.ts lib/daemon/__tests__/peer-waker-relay.test.ts
git commit -m "$(cat <<'EOF'
team: invite, join and the peer waker use the built-in switchboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Setup drops the switchboard rows and connect flow; board peering applies to every joined team

**Files:**
- Modify: `lib/setup/contract.ts:7`
- Modify: `lib/setup/integrations.ts:19,30-47,274-305`
- Modify: `lib/setup/team-settings.ts:31,69-73`
- Modify: `lib/setup/validators/accounts.ts` (imports 20, `ctxFor` 88-110, `declaredIntegrations` 122-160, `switchboardRow` 230-259, board-peering 261-310, `accountRowFor` 343-363, `accountRows` 476-484)
- Modify: `lib/setup/validators/access.ts:1-10,60-63,118-154`
- Modify: `lib/team/board-token.ts`
- Modify: `commands/setup.ts` (`ctxFor` 1008-1029, `hostFlagValid` 1258-1261, `connectCredential` 1263-1305, exports 1505-1506)
- Modify: `lib/command-tree-def.ts:640-650,2675`
- Modify: `lib/daemon.ts:160-181`
- Modify: `lib/__tests__/no-settings-bypass.test.ts:66`
- Delete: `website/docs/reference/setup/switchboard/` (regenerated)
- Test: `lib/setup/__tests__/validators-accounts.test.ts`, `validators-access.test.ts`, `integrations.test.ts`, `plan.test.ts`, `steps-c.test.ts`, `lib/team/__tests__/board-token.test.ts`, `commands/__tests__/setup-connect.test.ts`

**Interfaces:**
- Consumes: `switchboardUrl(env)` from Task 1.
- Produces: `Integration` no longer includes `"switchboard"`; `TeamIntegrations` has no `switchboard`; `UserIntegrationOverrides` is `{ forgeHost?: string }`; `boardPeering(p, has, extraRoots?)` applies to every team with `joinedByRt`. `boardRoots` and `sourceBoardRoots` in `lib/team/board-token.ts` become exported in Task 6, not here.

- [ ] **Step 1: Write the failing setup tests**

In `lib/setup/__tests__/validators-accounts.test.ts`:

- Delete the comment block above and the whole `describe` whose title ends `account.switchboard` (lines 472-559).
- In the `describe` whose title ends `secrets never leak` delete the line `switchboard: { url: "https://sw.example.com" },`.
- Replace the whole `describe("accountRows: account.board-peering", ...)` (lines 561-677) with:

```ts
describe("accountRows: account.board-peering", () => {
  const HOME = "/fake-home";
  const TEAMS = `${HOME}/.mattstack/teams`;
  const reachable = async (url: string) => (url === `${SWITCHBOARD_URL}/healthz` ? { status: 200, body: "", headers: {} } : { status: 0, body: "", headers: {} });

  /** A machine as a join left it: the team clone and a local record, and nothing else. */
  function machine(teams: Record<string, { joinedByRt: boolean }>, opts: { extra?: Record<string, string>; fetch?: typeof reachable; env?: Record<string, string> } = {}) {
    const files: Record<string, string> = { ...(opts.extra ?? {}) };
    for (const [slug, t] of Object.entries(teams)) {
      files[`${TEAMS}/${slug}/mattstack/settings.team.jsonc`] = "// team settings\n{}\n";
      files[`${HOME}/.mattstack/rt/teams/${slug}.json`] = JSON.stringify({ createdByRt: !t.joinedByRt, joinedByRt: t.joinedByRt, rtMayManageMembership: false });
    }
    return fakeProbes({ home: HOME, files, dirs: { [TEAMS]: Object.keys(teams) }, fetch: opts.fetch ?? reachable, env: opts.env ?? {} });
  }

  const rowsFor = (p: ReturnType<typeof fakeProbes>, secrets: SecretPresence = fakeSecrets()) => accountRows(p, baseTeam(), [], secrets, null);
  const peeringRow = async (p: ReturnType<typeof fakeProbes>, secrets?: SecretPresence) => pickRow(rowsFor(p, secrets), "account.board-peering");
  const withToken = fakeSecrets({ "rt.switchboardToken": "tok-1" });

  test("a joined team with no token anywhere -> needs-you with the re-invite remedy, never required, no relay probe", async () => {
    const p = machine({ acme: { joinedByRt: true } });
    const r = await peeringRow(p);
    expect(r.status).toBe("needs-you");
    expect(r.required).toBe(false);
    expect(r.finishGated).toBeUndefined();
    expect(r.detail).toContain("acme");
    expect(r.detail).toContain("Ask the team's owner to invite you again (rt team invite --handle <your forge username>)");
    expect(r.action?.type).toBe("steps");
    expect(p.calls.fetch).toEqual([]);
  });

  test("the plan has no switchboard row of its own any more", async () => {
    const rows = await rowsFor(machine({ acme: { joinedByRt: true } }));
    expect(rows.some((row) => row.id === "account.switchboard")).toBe(false);
  });

  test("its note never reads as optional, so the app's Done screen still lists it as outstanding", async () => {
    const r = await peeringRow(machine({ acme: { joinedByRt: true } }));
    expect(r.optionalNote?.toLowerCase().startsWith("works without")).toBe(false);
  });

  test("a check that throws fails only the peering row", async () => {
    const p = machine({ acme: { joinedByRt: true } });
    p.readDir = () => {
      throw new Error("teams dir unreadable");
    };
    const r = await peeringRow(p);
    expect(r.status).toBe("error");
    expect(r.required).toBe(false);
    expect(r.detail).toContain("teams dir unreadable");
    expect(r.action).toEqual({ type: "run", label: "Re-check", verb: ["setup", "status"] });
  });

  test("a token in rt's secrets and a switchboard that answers -> ready", async () => {
    const p = machine({ acme: { joinedByRt: true } });
    const r = await peeringRow(p, withToken);
    expect(r.status).toBe("ready");
    expect(p.calls.fetch).toEqual([`${SWITCHBOARD_URL}/healthz`]);
  });

  test("a token only in the board's own .env -> ready, without asking the secrets store", async () => {
    let asked = 0;
    const secrets: SecretPresence = { async has() { asked++; return null; } };
    const r = await peeringRow(machine({ acme: { joinedByRt: true } }, { extra: { [`${HOME}/.mattstack/board/.env`]: "SWITCHBOARD_TOKEN=tok-board\n" } }), secrets);
    expect(r.status).toBe("ready");
    expect(asked).toBe(0);
  });

  test("a token held but the switchboard unreachable -> error with a re-check", async () => {
    const down = async () => ({ status: 0, body: "", headers: {} });
    const r = await peeringRow(machine({ acme: { joinedByRt: true } }, { fetch: down }), withToken);
    expect(r.status).toBe("error");
    expect(r.required).toBe(false);
    expect(r.detail).toContain("could not reach the switchboard");
    expect(r.action).toEqual({ type: "run", label: "Re-check", verb: ["setup", "status"] });
  });

  test("a token held but the switchboard answers non-200 -> error naming the status", async () => {
    const sick = async () => ({ status: 503, body: "", headers: {} });
    const r = await peeringRow(machine({ acme: { joinedByRt: true } }, { fetch: sick }), withToken);
    expect(r.status).toBe("error");
    expect(r.detail).toContain("HTTP 503");
  });

  test("RT_SWITCHBOARD_URL steers the health probe", async () => {
    const urls: string[] = [];
    const fetch = async (url: string) => {
      urls.push(url);
      return { status: 200, body: "", headers: {} };
    };
    await peeringRow(machine({ acme: { joinedByRt: true } }, { fetch, env: { RT_SWITCHBOARD_URL: "http://127.0.0.1:7940" } }), withToken);
    expect(urls).toEqual(["http://127.0.0.1:7940/healthz"]);
  });

  test("a Mac in no team has no peering row", async () => {
    const rows = await rowsFor(machine({}));
    expect(rows.some((row) => row.id === "account.board-peering")).toBe(false);
  });

  test("a creator machine (not joined by invite) has no peering row", async () => {
    const rows = await rowsFor(machine({ acme: { joinedByRt: false } }));
    expect(rows.some((row) => row.id === "account.board-peering")).toBe(false);
  });

  test("a joined team other than the active one is checked", async () => {
    const r = await peeringRow(machine({ acme: { joinedByRt: false }, beta: { joinedByRt: true } }));
    expect(r.status).toBe("needs-you");
    expect(r.detail).toContain("beta");
    expect(r.detail).not.toContain("acme");
  });

  test("a secrets store that throws -> its own could-not-read status, never read as no token", async () => {
    const secrets: SecretPresence = { async has() { throw new Error("keychain locked"); } };
    const r = await peeringRow(machine({ acme: { joinedByRt: true } }), secrets);
    expect(r.status).toBe("error");
    expect(r.detail).toContain("Could not read your secrets store");
    expect(r.detail).toContain("keychain locked");
    expect(r.action).toEqual({ type: "run", label: "Re-check", verb: ["setup", "status"] });
  });
});
```

Add the import at the top of the file:

```ts
import { SWITCHBOARD_URL } from "../../../packages/rt-client/src/switchboard.ts";
```

In `lib/team/__tests__/board-token.test.ts`, change `joined()`'s team settings line to `[\`${TEAMS}/acme/mattstack/settings.team.jsonc\`]: "{}",` and its doc comment to `/** One team this machine joined by invite, so only the token sources decide the verdict. */`, then add:

```ts
describe("boardPeering: which Macs it applies to", () => {
  test("a Mac in no team is not applicable", async () => {
    const p = fakeProbes({ home: HOME, dirs: { [TEAMS]: [] } });
    expect(await verdict(p)).toEqual({ kind: "not-applicable" });
  });

  test("a team created on this Mac is not applicable", async () => {
    const p = fakeProbes({
      home: HOME,
      dirs: { [TEAMS]: ["acme"] },
      files: {
        [`${TEAMS}/acme/mattstack/settings.team.jsonc`]: "{}",
        [`${HOME}/.mattstack/rt/teams/acme.json`]: JSON.stringify({ createdByRt: true, joinedByRt: false }),
      },
    });
    expect(await verdict(p)).toEqual({ kind: "not-applicable" });
  });

  test("a joined team with no switchboard declaration still applies", async () => {
    expect(await verdict(joined())).toEqual({ kind: "unpeered", teams: ["acme"] });
  });
});
```

In `lib/setup/__tests__/validators-access.test.ts`: delete the `describe` whose title ends `access.switchboard` (lines 457-505), and in the row-order test change the team's integrations to `{ forge: { host: "gitlab.example.com", provider: "gitlab" } }`, the test name to `row order is deterministic (team-repo, forge, repo.*) regardless of which probe resolves first`, and the expectation to `["access.team-repo", "access.forge", "access.repo.github.com-acme-repo"]`.

In `lib/setup/__tests__/integrations.test.ts`: delete the comment and `describe("switchboard validate", ...)` (lines 333-399) and the `{ id: "switchboard", ... }` entry of the leak table (line 409).

In `lib/setup/__tests__/plan.test.ts`: replace the comment and test `join intent, team declares switchboard -> latch matching the declared URL offers the re-check action; no latch offers connect` (lines 136-162) with:

```ts
  test("join intent, a team file that still declares a switchboard -> the plan carries no switchboard row of either kind", async () => {
    const prevHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "rt-plan-switchboard-"));
    process.env.HOME = home;
    try {
      const teamPath = teamSettingsPath("acme");
      mkdirSync(dirname(teamPath), { recursive: true });
      writeFileSync(teamPath, `// team store\n${JSON.stringify({ "mattstack.integrations": { switchboard: { url: "https://sw.example.com" } } })}\n`);

      const p = fakeProbes({ exec: readyExec, tray: grantedTray });
      writeIntent(p, joinIntent());

      const plan = await composePlan({ p, secrets: fakeSecrets(), ci: false, mode: "plan", teams: ["acme"] });
      const ids = plan.groups.flatMap((g) => g.rows.map((r) => r.id));
      expect(ids).not.toContain("account.switchboard");
      expect(ids).not.toContain("access.switchboard");
    } finally {
      process.env.HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
```

In `lib/setup/__tests__/steps-c.test.ts` (test `an unpeered joined board blocks neither Install nor Finish, ...`, lines 1855-1866): change the team settings file content to `"{}"`, the snapshot to `{ slug: "acme", integrations: {}, trackingIdentities: [], marketplaces: [], plugins: [], remote: null }`, and the call to `accountRows(p, team, [], { has: async () => null }, null)`.

In `commands/__tests__/setup-connect.test.ts`: delete the comment and `describe("integrationConnect - switchboard (credential-less, host-confirm flow)", ...)` (lines 423-546).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/setup/__tests__/validators-accounts.test.ts lib/team/__tests__/board-token.test.ts lib/setup/__tests__/plan.test.ts`
Expected: FAIL. The peering row is absent for a team with no declared switchboard, the healthz probe never runs, and the plan still holds `account.switchboard`/`access.switchboard`.

- [ ] **Step 3: Board peering applies to every joined team**

Replace `lib/team/board-token.ts`'s imports, `declaresHttpsSwitchboard`, and `boardPeering` so the file reads (keep `TOKEN_LINE`, `boardRoots`, `sourceBoardRoots`, `boardEnvHasSwitchboardToken`, `SecretPresenceCheck`, `BoardPeering` as they are):

```ts
import { join, resolve } from "path";
import type { Probes } from "../setup/probes.ts";
import { discoverTeams } from "../setup/team-settings.ts";
import { isCompiledRt } from "../rt-self.ts";
import { readTeamLocal } from "./team-local.ts";
```

```ts
/**
 * Whether a team this machine joined by invite expects its board to peer while
 * neither token source holds a token. A creator's machine has nothing a
 * re-invite could fix. Only presence is asked of the secrets store, and a
 * store that cannot answer is reported as such, never read as no token.
 */
export async function boardPeering(p: Probes, has: SecretPresenceCheck, extraRoots: string[] = sourceBoardRoots()): Promise<BoardPeering> {
  const teams = discoverTeams(p).filter((slug) => readTeamLocal(p, slug).joinedByRt);
  if (teams.length === 0) return { kind: "not-applicable" };
  if (boardEnvHasSwitchboardToken(p, extraRoots)) return { kind: "peered" };
  try {
    return (await has("rt", "switchboardToken")) === null ? { kind: "unpeered", teams } : { kind: "peered" };
  } catch (err) {
    return { kind: "unreadable", error: err instanceof Error ? err.message : String(err) };
  }
}
```

Delete `declaresHttpsSwitchboard` entirely. In `lib/__tests__/no-settings-bypass.test.ts` delete the line `"lib/team/board-token.ts": { count: 1, reason: "judges each joined team by its own switchboard declaration; getSetting merges every team store and has no per-team read" },` (the store-file read it allowlisted is gone; the guard reports a stale entry otherwise).

- [ ] **Step 4: Remove the switchboard integration and rows**

`lib/setup/contract.ts` line 7:

```ts
export type Integration = "github" | "gitlab" | "linear" | "slack" | "sdm" | "doppler" | "ldcli";
```

`lib/setup/integrations.ts`: delete the `switchboard: { ... },` entry of `INTEGRATIONS` (lines 274-305), delete `import { isValidHttpsUrl } from "./host-validate.ts";`, and in `ValidateCtx.host`'s doc comment delete the two lines starting `*  - switchboard: a full https URL` and `*    validate() appends`.

`lib/setup/team-settings.ts`: delete `switchboard?: { url: string };` from `TeamIntegrations`, and replace `UserIntegrationOverrides` with:

```ts
/** `rt.integrations` (user scope): the only source a credential fetch or a reachability probe may treat as a confirmed destination; a joined team's own declaration (`TeamSnapshot.integrations`) is shown to the user but never substitutes for this. Written by an explicit `rt setup gitlab connect --host` that has re-validated the host. */
export interface UserIntegrationOverrides {
  forgeHost?: string;
}
```

`lib/setup/validators/accounts.ts`:

- Imports: `import { isValidHostname } from "../host-validate.ts";` and add `import { switchboardUrl } from "../../../packages/rt-client/src/switchboard.ts";`.
- In `ctxFor`, delete the `if (id === "switchboard") { ... }` branch, and in its doc comment change `forge/switchboard host` to `forge host`.
- In `declaredIntegrations`, delete `if (team.integrations.switchboard) require("switchboard");` and change the doc's `linear/slack/switchboard` to `linear/slack`.
- Delete the `switchboardRow` function and its doc comment (lines 230-259).
- In `accountRowFor`, delete the four-line comment starting `// Not \`!def.secret\`: switchboard also has no secret` and the line `if (id === "switchboard") return switchboardRow(p, base, def, ctx);`.
- Replace `boardPeeringRow` with:

```ts
async function boardPeeringRow(p: Probes, secrets: SecretPresence): Promise<Row | null> {
  const peering = await boardPeering(p, (domain, key) => secrets.has(domain, key));
  if (peering.kind === "not-applicable") return null;
  if (peering.kind === "unpeered") {
    return row({ ...BOARD_PEERING_BASE, status: "needs-you", detail: `You joined ${peering.teams.join(", ")} by invite, but this Mac's board has no switchboard token, so it cannot peer. Ask ${REINVITE}`, action: REINVITE_STEPS });
  }
  if (peering.kind === "unreadable") {
    return row({ ...BOARD_PEERING_BASE, status: "error", detail: `Could not read your secrets store to check the board's switchboard token (${peering.error})`, action: ACCOUNT_RECHECK_ACTION });
  }
  const relay = switchboardUrl(p.env);
  const res = await p.fetch(`${relay}/healthz`);
  if (res.status === 200) return row({ ...BOARD_PEERING_BASE, status: "ready", detail: "Your board holds a switchboard token" });
  const detail = res.status === 0
    ? "Your board holds a switchboard token, but rt could not reach the switchboard. Check your network"
    : `Your board holds a switchboard token, but the switchboard answered HTTP ${res.status} to its health check`;
  return row({ ...BOARD_PEERING_BASE, status: "error", detail, action: ACCOUNT_RECHECK_ACTION });
}
```

- In `BOARD_PEERING_BASE.why`, change `through the team's switchboard.` to `through the switchboard.`
- Replace the tail of `accountRows` (from `// A switchboard rt cannot reach yet keeps the member on its own Confirm or Re-check first.` to `return rows;`) with:

```ts
  const peering = await boardPeeringRowSafe(p, secrets);
  if (peering) rows.push(peering);
  return rows;
```

`lib/setup/validators/access.ts`:

- Header comment line 3: `remotes and forge hosts, distinct from accounts.ts's`.
- Import: `import { isValidHostname } from "../host-validate.ts";`.
- `connectHostSteps` signature: `function connectHostSteps(id: "github" | "gitlab", declaredHost: string): Action {`, and in its doc comment change `forge/switchboard host` to `forge host`.
- Delete `switchboardRow` (lines 118-139).
- Replace `accessRows`'s body after the `solo` guard with:

```ts
  const [teamRepo, forge, ...repos] = await Promise.all([
    teamRepoRow(p, team, intent, overrides, secrets),
    forgeRow(p, team, intent, overrides),
    ...team.trackingIdentities.map((identity) => repoRow(p, identity, overrides, secrets)),
  ]);

  return [teamRepo!, forge!, ...repos];
```

and its doc comment's `team-repo/forge/switchboard/each tracking identity` becomes `team-repo/forge/each tracking identity`.

- [ ] **Step 5: Remove the connect flow, the command node and the duplicate ctx branches**

`commands/setup.ts`:

- Import line 41: `import { isValidHostname } from "../lib/setup/host-validate.ts";`.
- In `ctxFor` (1016-1029) delete the `if (id === "switchboard") { ... }` branch.
- Delete `hostFlagValid` and its doc comment (1258-1261).
- Replace the start of `connectCredential`, from `const def = integrationDef(id);` through the end of the `if (def.fields.length === 0) { value = ""; } else if (id === "github" && args.includes("--use-gh")) {` opener, with:

```ts
  const def = integrationDef(id);
  const field = def.fields[0];

  // A team can declare a self-hosted forge, but that declaration is never
  // sent a credential on its own: the user confirms it once, here, by
  // passing --host, and ctxFor then only ever trusts the confirmed value.
  const hostFlag = id === "gitlab" ? flagValue(args, "--host") : undefined;
  if (hostFlag !== undefined && !isValidHostname(hostFlag)) {
    throw new UserActionableError("bad-host", `--host takes a bare hostname such as gitlab.example.com, not ${hostFlag}`);
  }
  const overrides = overridesFor(deps);
  const confirmedOverrides: UserIntegrationOverrides = hostFlag === undefined ? overrides : { ...overrides, forgeHost: hostFlag };
  const ctx = ctxFor(id, snapshotFor(deps), confirmedOverrides);

  let value: string;
  let sourceDetail: string | null = null;

  if (id === "github" && args.includes("--use-gh")) {
```

The rest of `connectCredential` (TTY prompt, stdin, validate, `writeSetting`, store) is unchanged.

- Delete the two exports `setupSwitchboardStatus` and `setupSwitchboardConnect` (1505-1506).

`lib/command-tree-def.ts`:

- In `integrationNode`, change `if (id === "gitlab" || id === "switchboard") {` to `if (id === "gitlab") {`, and replace the `hint:` ternary (`id === "gitlab" ? "<gitlab hint>" : "<switchboard hint>"`) with the gitlab string alone, byte-for-byte as it is in the file today (existing copy, out of this change's scope). The switchboard hint string goes.

- Delete `switchboard: integrationNode("switchboard", "Switchboard"),` (line 2675).

`lib/daemon.ts` (`credentialHealthCtxFor`, 160-181): delete the `if (id === "switchboard") { ... }` branch, change the doc's `forge/switchboard`-free wording only where it names switchboard, and change the import `import { isValidHostname, isValidHttpsUrl } from "./setup/host-validate.ts";` to `import { isValidHostname } from "./setup/host-validate.ts";`.

- [ ] **Step 6: Regenerate the command reference**

Run: `git rm -r -q website/docs/reference/setup/switchboard && bun run docs:gen && bun run docs:check && bun run picker:check`
Expected: `docs:gen` rewrites `website/docs/reference/setup/index.mdx` without the `switchboard` row and does not recreate `setup/switchboard/`; `docs:check` and `picker:check` exit 0.

- [ ] **Step 7: Run the suites to verify they pass**

Run: `bun test lib/setup lib/team commands/__tests__/setup-connect.test.ts commands/__tests__/setup-copy.test.ts lib/__tests__/no-settings-bypass.test.ts lib/__tests__/picker-conformance.test.ts && bun run typecheck`
Expected: all PASS; `setup-copy` snapshots unchanged (no snapshot names a switchboard row or connect); typecheck exits 0. If `typecheck` reports a leftover `"switchboard"` literal typed as `Integration` or a `switchboardUrl` on `UserIntegrationOverrides`, remove that use; `rg -n "integrations\.switchboard|switchboardUrl\b|\"switchboard\"" lib commands --glob '!**/__tests__/**'` must print only `switchboardUrl(` calls.

- [ ] **Step 8: Commit**

```bash
git add -A lib/setup lib/team/board-token.ts lib/team/__tests__/board-token.test.ts commands/setup.ts commands/__tests__/setup-connect.test.ts lib/command-tree-def.ts lib/daemon.ts lib/__tests__/no-settings-bypass.test.ts website/docs/reference
git commit -m "$(cat <<'EOF'
setup: drop the switchboard rows; board peering covers every joined team

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The board resolves the switchboard from the helper

**Files:**
- Modify: `apps/board/src/config.ts` (imports 1-17, `SwitchboardBoardConfig` doc 219-228, `parseConfig` 367 and 400, `stripTrailingSlash` + `parseSwitchboard` 488-531, overlay docblock 713-729, `merged.switchboard` 793-797, `isSwitchboardUrlOwned` + `saveSwitchboardUrl` 1134-1173, `loadSwitchboardToken` doc 1215)
- Modify: `apps/board/src/peer/invite.ts` (`parseInvite`, `classifySetupAnswer`, delete `carrySwitchboard`)
- Modify: `apps/board/src/peer/onboard.ts` (`JoinCtx`, `joinSwitchboard`)
- Modify: `apps/board/src/peer/runtime.ts` (new `switchboardTokenBanner`)
- Modify: `apps/board/src/server.ts` (imports 18-35 and 59-79, `let config` 373-376, peering start 493-512, `/data.json` 1485-1493, `/peer/invite|boards|remove` 3118-3191, `/peer/join` 3203-3270)
- Modify: `apps/board/src/client/types.ts:228-237`
- Modify: `apps/board/scripts/setup.ts:28-36,297-380`
- Modify: `apps/board/bin/triage.ts:6,74-83,268-269`
- Create: `apps/board/src/__tests__/peer-token-banner.test.ts`
- Test: `apps/board/src/__tests__/config.test.ts`, `config-store-latch.test.ts`, `peer-invite.test.ts`, `peer-onboard.test.ts`

**Interfaces:**
- Consumes: `switchboardUrl()` and `listTeams()` from `@mattstack/rt-client`.
- Produces: `parseInvite(s: string, relayUrl: string)`, `classifySetupAnswer(s: string, relayUrl: string): { kind: 'skip' } | { kind: 'invite'; url: string; code: string } | { kind: 'invalid'; message: string }`, `JoinCtx { defaultMember; relayUrl; persist(token: string); startPeering(url, token); fetchFn? }`, `switchboardTokenBanner(s: { inTeam: boolean; peering: boolean; missing: boolean }): boolean`. `BoardConfig.switchboard.url` is always `switchboardUrl()`. `saveSwitchboardUrl` and `carrySwitchboard` no longer exist.

- [ ] **Step 1: Write the failing board tests**

Create `apps/board/src/__tests__/peer-token-banner.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { switchboardTokenBanner } from '../peer/runtime.ts';

describe('switchboardTokenBanner', () => {
  test('shows only on a Mac in a team whose board is not peering and holds no token', () => {
    expect(
      switchboardTokenBanner({ inTeam: true, peering: false, missing: true })
    ).toBe(true);
  });

  test('a Mac in no team never shows it', () => {
    expect(
      switchboardTokenBanner({ inTeam: false, peering: false, missing: true })
    ).toBe(false);
  });

  test('a peering board or an unread token never shows it', () => {
    expect(
      switchboardTokenBanner({ inTeam: true, peering: true, missing: true })
    ).toBe(false);
    expect(
      switchboardTokenBanner({ inTeam: true, peering: false, missing: false })
    ).toBe(false);
  });
});
```

In `apps/board/src/__tests__/config.test.ts`: remove `saveSwitchboardUrl,` from the `../config.ts` import, add `import { switchboardUrl } from '@mattstack/rt-client';` (keep the existing `import type` line), and replace `describe('switchboard config', ...)` and `describe('saveSwitchboardUrl', ...)` (lines 351-423) with:

```ts
describe('switchboard config', () => {
  test('always the built-in switchboard, whatever config.json says', () => {
    expect(parseConfig(JSON.stringify(base)).switchboard).toEqual({
      url: switchboardUrl(),
    });
    expect(
      parseConfig(
        JSON.stringify({
          ...base,
          switchboard: { url: 'https://elsewhere.example.dev' },
        })
      ).switchboard
    ).toEqual({ url: switchboardUrl() });
  });

  test('a leftover switchboard block of any shape never fails a parse', () => {
    for (const switchboard of [
      'x',
      { url: 5 },
      { url: 'http://sb.example.dev' },
      null,
    ]) {
      expect(
        parseConfig(JSON.stringify({ ...base, switchboard })).switchboard.url
      ).toBe(switchboardUrl());
    }
  });
});
```

In `apps/board/src/__tests__/config-store-latch.test.ts`: remove `saveSwitchboardUrl,` from the `../config.ts` import, add `switchboardUrl,` to the `@mattstack/rt-client` import, and:

- Replace `test("a store switchboardUrl with a trailing slash strips it, same as parseSwitchboard's file-side rule", ...)` with:

```ts
  test('a board.switchboardUrl an older rt left in the store is never read', () => {
    const p = tmpConfig({
      ...base,
      switchboard: { url: 'https://old-file.example.app' },
    });
    const cfg = loadConfigFrom(
      p,
      fakeResolve({ 'board.switchboardUrl': 'https://old-store.example.app' })
    );
    expect(cfg.switchboard.url).toBe(switchboardUrl());
  });
```

- Rename `describe('saveMemberHidden / saveSwitchboardUrl: config.json-free still succeeds (RULING: file-authority is meaningless with no file)', ...)` to `describe('saveMemberHidden: config.json-free still succeeds', ...)`, change the `teamOwned` comment to `// board.hiddenMembers deliberately absent -- unowned going in`, and delete its last test `saveSwitchboardUrl with owned team keys and no config.json establishes board.switchboardUrl ownership`.
- Delete `describe('saveSwitchboardUrl: latch-gated writer', ...)` (lines 871-912).

In `apps/board/src/__tests__/peer-invite.test.ts`, replace the whole file's import and the `parseInvite`, `classifySetupAnswer` and `carrySwitchboard` describes with (keep `describe('redeemInvite', ...)` unchanged):

```ts
import { describe, expect, test } from 'bun:test';

import {
  classifySetupAnswer,
  parseInvite,
  redeemInvite,
} from '../peer/invite.ts';

const SB = 'https://sb.example.app';

describe('parseInvite', () => {
  test('extracts url + code, tolerating whitespace', () => {
    const p = parseInvite(
      '  https://sb.example.app/invite/aabbccddeeff00112233445566778899 \n',
      SB
    );
    expect(p).toEqual({
      ok: true,
      url: 'https://sb.example.app',
      code: 'aabbccddeeff00112233445566778899',
    });
  });
  test('lowercases the code and tolerates a trailing slash after it', () => {
    const upper = parseInvite(
      'https://sb.example.app/invite/AABBCCDDEEFF00112233445566778899',
      SB
    );
    expect(upper).toEqual({
      ok: true,
      url: 'https://sb.example.app',
      code: 'aabbccddeeff00112233445566778899',
    });
    const slashed = parseInvite(
      'https://sb.example.app/invite/aabbccddeeff00112233445566778899/',
      `${SB}/`
    );
    expect(slashed).toEqual({
      ok: true,
      url: 'https://sb.example.app',
      code: 'aabbccddeeff00112233445566778899',
    });
  });
  test('rejects non-invite strings with a clear message', () => {
    for (const bad of [
      '',
      'not a url',
      'https://sb.example.app',
      'https://sb.example.app/invite/',
      'https://sb.example.app/invite/nothex!',
    ]) {
      const p = parseInvite(bad, SB);
      expect(p.ok).toBe(false);
    }
  });
  test('refuses an invite minted on another host, naming the switchboard it accepts', () => {
    const p = parseInvite(
      'https://evil.example.app/invite/aabbccddeeff00112233445566778899',
      SB
    );
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.message).toContain(SB);
  });
  test('a different port or scheme on the same name is another host', () => {
    for (const other of [
      'https://sb.example.app:8443/invite/' + 'a'.repeat(32),
      'http://sb.example.app/invite/' + 'a'.repeat(32),
    ]) {
      expect(parseInvite(other, SB).ok).toBe(false);
    }
  });
});

describe('classifySetupAnswer', () => {
  test('blank skips and an invite on the switchboard parses', () => {
    expect(classifySetupAnswer('', SB)).toEqual({ kind: 'skip' });
    expect(
      classifySetupAnswer('https://sb.example.app/invite/' + 'a'.repeat(32), SB)
    ).toEqual({
      kind: 'invite',
      url: 'https://sb.example.app',
      code: 'a'.repeat(32),
    });
  });
  test('a bare url is invalid now: the switchboard address is never typed', () => {
    expect(classifySetupAnswer('https://sb.example.app/', SB)).toEqual({
      kind: 'invalid',
      message: expect.any(String),
    });
  });
  test('garbage, a broken invite and a foreign invite are all invalid', () => {
    for (const answer of [
      'garbage',
      'https://sb.example.app/invite/abc',
      'https://evil.example.app/invite/' + 'a'.repeat(32),
    ]) {
      expect(classifySetupAnswer(answer, SB)).toEqual({
        kind: 'invalid',
        message: expect.any(String),
      });
    }
  });
});
```

In `apps/board/src/__tests__/peer-onboard.test.ts`, inside `describe('joinSwitchboard', ...)`:

- Add `relayUrl: 'https://x',` to every `joinSwitchboard('https://x/invite/' ...` ctx object, and `relayUrl: 'https://sb.example.app',` to the happy-path ctx.
- Change the happy-path `persist` to `persist: token => calls.push(\`persist:${token}\`),` and its expectation to:

```ts
    expect(calls).toEqual([
      'persist:tok',
      'start:https://sb.example.app:tok',
    ]);
```

- The `unparseable invite` test adds `relayUrl: 'https://x',`.
- Add:

```ts
  test('an invite on another host is refused before any network call, with nothing persisted or started', async () => {
    let fetched = 0;
    const calls: string[] = [];
    const r = await joinSwitchboard(
      'https://evil.example.app/invite/' + 'a'.repeat(32),
      {
        defaultMember: 'grace',
        relayUrl: 'https://sb.example.app',
        persist: token => calls.push(`persist:${token}`),
        startPeering: () => calls.push('start'),
        fetchFn: fakeFetch(() => (fetched++, Response.json({ token: 'tok' }))),
      }
    );
    expect(r.status).toBe(400);
    expect(r.body).toContain('https://sb.example.app');
    expect(fetched).toBe(0);
    expect(calls).toEqual([]);
  });

  test('redeem goes to the switchboard, never to a path the invite carried', async () => {
    const urls: string[] = [];
    await joinSwitchboard(
      'https://sb.example.app/extra/invite/' + 'a'.repeat(32),
      {
        defaultMember: 'grace',
        relayUrl: 'https://sb.example.app',
        persist: () => {},
        startPeering: () => {},
        fetchFn: fakeFetch(url => (urls.push(url), Response.json({ username: 'grace', token: 'tok' }))),
      }
    );
    expect(urls).toEqual(['https://sb.example.app/invites/redeem']);
  });
```

- [ ] **Step 2: Run the board tests to verify they fail**

Run: `cd apps/board && bun test src/__tests__/peer-token-banner.test.ts src/__tests__/config.test.ts src/__tests__/config-store-latch.test.ts src/__tests__/peer-invite.test.ts src/__tests__/peer-onboard.test.ts`
Expected: FAIL: `switchboardTokenBanner` is not exported, `parseConfig` still honours and validates `switchboard.url`, `loadConfigFrom` reads `board.switchboardUrl`, and `parseInvite` ignores the relay argument.

- [ ] **Step 3: Implement config**

In `apps/board/src/config.ts`:

- Add `switchboardUrl,` to the `@mattstack/rt-client` import.
- `SwitchboardBoardConfig` stays `{ url: string }`. Replace the doc on `BoardConfig.switchboard` with:

```ts
  /** Peer-boards relay: always the built-in switchboard. The token comes from
      SWITCHBOARD_TOKEN or the rt daemon, never config. */
  switchboard: SwitchboardBoardConfig;
```

- In `parseConfig`, replace `const switchboard = parseSwitchboard(cfg.switchboard, source);` with:

```ts
  const switchboard: SwitchboardBoardConfig = { url: switchboardUrl() };
```

- Delete `stripTrailingSlash` and `parseSwitchboard` with their doc comments (lines 488-531).
- In the overlay docblock (713-729) change `+uppercase, switchboard's trailing-slash strip, slack's DEFAULT_SLACK fill` to `+uppercase, slack's DEFAULT_SLACK fill` and `(slack.*, switchboard.*)` to `(slack.*)`.
- In `merged`, delete the `switchboard: { url: storeValue('board.switchboardUrl', resolve) ?? fileConfig.switchboard.url, },` entry (793-797); `...fileConfig` already carries the parsed value.
- Delete `isSwitchboardUrlOwned` and `saveSwitchboardUrl` with its doc comment (1134-1173).
- `loadSwitchboardToken`'s doc: `/** Switchboard board token. Optional: without it the board runs exactly as before, with all peer features disabled. */`.

- [ ] **Step 4: Implement invite parsing and onboarding**

In `apps/board/src/peer/invite.ts`, replace `parseInvite`, `classifySetupAnswer` and their comments with:

```ts
/** Board tokens only ever go to the one switchboard, so an invite minted on
    any other origin is refused before anything is redeemed. */
export function parseInvite(
  s: string,
  relayUrl: string
): { ok: true; url: string; code: string } | { ok: false; message: string } {
  const m = s.trim().match(INVITE_RE);
  if (!m)
    return {
      ok: false,
      message:
        "that doesn't look like a board invite (expected .../invite/<code>)",
    };
  const url = m[1]!.replace(/\/+$/, '');
  if (!sameOrigin(url, relayUrl))
    return {
      ok: false,
      message: `that invite is for another switchboard; mattstack only uses ${relayUrl.replace(/\/+$/, '')}`,
    };
  return { ok: true, url, code: m[2]!.toLowerCase() };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Setup's prompt accepts blank (keep current settings) or a full invite
    link; anything else is a typo worth re-prompting on rather than silently
    treating as "skip". */
export function classifySetupAnswer(
  s: string,
  relayUrl: string
):
  | { kind: 'skip' }
  | { kind: 'invite'; url: string; code: string }
  | { kind: 'invalid'; message: string } {
  const trimmed = s.trim();
  if (!trimmed) return { kind: 'skip' };
  const inv = parseInvite(trimmed, relayUrl);
  if (inv.ok) return { kind: 'invite', url: inv.url, code: inv.code };
  return { kind: 'invalid', message: inv.message };
}
```

Delete `carrySwitchboard` and its doc comment.

In `apps/board/src/peer/onboard.ts`, replace `JoinCtx` and `joinSwitchboard` with:

```ts
export interface JoinCtx {
  defaultMember: string;
  /** The one switchboard this board peers through. */
  relayUrl: string;
  persist(token: string): void;
  startPeering(url: string, token: string): void;
  fetchFn?: typeof fetch;
}

export async function joinSwitchboard(
  invite: string,
  ctx: JoinCtx
): Promise<{ status: number; body: string }> {
  if (!ctx.defaultMember || ctx.defaultMember === 'all') {
    return {
      status: 400,
      body: 'joining needs your own username: set "defaultMember" in config.json first',
    };
  }
  const parsed = parseInvite(invite, ctx.relayUrl);
  if (!parsed.ok) return { status: 400, body: parsed.message };
  const r = await redeemInvite(
    ctx.relayUrl,
    parsed.code,
    canonicalUsername(ctx.defaultMember),
    ctx.fetchFn
  );
  if (!r.ok) {
    const status =
      r.error === 'mismatch'
        ? 409
        : r.error === 'network'
          ? 502
          : r.error === 'expired'
            ? 410
            : 404;
    return { status, body: r.message };
  }
  try {
    ctx.persist(r.token);
  } catch (err) {
    return {
      status: 500,
      body: `joining failed after the invite was used (${err instanceof Error ? err.message : err}); ask for a re-invite and try again`,
    };
  }
  ctx.startPeering(ctx.relayUrl, r.token);
  return {
    status: 200,
    body: JSON.stringify({ ok: true, username: r.username }),
  };
}
```

In `apps/board/src/peer/runtime.ts`, add after `tokenMissingNotice`:

```ts
/** Every Mac in a team peers through the switchboard, so only there does a
    missing token deserve a banner. */
export function switchboardTokenBanner(s: {
  inTeam: boolean;
  peering: boolean;
  missing: boolean;
}): boolean {
  return s.inTeam && !s.peering && s.missing;
}
```

- [ ] **Step 5: Implement the server, setup script and triage**

`apps/board/src/server.ts`:

- Add `listTeams,` to the `@mattstack/rt-client` import block; remove `saveSwitchboardUrl,` from the `./config.ts` import; add `switchboardTokenBanner` to the existing `./peer/runtime.ts` import (find it with `rg -n "peer/runtime" src/server.ts`).
- Replace lines 373-376:

```ts
// `let`: /peer/join reassigns the whole config after persisting switchboard.url.
let config = FIXTURE_DIR
```

with:

```ts
const config = FIXTURE_DIR
```

- Replace the comment and start block (493-512) with:

```ts
// Optional peer relay. Peering needs this Mac to be in a team and a token;
// without either it stays unstarted and every peer feature (publish, poll,
// /nudge) is off. The runtime is startable later too, so joining needs no
// restart.
const inTeam = (): boolean => listTeams().length > 0;
const peerDeps = boardMaterializeDeps(line => console.error(line));
const peering = makePeering({
  makeClient: makeSwitchboardClient,
  deps: peerDeps,
});
// Fire-and-forget: the daemon round trips must not hold up Bun.serve below.
// Writer only: the runtime's tick publishes this board's state and writes
// back what it polls, both of which belong to one process per state root.
// /peer/join's own start path is a human joining a switchboard and stays.
if (inTeam())
  void startPeeringWhenTokenLoads({
    peering,
    url: config.switchboard.url,
    wanted: () => writer,
    loadToken: async () => switchboardToken.note(await getSwitchboardToken()),
  });
```

(Keep whatever lines sit between `deps: peerDeps,` and the `// Fire-and-forget` comment in the file exactly as they are; only the opening comment, the `inTeam` line and the `if` condition change.)

- In the `/data.json` payload (1485-1493) replace the two fields with:

```ts
            canInvite: isLocalRequest(req, server) && !!switchboardAdminToken,
            peering: peering.current() ? peering.current()!.health() : null,
            switchboardTokenMissing: switchboardTokenBanner({
              inTeam: inTeam(),
              peering: !!peering.current(),
              missing: switchboardToken.missing(),
            }),
```

- In `/peer/invite`, `/peer/boards` and `/peer/remove`, change each `if (!switchboardAdminToken || !config.switchboard.url)` to `if (!switchboardAdminToken)`.
- In `/peer/join`, change the opening comment to `// Redeem an invite from the UI: persist the token, then hot-start peering, so joining costs no restart.`, the content-type comment's `re-point this board's switchboard config` to `redeem an invite on this board's behalf`, and replace the whole `joinSwitchboard(invite, { ... })` call with:

```ts
        const r = await joinSwitchboard(invite, {
          defaultMember: config.defaultMember,
          relayUrl: config.switchboard.url,
          persist(token) {
            // upsertEnvKeys reads "" as a removal, so an empty token must never
            // reach it: that would quietly delete the token line this board is
            // already peering with. The message is interpolated into
            // onboard.ts's 500 body, which the join UI shows verbatim.
            if (!token) throw new Error('the switchboard sent nothing usable');
            upsertEnvKeys(ENV_PATH, { SWITCHBOARD_TOKEN: token });
          },
          startPeering: (url, token) => peering.start(url, token),
        });
```

`apps/board/src/client/types.ts` (228-237): change the `canInvite` doc to `local request, and the board holds the switchboard admin credential.` and the `switchboardTokenMissing` doc to:

```ts
  /** This Mac is in a team but the rt daemon holds no board token, so
      peering never starts and no ask can arrive. Absent from an older
      server. */
```

`apps/board/scripts/setup.ts`:

- Imports (28-36): `import { getSetting, setSetting, switchboardUrl } from '@mattstack/rt-client';` and

```ts
import { classifySetupAnswer, redeemInvite } from '../src/peer/invite.ts';
```

- Replace the peer-boards block from `// Peer boards: one paste.` through the closing `}` of the `else if (classified.kind === 'invite') { ... }` branch (297-343) with:

```ts
  // Peer boards: one paste. An invite link joins outright; blank keeps
  // whatever is already configured.
  const relayUrl = switchboardUrl();
  const answer = ask(
    'Board invite for peer boards (paste the link; blank keeps current settings)',
    ''
  );
  const classified = classifySetupAnswer(answer, relayUrl);
  if (classified.kind === 'invalid') {
    console.error(classified.message);
  } else if (
    classified.kind === 'invite' &&
    (!defaultMember || defaultMember === 'all')
  ) {
    // "all" is the same blank as far as peering goes: the board can't tell its
    // own MRs from anyone else's, so redeeming here would burn a one-time
    // invite on a board that would publish nothing.
    console.error('Peer boards need your username; set it above and re-run.');
  } else if (classified.kind === 'invite') {
    // Redeem as late as possible (right before the .env write below) so a crash
    // between redeem and persist cannot burn the one-time invite.
    const r = await redeemInvite(
      relayUrl,
      classified.code,
      canonicalUsername(defaultMember),
      fetch
    );
    if (r.ok) {
      env.SWITCHBOARD_TOKEN = r.token;
      console.log(`Joined peer boards as ${r.username}.`);
    } else {
      console.error(`Could not join peer boards: ${r.message}`);
    }
  }
```

- Delete the block from `// Direct setSetting, not saveSwitchboardUrl:` through the closing `}` of `if ('switchboard' in swUpdate) { ... }` (367-380).

`apps/board/bin/triage.ts`:

- Line 6: `import { listTeams, readDiscussions, readProjectMRs } from '@mattstack/rt-client';`
- Replace `peerPreflight`'s comment and body (73-83) with:

```ts
// A peer pass is only useful on a board that peers. Checked before the claim
// so a machine outside any team, or without a token, exits quietly without
// queueing behind a full pass.
async function peerPreflight(): Promise<boolean> {
  try {
    return listTeams().length > 0 && !!(await loadSwitchboardToken());
  } catch {
    return false;
  }
}
```

- Line 269: `if (switchboardToken) {` (the `boardConfig.switchboard.url` argument to `makeSwitchboardClient` on the next lines stays).

If `loadConfig` is no longer referenced in `bin/triage.ts` other than line 118, leave its import as it is (line 118 still uses it).

- [ ] **Step 6: Run the board suite and typecheck**

Run: `cd apps/board && bunx prettier --write src/config.ts src/server.ts src/peer/invite.ts src/peer/onboard.ts src/peer/runtime.ts src/client/types.ts scripts/setup.ts bin/triage.ts src/__tests__/peer-token-banner.test.ts src/__tests__/config.test.ts src/__tests__/config-store-latch.test.ts src/__tests__/peer-invite.test.ts src/__tests__/peer-onboard.test.ts && bun test && bun run typecheck`
Expected: every board test PASSES, typecheck exits 0. Then from the repo root: `rg -n "saveSwitchboardUrl|carrySwitchboard|manual-url|board\.switchboardUrl|parseSwitchboard" apps/board/src apps/board/bin apps/board/scripts` prints only the `config-store-latch` test's `'board.switchboardUrl'` fake-store key.

- [ ] **Step 7: Commit**

```bash
git add apps/board/src apps/board/scripts/setup.ts apps/board/bin/triage.ts
git commit -m "$(cat <<'EOF'
board: peer through the built-in switchboard only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Retire the stored URLs from the settings registry

`board.switchboardUrl` is a scalar key, so it has no entry in `schema.lock.json`; retiring it is: drop the registry row, list it in `RETIRED_KEYS` (so a stored copy is skipped silently and `unsetSetting` can still remove it), and fix the registry key-count test. `rt.integrations` and `mattstack.integrations` stay loose objects that lose one optional property each, which the schema diff classifies as safe (a property removed where extras stay open), so no `storeVersion` bump and no `breaking-schema-changes.json` entry.

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts:352-360,598-604`
- Modify: `packages/rt-client/src/settings/registry-schemas.ts:146,152`
- Modify: `packages/rt-client/src/settings/registry-machinery.ts:99`
- Modify: `packages/rt-client/src/settings/schema.lock.json` (regenerated)
- Test: `packages/rt-client/src/settings/__tests__/schema-examples.ts:176-190`, `registry.test.ts:344,391`, `resolve.test.ts:434-442`

**Interfaces:**
- Produces: `getDef("board.switchboardUrl") === undefined`, `isRetiredKey("board.switchboardUrl") === true`, `unsetSetting("board.switchboardUrl", "machine")` removes a stored copy. Task 6 relies on the last one.

- [ ] **Step 1: Write the failing tests**

In `packages/rt-client/src/settings/__tests__/resolve.test.ts`, after `test("a retired key left in a store is neither listed nor warned about", ...)` add:

```ts
    test("a switchboard URL an older rt stored is retired: neither listed nor warned about", () => {
      writeMachine({ "board.switchboardUrl": "https://old.example.app" });

      const listed = listSettings();

      expect(listed.find((e) => e.key === "board.switchboardUrl")).toBeUndefined();
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("board.switchboardUrl"))).toBe(false);
      expect(() => getSetting("board.switchboardUrl")).toThrow(/unknown setting/);
    });
```

In `packages/rt-client/src/settings/__tests__/registry.test.ts`, delete `"board.switchboardUrl",` from `suiteKeys` (line 344) and change `expect(suiteKeys).toHaveLength(81);` to `expect(suiteKeys).toHaveLength(80);`.

In `packages/rt-client/src/settings/__tests__/schema-examples.ts`, replace the `rt.integrations` entry and the `switchboard` line of `mattstack.integrations` so they read:

```ts
  "rt.integrations": {
    good: [{}, { forgeHost: "gitlab.example.com" }, { forgeHost: "gitlab.example.com", switchboardUrl: "https://switchboard.example.com" }],
    bad: [{ value: { forgeHost: 443 }, path: ["forgeHost"] }],
    layer: [{ forgeHost: "gitlab.example.com" }],
  },
```

and in `mattstack.integrations.good`'s full example delete `switchboard: { url: "https://switchboard.example.com" },`, then add one more `good` value that proves a leftover still reads:

```ts
      { switchboard: { url: "https://switchboard.example.com" } },
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/rt-client/src/settings/__tests__/resolve.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts`
Expected: FAIL: `board.switchboardUrl` is still registered (listed and resolvable), and the key list has 81 entries.

- [ ] **Step 3: Implement the retirement**

`registry-defs.ts`: delete the `board.switchboardUrl` row (598-604) and replace the `rt.integrations` description (359) with:

```ts
      "User-confirmed integration hosts (forgeHost), written by an explicit `rt setup gitlab connect --host` after that host validates. The one trusted source a credential is ever sent to: mattstack.integrations' team-declared host is shown to the user but never auto-used for a credentialed fetch.",
```

`registry-schemas.ts`:

```ts
  "rt.integrations": z.looseObject({ forgeHost: z.string().optional() }),
```

and delete the line `switchboard: z.looseObject({ url: z.string().optional() }).optional(),` from `mattstack.integrations`.

`registry-machinery.ts` line 99:

```ts
const RETIRED_KEYS: ReadonlySet<string> = new Set(["mattstack.mode", "board.switchboardUrl"]);
```

- [ ] **Step 4: Regenerate the lock and classify the change**

Run: `env HOME="$(mktemp -d)" RT_BATCH=1 bun run cli.ts settings schema lock && git diff --stat -- packages/rt-client/src/settings/schema.lock.json && env HOME="$(mktemp -d)" RT_BATCH=1 bun run cli.ts settings schema diff --against-ref origin/main`
Expected: the lock diff removes only `rt.integrations.properties.switchboardUrl` and `mattstack.integrations.properties.switchboard`; `schema diff` exits 0 and lists both as safe. If `origin/main` is missing locally, run `git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main` first.

- [ ] **Step 5: Rebuild rt-client and run the settings suites**

Run: `cd packages/rt-client && bun run build && cd ../.. && bun test packages/rt-client && bun run typecheck`
Expected: all PASS, including the schema example suite and `dist-freshness.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/rt-client/src/settings
git commit -m "$(cat <<'EOF'
settings: retire the stored switchboard URL keys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The dated migration deletes what machines still carry, plus a source guard

**Files:**
- Create: `lib/setup/migrations/retire-switchboard-url.ts`
- Create: `lib/setup/__tests__/migration-retire-switchboard-url.test.ts`
- Create: `lib/__tests__/no-switchboard-url-setting.test.ts`
- Modify: `lib/setup/migrations/index.ts`
- Modify: `lib/team/board-token.ts` (export `boardRoots` and `sourceBoardRoots`)

**Interfaces:**
- Consumes: `isRetiredKey("board.switchboardUrl")` and `unsetSetting` from Task 5; `boardRoots(p, extraRoots)` and `sourceBoardRoots()` from `lib/team/board-token.ts`.
- Produces: `retireSwitchboardUrlMigration: MigrationDef` with id `2026-10-02-retire-switchboard-url`, registered after `boardPeerTriggerMigration`.

- [ ] **Step 1: Write the failing migration test**

Create `lib/setup/__tests__/migration-retire-switchboard-url.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { machineSettingsPath, userSettingsPath } from "../../rt-paths.ts";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import type { ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { retireSwitchboardUrlMigration } from "../migrations/retire-switchboard-url.ts";
import { fakeProbes } from "./fakes.ts";

const ctxWith = (p: ApplyContext["p"]): ApplyContext => ({ p }) as Partial<ApplyContext> as ApplyContext;

describe("2026-10-02-retire-switchboard-url", () => {
  const origHome = process.env.HOME;
  let home: string;
  let boardConfig: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mig-sb-")));
    process.env.HOME = home;
    boardConfig = join(home, ".mattstack", "board", "config.json");
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function seedMachine(): void {
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), `{\n  "board.switchboardUrl": "https://old.example.app",\n  "mattstack.appPath": "/Applications/mattstack.app"\n}\n`);
  }

  test("is registered after the board-peer migration, so ids stay in date order", () => {
    expect(MIGRATIONS.map((m) => m.id)).toEqual(["2026-10-01-board-peer-trigger", "2026-10-02-retire-switchboard-url"]);
  });

  test("deletes all three stored copies and keeps forgeHost and the rest of config.json", async () => {
    seedMachine();
    setSetting("rt.integrations", { forgeHost: "gitlab.example.com", switchboardUrl: "https://old.example.app" }, "user");
    const p = fakeProbes({ home, files: { [boardConfig]: JSON.stringify({ title: "Board", switchboard: { url: "https://old.example.app" } }) } });

    expect(await retireSwitchboardUrlMigration.run(ctxWith(p))).toEqual({ state: "done", detail: "Removed the old switchboard address" });

    const machine = readFileSync(machineSettingsPath(), "utf8");
    expect(machine).not.toContain("board.switchboardUrl");
    expect(machine).toContain("mattstack.appPath");
    expect(getSetting<Record<string, unknown>>("rt.integrations").value).toEqual({ forgeHost: "gitlab.example.com" });
    expect(JSON.parse(p.readFile(boardConfig)!)).toEqual({ title: "Board" });
  });

  test("a latch holding only the switchboard URL is removed outright", async () => {
    setSetting("rt.integrations", { switchboardUrl: "https://old.example.app" }, "user");

    await retireSwitchboardUrlMigration.run(ctxWith(fakeProbes({ home })));

    expect(readFileSync(userSettingsPath(), "utf8")).not.toContain("rt.integrations");
  });

  test("a switchboard block with other fields keeps them and loses only url", async () => {
    const p = fakeProbes({ home, files: { [boardConfig]: JSON.stringify({ switchboard: { url: "https://old.example.app", note: "keep" } }) } });

    await retireSwitchboardUrlMigration.run(ctxWith(p));

    expect(JSON.parse(p.readFile(boardConfig)!)).toEqual({ switchboard: { note: "keep" } });
  });

  test("BOARD_APP_ROOT's config.json is cleaned too", async () => {
    const pinned = "/srv/board/config.json";
    const p = fakeProbes({ home, env: { BOARD_APP_ROOT: "/srv/board" }, files: { [pinned]: JSON.stringify({ switchboard: { url: "https://old.example.app" } }) } });

    expect((await retireSwitchboardUrlMigration.run(ctxWith(p))).state).toBe("done");
    expect(JSON.parse(p.readFile(pinned)!)).toEqual({});
  });

  test("an unparseable config.json is left alone and does not fail the migration", async () => {
    const p = fakeProbes({ home, files: { [boardConfig]: "{ not json" } });

    expect(await retireSwitchboardUrlMigration.run(ctxWith(p))).toEqual({ state: "skipped", detail: "No old switchboard address on this Mac" });
    expect(p.readFile(boardConfig)).toBe("{ not json");
  });

  test("is idempotent: a second run finds nothing", async () => {
    seedMachine();
    setSetting("rt.integrations", { forgeHost: "gitlab.example.com", switchboardUrl: "https://old.example.app" }, "user");
    const p = fakeProbes({ home, files: { [boardConfig]: JSON.stringify({ switchboard: { url: "https://old.example.app" } }) } });

    await retireSwitchboardUrlMigration.run(ctxWith(p));
    expect(await retireSwitchboardUrlMigration.run(ctxWith(p))).toEqual({ state: "skipped", detail: "No old switchboard address on this Mac" });
    expect(getSetting<Record<string, unknown>>("rt.integrations").value).toEqual({ forgeHost: "gitlab.example.com" });
  });

  test("a clean Mac is skipped", async () => {
    expect(await retireSwitchboardUrlMigration.run(ctxWith(fakeProbes({ home })))).toEqual({ state: "skipped", detail: "No old switchboard address on this Mac" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test lib/setup/__tests__/migration-retire-switchboard-url.test.ts`
Expected: FAIL with `Cannot find module '../migrations/retire-switchboard-url.ts'`.

- [ ] **Step 3: Implement the migration**

In `lib/team/board-token.ts`, add `export` to `function boardRoots(` and to `function sourceBoardRoots(`.

Create `lib/setup/migrations/retire-switchboard-url.ts`:

```ts
import { join } from "path";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting, unsetSetting } from "../../settings/write.ts";
import { boardRoots, sourceBoardRoots } from "../../team/board-token.ts";
import type { Probes } from "../probes.ts";
import type { MigrationDef } from "./index.ts";

function dropUserLatch(): boolean {
  const stored = getSetting<Record<string, unknown>>("rt.integrations").value;
  if (!stored || !("switchboardUrl" in stored)) return false;
  const { switchboardUrl: _retired, ...rest } = stored;
  if (Object.keys(rest).length === 0) unsetSetting("rt.integrations", "user");
  else setSetting("rt.integrations", rest, "user");
  return true;
}

/** A config.json the board cannot parse is the board's to report; this leaves it untouched. */
function dropBoardFileUrl(p: Probes, root: string): boolean {
  const path = join(root, "config.json");
  const raw = p.readFile(path);
  if (raw === null) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const config = parsed as Record<string, unknown>;
  if (!("switchboard" in config)) return false;
  const block = config.switchboard;
  const kept = block !== null && typeof block === "object" && !Array.isArray(block) ? Object.fromEntries(Object.entries(block).filter(([field]) => field !== "url")) : {};
  if (Object.keys(kept).length === 0) delete config.switchboard;
  else config.switchboard = kept;
  p.writeFile(`${path}.tmp`, `${JSON.stringify(config, null, 2)}\n`);
  p.rename(`${path}.tmp`, path);
  return true;
}

export const retireSwitchboardUrlMigration: MigrationDef = {
  id: "2026-10-02-retire-switchboard-url",
  title: "Forget the old switchboard address",
  async run(ctx) {
    const machine = unsetSetting("board.switchboardUrl", "machine");
    const user = dropUserLatch();
    const files = [...new Set(boardRoots(ctx.p, sourceBoardRoots()))].map((root) => dropBoardFileUrl(ctx.p, root));
    if (!machine && !user && !files.includes(true)) return { state: "skipped", detail: "No old switchboard address on this Mac" };
    return { state: "done", detail: "Removed the old switchboard address" };
  },
};
```

In `lib/setup/migrations/index.ts`, keep the existing entry and append the new one:

```ts
import { boardPeerTriggerMigration } from "./board-peer-trigger.ts";
import { retireSwitchboardUrlMigration } from "./retire-switchboard-url.ts";
```

```ts
export const MIGRATIONS: MigrationDef[] = [boardPeerTriggerMigration, retireSwitchboardUrlMigration];
```

- [ ] **Step 4: Run the migration tests to verify they pass**

Run: `bun test lib/setup/__tests__/migration-retire-switchboard-url.test.ts lib/setup/__tests__/update-safe.test.ts lib/setup/__tests__/apply.test.ts lib/setup/__tests__/migration-board-peer-trigger.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the source guard**

Create `lib/__tests__/no-switchboard-url-setting.test.ts`:

```ts
/**
 * The switchboard URL is a built-in constant read through switchboardUrl().
 * A stored copy from an older rt may linger on a Mac until the retire
 * migration runs, so nothing but that migration and the retired-key list may
 * name one. Named no-* so it runs on every PR.
 */

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..", "..");
const SCAN = ["cli.ts", "commands", "lib", "packages/rt-client/src", "apps/board/src", "apps/board/bin", "apps/board/scripts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__", "fixtures"]);
const ALLOWED = new Set(["lib/setup/migrations/retire-switchboard-url.ts", "packages/rt-client/src/settings/registry-machinery.ts"]);
const PATTERNS = [/["']board\.switchboardUrl["']/, /\bswitchboardUrl\s*:/, /\.switchboardUrl\b/];

function sourceFiles(path: string): string[] {
  if (statSync(path).isFile()) return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  return readdirSync(path)
    .filter((name) => !SKIP_DIRS.has(name))
    .flatMap((name) => sourceFiles(join(path, name)));
}

test("no code reads or writes a stored switchboard URL", () => {
  const offenders = SCAN.flatMap((p) => sourceFiles(join(ROOT, p)))
    .map((file) => relative(ROOT, file))
    .filter((rel) => !ALLOWED.has(rel))
    .filter((rel) => PATTERNS.some((re) => re.test(readFileSync(join(ROOT, rel), "utf8"))));
  expect(offenders, "read the switchboard through switchboardUrl() from @mattstack/rt-client").toEqual([]);
});
```

- [ ] **Step 6: Run the guard**

Run: `bun test lib/__tests__/no-switchboard-url-setting.test.ts`
Expected: PASS. If it lists a file, that file still reads or writes a stored URL: fix the file (never widen `ALLOWED`).

- [ ] **Step 7: Commit**

```bash
git add lib/setup/migrations lib/setup/__tests__/migration-retire-switchboard-url.test.ts lib/__tests__/no-switchboard-url-setting.test.ts lib/team/board-token.ts
git commit -m "$(cat <<'EOF'
setup: migrate away the stored switchboard addresses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Docs, AGENTS.md and the VM fixture

**Files:**
- Modify: `AGENTS.md:574-595`
- Modify: `website/docs/guides/teams-and-invites.mdx:40`
- Modify: `apps/board/docs/peer-boards.md:47-55,105-112,157-161`
- Modify: `apps/board/docs/configuration.md:48`
- Modify: `apps/board/docs/api.md:29-30,70`
- Modify: `apps/board/config.example.json:51-53`, `apps/board/config.team.example.json:36`
- Modify: `rt-tray/vm/fixtures/team-kitchen-sink/settings.team.json`, `rt-tray/vm/fixtures/team-kitchen-sink/README.md`, `rt-tray/vm/check-vm-scripts.sh:203-205`

- [ ] **Step 1: Rewrite the AGENTS.md section**

Replace the whole `## Switchboard and \`rt team join\`` section body (the paragraph from `The switchboard is the only service a board token is ever sent to` through `the seams, and RT-260 is the incident that made this a rule.`) with:

```markdown
The switchboard URL is a built-in constant, `SWITCHBOARD_URL` in
`packages/rt-client/src/switchboard.ts`, read only through `switchboardUrl()`.
No setting holds it and no setup row asks for it; the hidden
`RT_SWITCHBOARD_URL` override (https, or http to loopback, never written or
shown) exists for local relay work and tests. A board token is only ever sent
to `switchboardUrl()`. `rt team invite` mints the invitee's board token there
when this Mac holds the switchboard admin token and seals only the token into
the invite; `rt team join` stores it under the rt secrets scope, writes no URL
setting, and refuses a pointer from an older rt whose URL is not
`switchboardUrl()`. The board refuses a pasted invite on any other origin.
The `account.board-peering` row applies on every Mac that joined a team by
invite: `needs-you` with the re-invite remedy when neither the board's `.env`
nor rt's `switchboardToken` holds a token, `error` with a re-check when
`<url>/healthz` (no auth header; `/health` is not a route) does not answer
200, `ready` otherwise. It is never required or finish-gated (only the owner
can fix it), but `verify` reports it, so `rt setup update` notifies. The
stored copies older rt wrote (`board.switchboardUrl`,
`rt.integrations.switchboardUrl`, the board's `config.json` `switchboard.url`)
are retired keys deleted by the `2026-10-02-retire-switchboard-url`
migration, and `lib/__tests__/no-switchboard-url-setting.test.ts` fails any
code that names one. Change invite, join and the row together or not at all;
`lib/team/invite.ts`, `lib/team/join.ts`, `lib/team/board-token.ts` and
`lib/setup/validators/accounts.ts` are the seams, and RT-260 is the incident
that made this a rule.
```

- [ ] **Step 2: Rewrite the user and board docs**

`website/docs/guides/teams-and-invites.mdx` line 40: delete the paragraph that starts `When the team declares a switchboard, joining confirms its URL`. The next paragraph (`The invite also carries the joiner's board token. ...`) stays as written.

`apps/board/docs/peer-boards.md`:

- Replace the paragraph `` `bun run setup` prompts once for a board invite. ... `` and the following `A bare URL with no /invite/<code> ...` paragraph with:

```markdown
`bun run setup` prompts once for a board invite. Paste the whole link your
operator gave you (`.../invite/<code>`) and setup redeems it, writing the
token it gets back to `.env` as `SWITCHBOARD_TOKEN`. Blank input keeps
whatever is already configured. The board only accepts an invite from
mattstack's own switchboard; an invite link on any other host is refused.
```

- In `## Inviting teammates`, delete the sentence `You also need\n\`switchboard.url\` configured.` so the paragraph ends at `on the machine running your own board.`
- Replace the paragraph `The invite link works everywhere: ... since "join peer boards" only accepts a link.` with:

```markdown
The invite link works everywhere: `bun run setup`'s prompt and the board's own
"join peer boards". A raw `POST /boards` token is for headless operator setups
only: put it in `.env` as `SWITCHBOARD_TOKEN` yourself.
```

`apps/board/docs/configuration.md`: delete the table row `| \`switchboard\` | \`{ "url": "..." }\` for peer boards. See [peer boards](peer-boards.md) |`.

`apps/board/docs/api.md`: line 30 becomes `local and this board holds the switchboard admin secret.`; in line 70 change `\`400\` with no switchboard configured` to `\`400\` when this board is not peering`.

`apps/board/config.example.json`: delete the `"switchboard": { "url": "" },` block (three lines plus the comma on the preceding `}` stays valid JSON: verify with `jq . apps/board/config.example.json`). `apps/board/config.team.example.json`: delete the line `"switchboard": { "url": "" },`.

- [ ] **Step 3: Update the VM fixture and its check**

`rt-tray/vm/fixtures/team-kitchen-sink/settings.team.json`: delete the `"switchboard": { "url": "https://vmtest-switchboard.example.invalid" }` member (and the comma before it), leaving `mattstack.integrations` with `linear` and `slack`.

`rt-tray/vm/fixtures/team-kitchen-sink/README.md`: replace the first two paragraphs with:

```markdown
# team-kitchen-sink

Everything the team scope can declare without a second live service: two
tracked private repos, two team-authored plugins plus one team-chosen plugin
from a public marketplace (`claude.marketplaces` + `claude.plugins`, team
scope: installed on the joiner, never auto-enabled), three secrets across
two domains, a team-scope board title, and a declared Slack app.

`mattstack.integrations.slack` is fake (`A0VMTESTFAKE` and an obviously
invalid client id) ... it exists only so `declaredIntegrations()`
(`lib/setup/validators/accounts.ts`) requires `account.slack`, the same as a
real team declares. This is deliberate: a real team's fixture must declare
what a real team declares, or H1 (`assert-team.sh`'s `requiredMissing`
check) has nothing to catch. **Running this fixture will make H1 FAIL until
the joiner has a working way to satisfy that row**, since there is no fake
credential that reads as `ready` for Slack today. That failure is this
fixture doing its job: it is the gap an audit found, made visible instead of
invisible.
```

`rt-tray/vm/check-vm-scripts.sh` (lines 203-205): replace the check with:

```bash
t "kitchen-sink fixture declares slack, matching accounts.ts" bash -c \
  'jq -e ".\"mattstack.integrations\".slack.clientId and (.\"mattstack.integrations\".switchboard | not)" fixtures/team-kitchen-sink/settings.team.json >/dev/null \
   && grep -q "clientId" ../../lib/setup/validators/accounts.ts'
```

- [ ] **Step 4: Verify the docs and fixture**

Run: `jq . apps/board/config.example.json apps/board/config.team.example.json rt-tray/vm/fixtures/team-kitchen-sink/settings.team.json >/dev/null && (cd rt-tray/vm && bash check-vm-scripts.sh) && bun run docs:check && rg -n "switchboard connect|account\.switchboard|access\.switchboard|board\.switchboardUrl|RT_INVITE_RELAY_URL" AGENTS.md website/docs apps/board/docs apps/board/README.md rt-tray/vm docs/settings-architecture.md && rg -n "[\x{2014}\x{2013}]" AGENTS.md apps/board/docs/peer-boards.md rt-tray/vm/fixtures/team-kitchen-sink/README.md docs/superpowers/plans/2026-10-02-switchboard-url-constant.md`
Expected: the `jq` checks and `check-vm-scripts.sh` pass, `docs:check` exits 0; the first `rg` prints only lines of AGENTS.md's rewritten section that name the retired keys; the dash `rg` prints nothing new from this change (pre-existing AGENTS.md lines outside the rewritten section are out of scope).

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md website/docs/guides/teams-and-invites.mdx apps/board/docs apps/board/config.example.json apps/board/config.team.example.json rt-tray/vm/fixtures/team-kitchen-sink rt-tray/vm/check-vm-scripts.sh
git commit -m "$(cat <<'EOF'
docs: the switchboard URL is built in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Whole-branch verification

No new code; every finding here is fixed in the task that owns the file, with its own commit.

- [ ] **Step 1: Root unit suite, static gates, board suite**

Run: `bun run test`
Expected: PASS (all shards' directories).

Run: `bun run check`
Expected: exits 0 (turbo static gates, including typecheck, lint, the schema lock and `docs:check`).

Run: `cd apps/board && bun test && bun run typecheck`
Expected: PASS, exit 0.

Run: `bun run test:e2e`
Expected: PASS (the e2e suite covers the frozen setup and team envelopes end to end).

- [ ] **Step 2: Setup plan JSON on an isolated joined Mac**

Run:

```bash
T="$(mktemp -d)"
mkdir -p "$T/.mattstack/teams/acme/mattstack" "$T/.mattstack/rt/teams"
printf '{"mattstack.integrations":{"switchboard":{"url":"https://old.example.app"}}}\n' > "$T/.mattstack/teams/acme/mattstack/settings.team.jsonc"
printf '{"createdByRt":false,"joinedByRt":true,"rtMayManageMembership":false}\n' > "$T/.mattstack/rt/teams/acme.json"
env -i HOME="$T" PATH="$PATH" RT_BATCH=1 bun cli.ts setup plan --team acme --json | jq -r '.groups[].rows[].id' | grep -E 'switchboard|board-peering'
rm -rf "$T"
```

Expected: exactly one line, `account.board-peering`; no `account.switchboard`, no `access.switchboard`. If the plan command exits non-zero for an unrelated reason (a missing tool on this machine), the `jq` still reads the envelope; a parse failure is a real defect to investigate.

- [ ] **Step 3: Render the board in Fast Browser, light and dark**

Boot the board from this worktree in fixture mode with an isolated HOME and a scratch copy of the fixture:

```bash
T="$(mktemp -d)"; cp -R apps/board/tests/fixture "$T/fixture"
(cd apps/board && env HOME="$T" BOARD_FIXTURE="$T/fixture" PORT=7941 bun run src/server.ts)
```

(run it in the background; stop it after the screenshots.)

Delegate to the `fast-browser:browser-driver` agent: open `http://localhost:7941/`, screenshot the board, open the settings modal (team members, with "join peer boards"), screenshot it, then switch the theme (the board's theme control, or `localStorage['mrs-theme']` then reload) and take the same two screenshots dark. Look at all four: the settings modal must show no switchboard URL field or text, no missing-token banner on the board, nothing clipped, no unstyled control, both schemes legible. Report plainly what looks wrong, if anything, rather than declaring success.

- [ ] **Step 4: Final guard sweep**

Run: `rg -n "inviteRelayUrl|DEFAULT_INVITE_RELAY_URL|RT_INVITE_RELAY_URL|saveSwitchboardUrl|carrySwitchboard|declaresHttpsSwitchboard|confirmSwitchboardForRt|setupSwitchboard" --glob '!docs/superpowers/**' --glob '!**/docs/superpowers/**' .`
Expected: no output.

Run: `git status --short`
Expected: clean (every change committed in its task).
