export interface RegisteredMarketplace {
  name: string;
  kind: string | null;
  /** The `repo`, `url` or `path` Claude Code recorded, whichever its `source` kind carries. */
  source: string | null;
  /** Where Claude Code keeps this marketplace's checkout. */
  installLocation: string | null;
}

export function parseMarketplaceList(stdout: string): RegisteredMarketplace[] | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return null;
    const out: RegisteredMarketplace[] = [];
    for (const m of parsed as { name?: unknown; source?: unknown; repo?: unknown; url?: unknown; path?: unknown; installLocation?: unknown }[]) {
      if (typeof m?.name !== "string") continue;
      const source = [m.repo, m.url, m.path].find((v): v is string => typeof v === "string" && v.length > 0) ?? null;
      out.push({ name: m.name, kind: typeof m.source === "string" ? m.source : null, source, installLocation: typeof m.installLocation === "string" ? m.installLocation : null });
    }
    return out;
  } catch {
    return null;
  }
}
