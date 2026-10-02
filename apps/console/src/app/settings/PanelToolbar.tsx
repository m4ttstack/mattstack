import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The tab bar's right end while the Value tab shows. Null everywhere
    else, so an editor's header stays where the editor draws it. */
export const PanelToolbarSlot = createContext<HTMLElement | null>(null);

export function PanelToolbar({ children }: { children: ReactNode }) {
  const slot = useContext(PanelToolbarSlot);
  return slot ? createPortal(children, slot) : <>{children}</>;
}
