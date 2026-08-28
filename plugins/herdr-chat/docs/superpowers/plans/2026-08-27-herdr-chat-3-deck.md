# herdr-chat, part 3: `deck url <service>` (deck)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `deck url <service>` CLI verb that prints a service's local HTTPS URL, so callers (the herdr-chat plugin, scripts) can get it with one command instead of parsing `~/.mattstack/deck/api.json` and curling the HTTP API by hand.

**Architecture:** deck's CLI is already a thin client over its loopback HTTP API (`src/cli/client.ts` reads the port from `~/.mattstack/deck/api.json`; `src/cli/commands.ts` holds the verbs). `deck url` reuses that client to `GET /api/v1/apps/<service>` and prints `row.url`. It adds no new API surface; it exposes a field the CLI does not currently print (`deck status`/`list` show name/port/health but not the URL, and have no `--json`).

**Tech Stack:** Bun + TypeScript, deck's existing CLI client and HTTP API.

**Spec:** No separate design doc; this is a bounded CLI addition. The behavior is fully specified here. Referenced by `2026-08-27-herdr-chat-design.md` (this repo) under "Resolving the viewer URL (deck)".

**Independent:** deck is a standalone repo; this plan does not depend on the invite feature or parts 1 and 2. It can land anytime. Part 2's viewer-URL resolver prefers `deck url chat` when present and falls back to parsing `api.json`, so parts 2 and 3 are decoupled in both directions.

## Global Constraints

- Work in a fresh worktree of the deck repo (`~/Documents/GitHub/deck`), branch `feat/deck-url`, off `main`; never the main checkout.
- Reuse the existing CLI client in `src/cli/client.ts` (the api.json port discovery); do not reimplement port discovery.
- Match deck's existing test convention (see `src/api/server.test.ts` and any `src/cli/*.test.ts`); use `DECK_FIXTURE` fixture mode if the CLI tests already do.
- No em dashes or en dashes in code, comments, docs, or commit messages.
- Commit after the task with a short imperative message.

---

### Task 1: the `deck url <service>` verb

**Files:**
- Modify: `src/cli/commands.ts` (register `url` beside `status`/`list`/`adopt`)
- Modify: `src/cli/client.ts` only if a single-app GET helper does not already exist (add `getApp(name): Promise<{ record, row }>`)
- Test: `src/cli/url.test.ts` (or wherever deck's CLI tests live)

**Interfaces:**
- Behavior: `deck url <service>` prints the service's `row.url` (e.g. `https://chat.mattstack`) and exits 0. Unknown service (the API's `404 {"error":"unknown app"}`) prints a clear message to stderr and exits non-zero. A service with a null `row.url` (no route) is treated as not-found. Optional `--public` prints `row.publicUrl` instead, but only when `row.published` is true; otherwise it errors that the service is not published (deck sets `publicUrl` even for unpublished apps, so `published` is the gate).

- [ ] **Step 1: Write the failing test**

Create the CLI test (match deck's harness; sketch):

```ts
import { expect, test } from "bun:test";
// Match deck's CLI test harness (src/cli/commands.test.ts): boot the fake API, seed a
// record with putRecord, and call runCommand(argv, io) capturing stdout/stderr/exit via io.
import { withFakeDeck, runCommand } from "./commands.test-harness.ts"; // use deck's actual entry points

test("deck url <service> prints row.url", async () => {
  await withFakeDeck({ chat: { url: "https://chat.mattstack", published: false, publicUrl: "https://chat.m4tthew.dev" } }, async (io) => {
    const code = await runCommand(["url", "chat"], io);
    expect(io.stdout.trim()).toBe("https://chat.mattstack");
    expect(code).toBe(0);
  });
});

test("deck url --public errors when the app is not published", async () => {
  await withFakeDeck({ chat: { url: "https://chat.mattstack", published: false, publicUrl: "https://chat.m4tthew.dev" } }, async (io) => {
    const code = await runCommand(["url", "chat", "--public"], io);
    expect(code).not.toBe(0);
    expect(io.stderr).toContain("not published");
  });
});

test("deck url of an unknown service exits non-zero", async () => {
  await withFakeDeck({}, async (io) => {
    const code = await runCommand(["url", "nope"], io);
    expect(code).not.toBe(0);
  });
});
```

(`withFakeDeck` / `runCommand` stand in for deck's real seed-and-run helpers: `src/cli/commands.test.ts` seeds records via `putRecord` and runs the CLI through `runCommand(argv, io)`. Match those exact names and the `io` capture shape.)

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/cli/url.test.ts`
Expected: FAIL, unknown command `url`.

- [ ] **Step 3: Implement the verb**

In `src/cli/commands.ts`, add a `url` command: it takes a positional `<service>` and an optional `--public` flag, calls `getApp(service)` (the existing client GET of `/api/v1/apps/<service>`), and prints `row.url` (or, with `--public`, `row.publicUrl` when `row.published`, else a stderr error and non-zero exit). A 404 from the client becomes a clear "unknown service" stderr line and a non-zero exit. A null `row.url` is treated as unknown.

- [ ] **Step 4: Run tests, lint if deck lints**

Run: `bun test src/cli` (and deck's lint/format if it has one).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands.ts src/cli/client.ts src/cli/url.test.ts
git commit -m "cli: deck url <service>, print a service's local URL"
```

---

## Self-review

- **Spec coverage:** the herdr-chat spec's "Resolving the viewer URL (deck)" names this as the optional side-quest; this plan delivers exactly `deck url <service>` printing `row.url`, with `--public` gated on `row.published` matching the spec's shareable-URL rule.
- **Placeholders:** the test harness shape is the one confirmation against deck's real CLI test convention, resolved at execution.
- **Type consistency:** the `row` fields used (`url`, `publicUrl`, `published`) are exactly deck's `StatusRow` fields.
