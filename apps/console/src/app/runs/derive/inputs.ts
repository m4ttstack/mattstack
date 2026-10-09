import type { EffectiveInputsPayload } from '../../../server/effectiveInputs';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The side card's two lines about what the run was told: its pack at the
    recorded sha and whether the source still matches, then how many
    settings and stage docs it read. */
export function inputsSummary(payload: EffectiveInputsPayload): {
  pack: string;
  counts: string;
} {
  const first = payload.packVersions?.[0];
  let pack: string;
  if (payload.packVersions === null) pack = 'pack version not recorded';
  else if (!first) pack = 'no pack recorded';
  else {
    const state =
      first.drifted === false
        ? 'in sync'
        : first.drifted
          ? 'source has moved'
          : 'pack not found here';
    pack = `${first.pack} pack ${first.recordedSha.slice(0, 7)} · ${state}`;
  }
  return {
    pack: payload.packDirty ? `${pack} · uncommitted` : pack,
    counts: `${plural(payload.config.length, 'setting')} · ${plural(payload.stages.length, 'stage doc')}`,
  };
}
