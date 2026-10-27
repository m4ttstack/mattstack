import { createContext, useContext, useEffect } from 'react';

/** How a tab tells the Wiring page it has drawn its content, so the unsynced
    banner arrives with the page rather than ahead of it. */
export const ContentReadyContext = createContext<() => void>(() => {});

/** Reports the tab's content as drawn once `ready` turns true. */
export function useReportReady(ready: boolean) {
  const report = useContext(ContentReadyContext);
  useEffect(() => {
    if (ready) report();
  }, [ready, report]);
}
