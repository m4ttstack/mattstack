import { createContext, useContext } from 'react';

export interface ShellRailState {
  expanded: boolean;
  close: () => void;
}

export const ShellRailContext = /* @__PURE__ */ createContext<ShellRailState>({
  expanded: false,
  close: () => {},
});

export function useShellRail(): ShellRailState {
  return useContext(ShellRailContext);
}

/** The top bar's two page-owned spots, filled through `MattstackShell.AppBar`:
 *  `start` follows the page context, `end` sits before the header actions. */
export interface ShellAppBarTargets {
  start: HTMLElement | null;
  end: HTMLElement | null;
}

/** Null outside a MattstackShell, so AppBar can tell "no shell" from "the
    shell's bar has not mounted yet". */
export const ShellAppBarContext =
  /* @__PURE__ */ createContext<ShellAppBarTargets | null>(null);
