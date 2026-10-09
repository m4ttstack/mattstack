/**
 * The one Mattstack MCP entry rt owns in a Codex home's user config:
 * `[mcp_servers.mattstack]` in `<CODEX_HOME>/config.toml`, the table Codex's
 * own `codex mcp add` writes (codex-cli 0.160). Codex hands an MCP server
 * only a fixed set of environment variables, CODEX_HOME not among them, so
 * the entry names its harness and profile in its own arguments. Under
 * `approval_policy = "never"` a tool call that needs approval fails, so the
 * entry approves its own tools; nothing global is changed for that.
 *
 * Edits are text edits that keep every other byte of the file, and each one
 * is checked by parsing the result: anything but this one table changing is
 * refused before a write.
 */

import { createHash } from "crypto";
import { join } from "path";

export const CODEX_MCP_SERVER = "mattstack";

export type CodexMcpEntry = { command: string; args: string[]; default_tools_approval_mode: "approve" };

export function codexConfigFile(codexHome: string): string {
  return join(codexHome, "config.toml");
}

export function codexMcpEntry(rt: string, codexHome: string): CodexMcpEntry {
  return { command: rt, args: ["mcp", "serve", "--harness", "codex", "--profile", codexHome], default_tools_approval_mode: "approve" };
}

// A JSON string literal is a valid TOML basic string.
const tomlString = (value: string): string => JSON.stringify(value);

export function renderCodexMcpTable(entry: CodexMcpEntry): string {
  return [
    `[mcp_servers.${CODEX_MCP_SERVER}]`,
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(", ")}]`,
    `default_tools_approval_mode = ${tomlString(entry.default_tools_approval_mode)}`,
    "",
  ].join("\n");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
}

/** Identifies a table by its parsed value, so reformatting it is not an edit and changing any value is. */
export function codexMcpFingerprint(table: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(table))).digest("hex");
}

type Parsed = { ok: true; config: Record<string, unknown> } | { ok: false };

function parse(text: string): Parsed {
  try {
    const config = Bun.TOML.parse(text) as Record<string, unknown>;
    return config !== null && typeof config === "object" ? { ok: true, config } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function serverTable(config: Record<string, unknown>): unknown {
  const servers = config.mcp_servers;
  return servers !== null && typeof servers === "object" ? (servers as Record<string, unknown>)[CODEX_MCP_SERVER] : undefined;
}

function withoutServer(config: Record<string, unknown>): Record<string, unknown> {
  const servers = config.mcp_servers;
  if (servers === null || typeof servers !== "object") return config;
  const { [CODEX_MCP_SERVER]: _ours, ...others } = servers as Record<string, unknown>;
  const { mcp_servers: _all, ...rest } = config;
  return Object.keys(others).length > 0 ? { ...rest, mcp_servers: others } : rest;
}

export type CodexMcpState =
  | { kind: "unparsable" }
  | { kind: "absent" }
  | { kind: "current" }
  | { kind: "other"; fingerprint: string };

/** `text` null is a config file that does not exist yet. */
export function readCodexMcpState(text: string | null, desired: CodexMcpEntry): CodexMcpState {
  if (text === null) return { kind: "absent" };
  const parsed = parse(text);
  if (!parsed.ok) return { kind: "unparsable" };
  const table = serverTable(parsed.config);
  if (table === undefined) return { kind: "absent" };
  if (Bun.deepEquals(canonical(table), canonical(desired))) return { kind: "current" };
  return { kind: "other", fingerprint: codexMcpFingerprint(table) };
}

const TABLE_HEADER = /^\s*\[\s*mcp_servers\s*\.\s*(?:mattstack|"mattstack")\s*\]\s*(?:#.*)?$/;
const ANY_HEADER = /^\s*\[/;

/** Drops the table's own lines: its header and its key lines, keeping a comment that leads into the next table. */
function cutTable(text: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => TABLE_HEADER.test(line));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !ANY_HEADER.test(lines[end]!)) end++;
  while (end > start + 1 && /^\s*(#.*)?$/.test(lines[end - 1]!)) end--;
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

function appendTable(text: string, entry: CodexMcpEntry): string {
  if (text.trim() === "") return renderCodexMcpTable(entry);
  const body = text.endsWith("\n") ? text : `${text}\n`;
  return `${body.replace(/\n+$/, "\n")}\n${renderCodexMcpTable(entry)}`;
}

export type CodexMcpEdit = { ok: true; text: string } | { ok: false; reason: "unparsable" | "would-change-other-settings" | "not-found" };

/**
 * `append` adds the table to a file that has none; `replace` swaps the
 * existing table for the desired one. Either result must parse to the old
 * file with only this table changed.
 */
export function editCodexMcpEntry(text: string | null, desired: CodexMcpEntry, mode: "append" | "replace"): CodexMcpEdit {
  const before = text ?? "";
  const parsedBefore = parse(before);
  if (!parsedBefore.ok) return { ok: false, reason: "unparsable" };
  let next: string;
  if (mode === "append") {
    next = appendTable(before, desired);
  } else {
    const cut = cutTable(before);
    if (cut === null) return { ok: false, reason: "not-found" };
    next = appendTable(cut, desired);
  }
  const parsedAfter = parse(next);
  if (!parsedAfter.ok) return { ok: false, reason: "would-change-other-settings" };
  const sameRest = Bun.deepEquals(canonical(withoutServer(parsedAfter.config)), canonical(withoutServer(parsedBefore.config)));
  const oursRight = Bun.deepEquals(canonical(serverTable(parsedAfter.config)), canonical(desired));
  return sameRest && oursRight ? { ok: true, text: next } : { ok: false, reason: "would-change-other-settings" };
}
