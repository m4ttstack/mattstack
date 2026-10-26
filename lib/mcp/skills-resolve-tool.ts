/**
 * Reads only under ~/.claude/plugins/cache and ~/.claude/skills, and writes
 * nothing: the id is checked against ID_RE before any read, and
 * resolvePointers refuses a compiled.json that points outside its plugin
 * version folder or its skill link before it touches that path.
 */
import { UserActionableError } from "../errors.ts";
import { ID_RE } from "../skills/pointers.ts";
import { realResolveFs, resolvePointers, type ResolveFs } from "../skills/resolve.ts";
import { err, ok, type McpToolDef } from "./shared.ts";

export interface SkillsResolveDeps {
  fs: ResolveFs;
}

export function skillsResolveToolDefs(deps: SkillsResolveDeps = { fs: realResolveFs }): McpToolDef[] {
  return [
    {
      name: "skills_resolve",
      description: "Resolve a compiled skill's @key pointers to absolute paths. Pass the id from the skill's opening line (<plugin>@<version>:<unit> or skills:<name>); returns { id, folder, covers, keys }, where keys maps each @key (without the @) to the path to use. Call it once per run and reuse the map for every id in covers. Reads only the installed plugin cache and ~/.claude/skills; a refusal means stop and say so, never look for the file another way.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", pattern: ID_RE.source, description: "The skill id, e.g. widgets@0.4.2:work or skills:board:respond" } },
        required: ["id"],
        additionalProperties: false,
      },
      shellForms: ["rt skills resolve"],
      async handler(input, env) {
        const id = input.id;
        if (typeof id !== "string" || !ID_RE.test(id)) return err("id must be a skill id: <plugin>@<version>:<unit> or skills:<name>");
        const home = env.HOME;
        if (!home) return err("HOME is not set in this server's environment, so the installed skills cannot be found");
        try {
          return ok(resolvePointers(id, { fs: deps.fs, home }));
        } catch (e) {
          if (!(e instanceof UserActionableError)) throw e;
          return err([e.message, e.why, e.next ? `Fix: ${e.next}` : undefined].filter(Boolean).join(" "));
        }
      },
    },
  ];
}
