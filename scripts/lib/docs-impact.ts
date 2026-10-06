export type DocsArea = "start" | "apps" | "rt" | "gitq" | "skills";
export type DocsImpact = { area: DocsArea; page?: string };

const APPS = new Set(["board", "boxscore", "chat", "console", "deck"]);
const ORDER: DocsArea[] = ["start", "apps", "rt", "gitq", "skills"];
const TAB_DIR: Record<DocsArea, string> = {
  start: "website/docs/start/",
  apps: "website/docs/apps/",
  rt: "website/docs/rt/",
  gitq: "website/docs/gitq/",
  skills: "website/docs/skills/",
};

function impactOf(f: string): DocsImpact | undefined {
  if (f.startsWith("apps/gitq/")) return { area: "gitq" };
  const app = /^apps\/([^/]+)\//.exec(f)?.[1];
  if (app && APPS.has(app)) return { area: "apps", page: `website/docs/apps/${app}.mdx` };
  if (f.startsWith("commands/") || f === "lib/command-tree-def.ts") return { area: "rt" };
  if (f.startsWith("plugins/")) return { area: "skills" };
  if (["rt-tray/", "lib/setup/", "lib/team/", "packages/rt-client/src/settings/"].some((p) => f.startsWith(p))) {
    return { area: "start" };
  }
  return undefined;
}

export function docsImpact(changed: string[]): DocsImpact[] {
  const seen = new Map<string, DocsImpact>();
  for (const f of changed) {
    const i = impactOf(f);
    if (i) seen.set(`${i.area}:${i.page ?? ""}`, i);
  }
  return [...seen.values()].sort(
    (a, b) => ORDER.indexOf(a.area) - ORDER.indexOf(b.area) || (a.page ?? "").localeCompare(b.page ?? ""),
  );
}

export function formatImpact(impacts: DocsImpact[]): string {
  if (impacts.length === 0) return "docs to review: none\n";
  const lines = ["docs to review:"];
  for (const area of ORDER) {
    const hits = impacts.filter((i) => i.area === area);
    if (hits.length === 0) continue;
    const pages = hits.some((h) => !h.page) ? [TAB_DIR[area]] : hits.map((h) => h.page!);
    lines.push(`  ${area}: ${pages.join(", ")}`);
  }
  return lines.join("\n") + "\n";
}
