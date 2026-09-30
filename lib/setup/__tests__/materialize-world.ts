export function materializeWorld(home: string, opts: { fragment?: string; remote?: string } = {}) {
  const zone = `${home}/.mattstack/teams/acme/mattstack`;
  const engine = `${home}/engine`;
  return {
    env: { RT_ENGINE_PACK_DIR: engine },
    dirs: {
      [engine]: ["pack"],
      [`${home}/.mattstack/teams`]: ["acme"],
      [`${zone}/packs`]: ["widgets"],
    },
    files: {
      [`${engine}/pack/skills.jsonc`]: "{}",
      [`${zone}/mattstack.jsonc`]: JSON.stringify({ role: "team", namespace: "acme" }),
      [`${zone}/team.jsonc`]: JSON.stringify({ gitlabHost: "https://gitlab.example.com", projects: ["acme/widgets"] }),
      [`${zone}/packs/widgets/pack/skills.jsonc`]: opts.fragment ?? "{}",
    },
    exec: async (argv: string[]) =>
      argv[0] === "git" && argv.includes("get-url")
        ? { code: 0, stdout: `${opts.remote ?? "https://gitlab.example.com/acme/widgets.git"}\n`, stderr: "" }
        : { code: 0, stdout: "", stderr: "" },
  };
}
