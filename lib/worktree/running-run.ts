/** The daemon log and JSON carry this detail, and the CLI reads the id and stage back out of it. */
export function runningRunDetail(id: string, stage: string): string {
  return `running run ${id} at ${stage}; rt runs abandon ${id}`;
}

export function parseRunningRunDetail(detail: string): { id: string; stage: string } | null {
  const m = /^running run (\S+) at (\S+);/.exec(detail);
  return m ? { id: m[1]!, stage: m[2]! } : null;
}
