/**
 * rt bg: CLI over the daemon-owned background herdr server (see
 * docs/superpowers/specs/2026-09-09-background-server-design.md "The bg
 * service"). Thin over the rt-client bg* wrappers, same idiom as
 * commands/gate.ts.
 *
 *   rt bg status [--json]              server up/down + socket + live claims
 *   rt bg release [<owner>] [--json]   release one claim (TTY picker if omitted)
 *   rt bg stop [--json]                stop the server (refuses on live claims)
 */
import { bgRelease as clientRelease, bgStatus as clientStatus, bgStop as clientStop } from "../packages/rt-client/src/index.ts";
import type { Commands, RtResponse } from "../packages/rt-client/src/index.ts";
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";

function fail(msg: string): never {
  out.fail({ title: msg });
  process.exit(1);
}

function positional(args: string[]): string | undefined {
  for (const a of args) {
    if (!a.startsWith("--")) return a;
  }
  return undefined;
}

function unwrap<T>(res: RtResponse<T>, label: string): T {
  if (!res.ok || res.data === undefined) fail(res.error ?? `${label} failed`);
  return res.data;
}

type ClaimRow = Commands["bg:status"]["data"]["claims"][number];

export function bgStatusBlocks(data: Commands["bg:status"]["data"], now: number): Block[] {
  const head = data.up ? out.line("running", "The background server is running") : out.line("off", "The background server is stopped");
  if (data.claims.length === 0) return [head, out.line("skipped", "No live claims")];
  const rows = data.claims.map((c) => [out.strong(c.owner), out.dim(c.pane ?? "-"), `${Math.max(0, Math.round((now - c.createdAt) / 1000))}s`]);
  return [head, out.section("Live claims", undefined, out.table(rows))];
}

export async function bgStatus(args: string[]): Promise<void> {
  const data = unwrap(await clientStatus(), "status");
  if (args.includes("--json")) return void out.json({ ok: true, ...data });
  out.print(...bgStatusBlocks(data, Date.now()));
}

async function fetchClaimOwnersForPicker(): Promise<ClaimRow[]> {
  const res = await clientStatus();
  return res.ok && res.data ? res.data.claims : [];
}

async function pickClaimOwner(claims: ClaimRow[]): Promise<string | null> {
  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  const ownerWidth = Math.max(...claims.map((c) => c.owner.length));
  const options = claims.map((c) => ({
    value: c.owner,
    label: c.owner.padEnd(ownerWidth),
    hint: c.pane ?? "-",
  }));
  return filterableSelect({ message: "pick a claim to release", options, stderr: true });
}

export async function bgRelease(args: string[]): Promise<void> {
  let owner = positional(args);
  const json = args.includes("--json");
  if (!owner) {
    const claims = process.stdin.isTTY && !json && !process.env.RT_BATCH
      ? await fetchClaimOwnersForPicker()
      : [];
    if (claims.length === 0) {
      out.fail(usageFailure("Which claim?", "rt bg release <owner>"));
      process.exit(1);
    }
    const picked = await pickClaimOwner(claims);
    if (!picked) process.exit(0);
    owner = picked;
  }
  const data = unwrap(await clientRelease({ claim: owner }), "release");
  if (json) return void out.json({ ok: true, ...data });
  out.print(data.released ? out.line("done", `Released ${owner}`) : out.line("skipped", `${owner} was not claimed`));
}

const LIVE_CLAIMS = "bg server has live claims: ";

export async function bgStop(args: string[]): Promise<void> {
  const res = await clientStop();
  if (!res.ok && res.error?.startsWith(LIVE_CLAIMS)) {
    const owners = res.error.slice(LIVE_CLAIMS.length);
    out.note(
      out.line("refused", "Left the background server running", `it still has live claims: ${owners}`),
      out.callout("next", out.cmd(`rt bg release ${owners.split(", ")[0]}`)),
    );
    process.exit(1);
  }
  const data = unwrap(res, "stop");
  if (args.includes("--json")) return void out.json({ ok: true, ...data });
  out.print(out.line("done", "Stopped the background server"));
}
