import type { ELK } from 'elkjs/lib/elk-api';

import { fromElk, toElk, type LayoutEngine } from './model/elkGraph';

const engineOver = (elk: ELK): LayoutEngine => ({
  layout: async input => fromElk(await elk.layout(toElk(input))),
});

let loading: Promise<LayoutEngine> | null = null;
let running: ELK | null = null;

export function loadLayoutEngine(): Promise<LayoutEngine> {
  loading ??= Promise.all([
    import('elkjs/lib/elk-api'),
    import('elkjs/lib/elk-worker.min.js?worker'),
  ])
    .then(([{ default: ElkApi }, { default: ElkWorker }]) => {
      running = new ElkApi({ workerFactory: () => new ElkWorker() });
      return engineOver(running);
    })
    .catch((error: unknown) => {
      forgetLayoutEngine();
      throw error;
    });
  return loading;
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
