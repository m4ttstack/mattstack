import '@testing-library/jest-dom/vitest';

import {
  installJsdomPolyfills,
  installTestTimeBudget,
} from '@mattstack/app-kit/test-utils';
import { afterEach } from 'vitest';

import { resetExplainCache } from './src/app/settings/useConsoleSettings';

installJsdomPolyfills();
installTestTimeBudget();

// The settings explain reads are cached per module, so one test's stubbed
// rows would otherwise seed the next test's first render.
afterEach(() => resetExplainCache());

// jsdom ships `window.scrollTo` only as a "not implemented" stub that logs a
// noisy jsdomError. The app's router scrolls to the top on every route
// change (src/app/App.tsx), so any test that navigates would trigger it --
// replace it with a real no-op.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}

// Same story for `Element.prototype.scrollIntoView` -- jsdom has no layout
// engine to scroll, and Spotlight calls it on every selection change.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom has no `document.fonts`; Mantine's autosizing Textarea listens on it
// to re-measure once web fonts load.
if (typeof document !== 'undefined' && !('fonts' in document)) {
  Object.defineProperty(document, 'fonts', {
    value: new EventTarget(),
    configurable: true,
  });
}

// React Flow reads the zoom back from the viewport's CSS transform through
// `DOMMatrixReadOnly`, which jsdom lacks. `ResizeObserver` is the kit's no-op
// polyfill above, and jsdom measures every box as 0x0 anyway, so nodes stay
// unmeasured and edges never draw: canvas tests assert on node content only.
if (typeof window !== 'undefined' && !('DOMMatrixReadOnly' in window)) {
  class DOMMatrixReadOnlyStub {
    readonly m22: number;
    constructor(transform?: string) {
      const scale = /scale\(([\d.]+)\)/.exec(transform ?? '')?.[1];
      this.m22 = scale === undefined ? 1 : Number(scale);
    }
  }
  Object.defineProperty(window, 'DOMMatrixReadOnly', {
    value: DOMMatrixReadOnlyStub,
    configurable: true,
  });
}
