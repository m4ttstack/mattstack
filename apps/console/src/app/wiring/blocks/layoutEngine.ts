import type { ELK } from 'elkjs/lib/elk-api';

import { fromElk, toElk, type LayoutEngine } from './model/elkGraph';

const engineOver = (elk: ELK): LayoutEngine => ({
  layout: async input => fromElk(await elk.layout(toElk(input))),
});

let loading: Promise<LayoutEngine> | null = null;
let running: ELK | null = null;

export function loadLayoutEngine(): Promise<LayoutEngine> {
  if (loading) return loading;
  const mine: Promise<LayoutEngine> = Promise.all([
    import('elkjs/lib/elk-api'),
    import('elkjs/lib/elk-worker.min.js?worker'),
  ])
    .then(([{ default: ElkApi }, { default: ElkWorker }]) => {
      const elk = new ElkApi({ workerFactory: () => new ElkWorker() });
      if (loading !== mine) {
        elk.terminateWorker();
        throw new Error('The layout engine was dropped while it loaded');
      }
      running = elk;
      return engineOver(elk);
    })
    .catch((error: unknown) => {
      if (loading === mine) forgetLayoutEngine();
      throw error;
    });
  loading = mine;
  return mine;
}

/** Drops the cached engine and stops its worker, so the next load starts
    afresh: elk-api never rejects a layout whose worker failed to load. */
export function forgetLayoutEngine(): void {
  running?.terminateWorker();
  running = null;
  loading = null;
}

export function bundledEngine(): LayoutEngine {
  let elk: Promise<ELK> | null = null;
  return {
    layout: async input => {
      elk ??= import('elkjs/lib/elk.bundled.js').then(
        ({ default: Elk }) => new Elk()
      );
      return engineOver(await elk).layout(input);
    },
  };
}
