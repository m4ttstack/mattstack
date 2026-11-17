/**
 * Runs after a team pull moved the clone, behind materialize: renders each
 * husk pack in that org whose inputs changed, so a member's next load_skill
 * finds its tree ready. An unchanged pack costs one input hash.
 */
import type { Logger } from "pino";
import { createRealProbes, type Probes } from "../setup/probes.ts";
import { anyHuskPack } from "../skills/render-paths.ts";

/** renderHuskPacks' shape, spelled out: even a type import of render-packs puts the compile in the daemon graph (no-eager-tui). */
type RenderFn = (p: Probes, opts: { org?: string }) => Promise<{ pack: string; ok: boolean; detail: string }[]>;

export interface RenderPullHookDeps {
  log: Pick<Logger, "debug" | "info" | "warn">;
  probes?: Probes;
  render?: RenderFn;
  /** Loads the render; render-packs reaches the compile, which the daemon graph must not load at boot (no-eager-tui). */
  load?: () => Promise<RenderFn>;
}

const loadRender = async (): Promise<RenderFn> => (await import("../skills/render-packs.ts")).renderHuskPacks;

/** The returned hook never throws: a failed render must not fail the pull that drove it. */
export function createRenderPullHook(deps: RenderPullHookDeps): (slug: string) => Promise<void> {
  return async (slug) => {
    try {
      const probes = deps.probes ?? createRealProbes();
      if (!anyHuskPack(probes, probes.home)) return;
      const render = deps.render ?? (await (deps.load ?? loadRender)());
      const results = await render(probes, { org: slug });
      for (const r of results.filter((r) => !r.ok)) deps.log.warn({ team: slug, pack: r.pack, reason: r.detail }, "team pull: a husk pack did not render");
      const rendered = results.filter((r) => r.ok).map((r) => r.detail);
      if (rendered.length > 0) deps.log.debug({ team: slug, rendered }, "team pull: husk packs checked");
    } catch (err) {
      deps.log.warn({ err, team: slug }, "team pull moved the clone, but rendering husk packs failed; load_skill renders on demand");
    }
  };
}
