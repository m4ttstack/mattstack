import type { ELK } from 'elkjs/lib/elk-api';

import { fromElk, toElk, type LayoutEngine } from './model/elkGraph';

const engineOver = (elk: ELK): LayoutEngine => ({
  layout: async input => fromElk(await elk.layout(toElk(input))),
});

let loading: Promise<LayoutEngine> | null = null;

export function loadLayoutEngine(): Promise<LayoutEngine> {
  loading ??= Promise.all([
    import('elkjs/lib/elk-api'),
    import('elkjs/lib/elk-worker.min.js?worker'),
  ]).then(
    ([{ default: ElkApi }, { default: ElkWorker }]) =>
      engineOver(new ElkApi({ workerFactory: () => new ElkWorker() })),
    (error: unknown) => {
      loading = null;
      throw error;
    }
  );
  return loading;
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
