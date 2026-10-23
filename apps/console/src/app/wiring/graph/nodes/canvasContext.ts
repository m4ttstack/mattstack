import { createContext, useContext } from 'react';

import type { TemplateView } from '../model/templateModel';

export type CanvasState = {
  view: TemplateView;
  /** The URL's `select`: `row:<line>`, `input:<card id>`, `output`, ... */
  select: string | null;
  onSelect: (select: string) => void;
  onOpenSkill: (skill: string) => void;
};

export const CanvasContext = createContext<CanvasState | null>(null);

/** Node components read the view and the selection from here: React Flow
    hands them only their own node's data. */
export function useCanvas(): CanvasState {
  const state = useContext(CanvasContext);
  if (!state) throw new Error('canvas nodes render inside TemplateCanvas');
  return state;
}

export const MUTED = 'var(--tk-text-3)';
export const BODY = 'var(--tk-text-1)';
export const ACCENT = 'var(--tk-text-accent)';

/** The canvas draws its icons at lucide's own stroke, a step heavier than
    the kit's 1.5, so 12-14px glyphs hold beside 12px text. */
export const ICON_STROKE = 2;
