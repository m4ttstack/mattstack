import { GROUP_TITLES, REPO_PLACE_ROW_PREFIX, type Group, type GroupId, type Row } from "./contract.ts";

const SPLIT_ORDER: GroupId[] = ["agents", "browser", "repos", "rt", "team"];

const HOME: Record<string, GroupId> = {
  "tool.herdr": "agents",
  "tool.claude": "agents",
  "tool.plugins": "agents",
  "tool.linear-mcp": "agents",
  "skills.writing-style": "agents",
  "tool.editor": "agents",
  "tool.extension": "agents",
  "tool.vsix": "agents",
  "tool.fast-browser": "browser",
  "tool.fast-browser-extension": "browser",
  "tool.chrome": "browser",
  "tool.chrome-signin": "browser",
  "tool.rt": "rt",
  "tool.rt-link": "rt",
  "tool.app": "rt",
  "tool.daemon": "rt",
  "tool.flavor": "rt",
  "tool.shell": "rt",
  "tool.intercepts": "rt",
  "tool.legacy-dirs": "rt",
  "tool.proxy": "rt",
  "tool.state-backup": "team",
  "home.backup": "team",
  "team.sync": "team",
  "team.marketplace": "team",
  "team.one-per-machine": "team",
  "org.folder": "team",
  "org.layout": "team",
  "org.sparse": "team",
  "org.branch": "team",
  "board.team-fields": "team",
  "tool.mission-control": "mac",
};

function homeOf(row: Row): GroupId {
  if (row.id.startsWith("pack.")) return "agents";
  if (row.id.startsWith("tool.team.")) return "team";
  if (row.id.startsWith(REPO_PLACE_ROW_PREFIX)) return "repos";
  return HOME[row.id] ?? "tools";
}

/**
 * The validators build one long tools list; a person reads it as four
 * smaller groups. A row no group claims stays under Tools (the group's own
 * error row, a row added without a home), so a row is never dropped.
 */
export function regroupTools(groups: Group[]): Group[] {
  const tools = groups.find((g) => g.id === "tools");
  if (!tools) return groups;
  const hasMac = groups.some((g) => g.id === "mac");
  const byHome = new Map<GroupId, Row[]>();
  for (const row of tools.rows) {
    const home = homeOf(row) === "mac" && !hasMac ? "tools" : homeOf(row);
    byHome.set(home, [...(byHome.get(home) ?? []), row]);
  }
  const out: Group[] = [];
  for (const group of groups) {
    if (group.id === "tools") continue;
    out.push(group.id === "mac" ? { ...group, rows: [...group.rows, ...(byHome.get("mac") ?? [])] } : group);
  }
  for (const id of [...SPLIT_ORDER, "tools" as const]) {
    const rows = byHome.get(id);
    if (rows?.length) out.push({ id, title: GROUP_TITLES[id], rows });
  }
  return out;
}
