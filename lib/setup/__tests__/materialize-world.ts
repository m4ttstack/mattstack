/** `siblingFragment` adds a second zone, `acme-gadgets`, whose `gadgets` pack claims the same repo. */
export function materializeWorld(home: string, opts: { fragment?: string; remote?: string; siblingFragment?: string } = {}) {
  const zone = `${home}/.mattstack/teams/acme/mattstack`;
  const sibling = `${home}/.mattstack/teams/acme-gadgets/mattstack`;
  const engine = `${home}/engine`;
  const hasSibling = opts.siblingFragment !== undefined;
  return {
    env: { RT_ENGINE_PACK_DIR: engine },
    dirs: {
      [engine]: ["pack"],
      [`${home}/.mattstack/teams`]: hasSibling ? ["acme", "acme-gadgets"] : ["acme"],
      [`${zone}/packs`]: ["widgets"],
      ...(hasSibling ? { [`${sibling}/packs`]: ["gadgets"] } : {}),
    },
    files: {
      [`${engine}/pack/skills.jsonc`]: "{}",
      [`${zone}/mattstack.jsonc`]: JSON.stringify({ role: "team", namespace: "acme" }),
      [`${zone}/team.jsonc`]: JSON.stringify({ gitlabHost: "https://gitlab.example.com", projects: ["acme/widgets"] }),
      [`${zone}/packs/widgets/pack/skills.jsonc`]: opts.fragment ?? "{}",
      ...(hasSibling
        ? {
            [`${sibling}/mattstack.jsonc`]: JSON.stringify({ role: "team", namespace: "acme-gadgets" }),
            [`${sibling}/team.jsonc`]: JSON.stringify({ gitlabHost: "https://gitlab.example.com", projects: ["acme/widgets"] }),
            [`${sibling}/packs/gadgets/pack/skills.jsonc`]: opts.siblingFragment!,
          }
        : {}),
    },
    exec: async (argv: string[]) =>
      argv[0] === "git" && argv.includes("get-url")
        ? { code: 0, stdout: `${opts.remote ?? "https://gitlab.example.com/acme/widgets.git"}\n`, stderr: "" }
        : { code: 0, stdout: "", stderr: "" },
  };
}
