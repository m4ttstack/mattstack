/**
 * Branch naming template resolver, VSCode extension copy.
 *
 * Synchronous-only: supports ${identifier}, ${teamPrefix}, ${ticketNumber},
 * ${titleSlug}. ${llmSlug:N} falls back to a mechanical slug (LLM is CLI-only).
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getDef, getSetting } from "@mattstack/rt-client";

export interface BranchNamingConfig {
  template: string;
}

const SETTING_KEY = "rt.branchNaming";

function asConfig(raw: unknown): BranchNamingConfig | null {
  const template = (raw as { template?: unknown } | null)?.template;
  if (typeof template !== "string" || !template.trim()) return null;
  return { template: template.trim() };
}

export function defaultBranchNaming(): BranchNamingConfig {
  return asConfig(getDef(SETTING_KEY)?.default) as BranchNamingConfig;
}

const noticed = new Set<string>();

/** The pre-store file is no longer read. Only an org admin can move it, so say how, once per file. */
function noticeLegacyFile(dataDir: string, repoIdentity: string | null): void {
  const legacyPath = join(dataDir, "branch-naming.json");
  if (noticed.has(legacyPath) || !existsSync(legacyPath)) return;
  noticed.add(legacyPath);
  let config: BranchNamingConfig | null;
  try {
    config = asConfig(JSON.parse(readFileSync(legacyPath, "utf8")));
  } catch {
    config = null;
  }
  if (config === null || repoIdentity === null) {
    console.warn(`rt-context: ${legacyPath} is no longer read`);
    return;
  }
  const value = JSON.stringify(config).replaceAll("'", "'\\''");
  console.warn(`rt-context: ${legacyPath} is no longer read. An org admin can move it with: rt settings set rt.branchNaming '${value}' --scope org --repo ${repoIdentity}`);
}

/** Never throws: a store rt cannot read gives the default template. */
export function loadBranchNamingConfig(dataDir: string, repoIdentity: string | null): BranchNamingConfig {
  try {
    const resolved = getSetting<unknown>(SETTING_KEY, { repoIdentity });
    if (resolved.provenance.every((p) => p.scope === "default")) noticeLegacyFile(dataDir, repoIdentity);
    return asConfig(resolved.value) ?? defaultBranchNaming();
  } catch {
    return defaultBranchNaming();
  }
}

function mechanicalSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const VAR_RE = /\$\{([a-zA-Z]+(?::\d+)?)\}/g;

export function resolveBranchName(
  ticket: { identifier: string; title: string },
  config: BranchNamingConfig | null,
): string {
  const template = (config ?? defaultBranchNaming()).template;

  let result = "";
  let lastIndex = 0;

  VAR_RE.lastIndex = 0;

  let match: ReturnType<typeof VAR_RE.exec>;
  while ((match = VAR_RE.exec(template)) !== null) {
    result += template.slice(lastIndex, match.index);

    const raw = match[1]!;
    let varName: string;
    let llmMaxChars: number | undefined;

    if (raw.startsWith("llmSlug")) {
      const colonIdx = raw.indexOf(":");
      if (colonIdx === -1) {
        throw new Error(`Invalid variable \${${raw}}. \${llmSlug} requires :N`);
      }
      const n = parseInt(raw.slice(colonIdx + 1), 10);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Invalid variable \${${raw}}. N must be a positive integer`);
      }
      varName = "llmSlug";
      llmMaxChars = n;
    } else {
      varName = raw;
    }

    switch (varName) {
      case "identifier":
        result += ticket.identifier.toLowerCase();
        break;
      case "teamPrefix":
        result += ticket.identifier.split("-")[0]?.toLowerCase() ?? "";
        break;
      case "ticketNumber":
        result += ticket.identifier.split("-").slice(1).join("-") ?? "";
        break;
      case "titleSlug":
        result += mechanicalSlug(ticket.title);
        break;
      case "llmSlug":
        // LLM is CLI-only; use mechanical slug truncated to maxChars
        result += mechanicalSlug(ticket.title).slice(0, llmMaxChars!);
        break;
      default:
        throw new Error(`Unknown variable \${${raw}}`);
    }

    lastIndex = match.index + match[0].length;
  }

  result += template.slice(lastIndex);
  result = result.replace(/^\/+|\/+$/g, "").trim();

  if (!result) {
    return `${ticket.identifier.toLowerCase()}-${mechanicalSlug(ticket.title)}`;
  }

  return result;
}
