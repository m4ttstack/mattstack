import { createContext, useCallback, useContext } from 'react';

import { forgeText, type Forge } from '../../shared/forge';

export const ForgeContext = createContext<Forge>('gitlab');

export function useForge(): Forge {
  return useContext(ForgeContext);
}

/** Reads a string in the team's forge copy: PR and GitHub on GitHub, as written on GitLab. */
export function useForgeText(): (text: string) => string {
  const forge = useContext(ForgeContext);
  return useCallback((text: string) => forgeText(text, forge), [forge]);
}
