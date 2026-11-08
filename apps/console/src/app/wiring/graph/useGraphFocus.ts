import { useMemo } from 'react';

import {
  useCompositionSnapshot,
  useSkillsCheck,
  useSurface,
} from '../useWiring';
import {
  buildFocusGroups,
  findFocus,
  firstFocus,
  pipelineOf,
} from './model/focusModel';
import { useWiringUrl } from './useWiringUrl';

/**
 * The focus list's groups and the item the canvas shows, shared by the
 * sidebar and the stage so both resolve the URL's `focus` the same way. With
 * no `focus` in the URL the first item stands in without being written there.
 */
export function useGraphFocus(pack: string) {
  const [url, patch] = useWiringUrl();
  const compositionQuery = useCompositionSnapshot(pack);
  const checkQuery = useSkillsCheck(pack);
  const surfaceQuery = useSurface(pack);
  const composition = compositionQuery.data;
  const check = checkQuery.data;
  const packSkills = surfaceQuery.data?.rows;

  const groups = useMemo(
    () =>
      composition ? buildFocusGroups(composition, check, packSkills) : null,
    [composition, check, packSkills]
  );
  const focused = useMemo(() => {
    if (!groups) return null;
    if (url.focus) return findFocus(groups, url.focus);
    const base = url.base ? groups.basePack : null;
    return base?.fills[0] ?? base?.reference[0] ?? firstFocus(groups);
  }, [groups, url.focus, url.base]);
  const pipeline = useMemo(
    () => (groups && focused ? pipelineOf(groups, focused) : null),
    [groups, focused]
  );

  return {
    url,
    patch,
    compositionQuery,
    checkQuery,
    groups,
    focused,
    pipeline,
  };
}
