/**
 * Reads only under ~/.claude/plugins/cache and ~/.claude/skills, and writes
 * nothing: the id is checked against ID_RE before any read, a `dir` is looked
 * up only once its text sits inside the plugin cache, and resolvePointers
 * refuses a compiled.json that points outside its plugin version folder or
 * its skill link before it touches that path.
 */
import { UserActionableError } from "../errors.ts";
import { ID_RE } from "../skills/pointers.ts";
import { dirClimbsOutOfCache, realResolveFs, resolvePointers, type ResolveFs } from "../skills/resolve.ts";
import { err, ok, type McpToolDef } from "./shared.ts";

export interface SkillsResolveDeps {
  fs: ResolveFs;
}

export function skillsResolveToolDefs(deps: SkillsResolveDeps = { fs: realResolveFs }): McpToolDef[] {
  return [
    {
      name: "skills_resolve",
      description: "Resolve a compiled skill's @key pointers to absolute paths. Pass the id from the skill's opening line (<plugin>:<unit>, <plugin>@<version>:<unit> or skills:<name>) and, as dir, the loaded skill's own directory, which pins the run to the plugin version that skill was loaded from; returns { id, folder, covers, keys, pinned, warning? }, where keys maps each @key (without the @) to the path to use. Call it once per run and reuse the map for every id in covers while its folder sits in the same plugin version folder as the loaded skill. Reads only the installed plugin cache and ~/.claude/skills; a refusal means stop and say so, never look for the file another way.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", pattern: ID_RE.source, description: "The skill id, e.g. acme:work or skills:board:respond" },
          dir: { type: "string", description: "The loaded skill's own directory; a <plugin>:<unit> id resolves in the plugin version installed there" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      shellForms: ["rt skills resolve"],
      async handler(input, env) {
        const id = input.id;
        if (typeof id !== "string" || !ID_RE.test(id)) return err("id must be a skill id: <plugin>:<unit>, <plugin>@<version>:<unit> or skills:<name>");
        const dir = input.dir;
        if (dir !== undefined && typeof dir !== "string") return err("dir must be the loaded skill's own directory, as a path");
        const home = env.HOME;
        if (!home) return err("HOME is not set in this server's environment, so the installed skills cannot be found");
        if (dir !== undefined && dirClimbsOutOfCache(dir, home)) return err("dir climbs out of the plugin cache through ..; pass the loaded skill's own directory as it is");
        try {
          return ok(resolvePointers(id, { fs: deps.fs, home }, dir));
        } catch (e) {
          if (!(e instanceof UserActionableError)) throw e;
          return err([e.message, e.why, e.next ? `Fix: ${e.next}` : undefined].filter(Boolean).join(" "));
        }
      },
    },
  ];
}
