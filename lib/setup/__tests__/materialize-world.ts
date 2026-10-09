import { ORG_LAYOUT } from "../../team/org-marker.ts";
/** `siblingFragment` adds a second team folder, `gadgets`, whose pack claims the same repo through the org's claim. */
export function materializeWorld(home: string, opts: { fragment?: string; remote?: string; siblingFragment?: string } = {}) {
  const org = `${home}/.mattstack/orgs/acme/mattstack`;
  const engine = `${home}/engine`;
  const hasSibling = opts.siblingFragment !== undefined;
  return {
    env: { RT_ENGINE_PACK_DIR: engine },
    dirs: {
      [engine]: ["pack"],
      [`${home}/.mattstack/orgs`]: ["acme"],
      [`${org}/teams`]: hasSibling ? ["gadgets", "widgets"] : ["widgets"],
      [`${org}/teams/widgets`]: ["plugin", "settings.team.jsonc"],
      ...(hasSibling ? { [`${org}/teams/gadgets`]: ["plugin", "settings.team.jsonc"] } : {}),
    },
    files: {
      [`${engine}/pack/skills.jsonc`]: "{}",
      [`${home}/.mattstack/orgs/acme/.git/config`]: "",
      [`${org}/mattstack.jsonc`]: JSON.stringify({ role: "org", org: "acme", layout: ORG_LAYOUT }),
      [`${org}/org/settings.org.jsonc`]: JSON.stringify({ "board.gitlabHost": "https://gitlab.example.com", "board.projects": ["acme/widgets"] }),
      [`${org}/teams/widgets/settings.team.jsonc`]: "{}",
      [`${org}/teams/widgets/plugin/pack/skills.jsonc`]: opts.fragment ?? "{}",
      ...(hasSibling
        ? {
            [`${org}/teams/gadgets/settings.team.jsonc`]: "{}",
            [`${org}/teams/gadgets/plugin/pack/skills.jsonc`]: opts.siblingFragment!,
          }
        : {}),
    },
    exec: async (argv: string[]) =>
      argv[0] === "git" && argv.includes("get-url")
        ? { code: 0, stdout: `${opts.remote ?? "https://gitlab.example.com/acme/widgets.git"}\n`, stderr: "" }
        : { code: 0, stdout: "", stderr: "" },
  };
}
