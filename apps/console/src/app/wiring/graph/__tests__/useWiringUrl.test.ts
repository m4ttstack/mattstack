import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatWiringUrl,
  parseWiringUrl,
  useWiringUrl,
  type WiringUrl,
} from '../useWiringUrl';

const DEFAULTS: WiringUrl = {
  tab: 'graph',
  pack: null,
  focus: null,
  select: null,
  view: null,
  attention: false,
  block: null,
};

const FULL: WiringUrl = {
  tab: 'surface',
  pack: 'acme',
  focus: 'stage-plan',
  select: 'input:include:gate-protocol',
  view: 'rendered',
  attention: true,
  block: 'mini/run',
};

const BOARD_ROUTES: Array<[string, Partial<WiringUrl>]> = [
  ['tab=graph&focus=pipeline:feature', { focus: 'pipeline:feature' }],
  ['tab=graph&focus=stage-plan', { focus: 'stage-plan' }],
  [
    'tab=graph&focus=stage-evidence@accessibility',
    { focus: 'stage-evidence@accessibility' },
  ],
  [
    'tab=graph&focus=pipeline:feature&select=row:1',
    { focus: 'pipeline:feature', select: 'row:1' },
  ],
  [
    'tab=graph&focus=stage-plan&select=row:140',
    { focus: 'stage-plan', select: 'row:140' },
  ],
  [
    'tab=graph&focus=stage-plan&select=input:include:gate-protocol',
    { focus: 'stage-plan', select: 'input:include:gate-protocol' },
  ],
  [
    'tab=graph&focus=stage-plan&select=row:136&view=rendered',
    { focus: 'stage-plan', select: 'row:136', view: 'rendered' },
  ],
];

describe('parseWiringUrl', () => {
  it('returns the defaults for an empty search', () => {
    expect(parseWiringUrl('')).toEqual(DEFAULTS);
    expect(parseWiringUrl('?')).toEqual(DEFAULTS);
  });

  it('reads every field, with or without the leading question mark', () => {
    const search =
      'tab=surface&pack=acme&focus=stage-plan&select=input:include:gate-protocol&view=rendered&attention=1&block=mini/run';
    expect(parseWiringUrl(search)).toEqual(FULL);
    expect(parseWiringUrl(`?${search}`)).toEqual(FULL);
  });

  it('maps the rail badge link ?attention=1 to attention', () => {
    expect(parseWiringUrl('?attention=1')).toEqual({
      ...DEFAULTS,
      attention: true,
    });
  });

  it.each(BOARD_ROUTES)('reads the board route %s', (search, expected) => {
    expect(parseWiringUrl(search)).toEqual({ ...DEFAULTS, ...expected });
  });

  it('falls back to the default for an unknown tab or view', () => {
    expect(
      parseWiringUrl('tab=pipeline&view=raw&rebind=1&attention=0')
    ).toEqual(DEFAULTS);
    expect(parseWiringUrl('tab=ondemand')).toEqual(DEFAULTS);
  });

  it("opens an old link that carries the drawer's tab, ignoring it", () => {
    expect(
      parseWiringUrl('focus=stage-plan&select=output&drawerTab=history')
    ).toEqual({ ...DEFAULTS, focus: 'stage-plan', select: 'output' });
  });

  it('reads an empty pack, focus or select as null', () => {
    expect(parseWiringUrl('pack=&focus=&select=')).toEqual(DEFAULTS);
  });

  it('decodes percent-escapes in values', () => {
    expect(parseWiringUrl('pack=a%20b%26c&focus=x%3Dy')).toEqual({
      ...DEFAULTS,
      pack: 'a b&c',
      focus: 'x=y',
    });
  });
});

describe('formatWiringUrl', () => {
  it('omits every default', () => {
    expect(formatWiringUrl(DEFAULTS)).toBe('');
  });

  it('emits keys in a stable order', () => {
    expect(formatWiringUrl(FULL)).toBe(
      'tab=surface&pack=acme&focus=stage-plan&select=input:include:gate-protocol&view=rendered&attention=1&block=mini/run'
    );
  });

  it('round-trips every field', () => {
    expect(parseWiringUrl(formatWiringUrl(FULL))).toEqual(FULL);
  });

  it('round-trips values that need escaping', () => {
    const state: WiringUrl = {
      ...DEFAULTS,
      pack: 'a b&c=d#e',
      focus: 'pipeline:feature',
      select: 'row:1+2',
    };
    expect(parseWiringUrl(formatWiringUrl(state))).toEqual(state);
  });

  it.each(BOARD_ROUTES)(
    'canonicalises the board route %s',
    (search, expected) => {
      const canonical = formatWiringUrl(parseWiringUrl(search));
      expect(canonical).toBe(search.replace(/^tab=graph&?/, ''));
      expect(parseWiringUrl(canonical)).toEqual({ ...DEFAULTS, ...expected });
    }
  );

  it('omits empty-string values', () => {
    expect(
      formatWiringUrl({ ...DEFAULTS, pack: '', focus: '', select: '' })
    ).toBe('');
  });

  it('is idempotent on its own output', () => {
    const once = formatWiringUrl(parseWiringUrl('block=a&focus=a&tab=health'));
    expect(formatWiringUrl(parseWiringUrl(once))).toBe(once);
  });
});

describe('useWiringUrl', () => {
  let pushState: ReturnType<typeof vi.spyOn>;
  let replaceState: ReturnType<typeof vi.spyOn>;

  const at = (url: string) => window.history.replaceState(null, '', url);

  beforeEach(() => {
    at('/wiring');
    pushState = vi.spyOn(window.history, 'pushState');
    replaceState = vi.spyOn(window.history, 'replaceState');
  });

  afterEach(() => {
    pushState.mockRestore();
    replaceState.mockRestore();
    at('/');
  });

  it('reads the current search', () => {
    at('/wiring?focus=stage-plan&select=row:3');
    const { result } = renderHook(() => useWiringUrl());
    expect(result.current[0]).toEqual({
      ...DEFAULTS,
      focus: 'stage-plan',
      select: 'row:3',
    });
  });

  it('reads ?attention=1', () => {
    at('/wiring?attention=1');
    const { result } = renderHook(() => useWiringUrl());
    expect(result.current[0].attention).toBe(true);
  });

  it('pushes a focus change and clears select and view', () => {
    at('/wiring?focus=pipeline:feature&select=row:1&view=rendered');
    replaceState.mockClear();
    const { result } = renderHook(() => useWiringUrl());

    act(() => result.current[1]({ focus: 'stage-plan' }));

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/wiring');
    expect(window.location.search).toBe('?focus=stage-plan');
    expect(result.current[0]).toEqual({ ...DEFAULTS, focus: 'stage-plan' });
  });

  it('keeps an explicit select that rides along with a focus change', () => {
    at('/wiring?focus=pipeline:feature&select=row:1');
    const { result } = renderHook(() => useWiringUrl());

    act(() => result.current[1]({ focus: 'stage-plan', select: 'row:140' }));

    expect(result.current[0]).toEqual({
      ...DEFAULTS,
      focus: 'stage-plan',
      select: 'row:140',
    });
  });

  it('leaves select alone when the focus patch names the current focus', () => {
    at('/wiring?focus=stage-plan&select=row:1');
    const { result } = renderHook(() => useWiringUrl());

    act(() => result.current[1]({ focus: 'stage-plan' }));

    expect(result.current[0].select).toBe('row:1');
  });

  it("drops an old link's retired drawer and rebind keys on the next patch", () => {
    at('/wiring?focus=a&select=output&drawerTab=history&rebind=1');
    const { result } = renderHook(() => useWiringUrl());

    act(() => result.current[1]({ focus: 'b' }));

    expect(window.location.search).toBe('?focus=b');
  });

  it('pushes a tab change', () => {
    const { result } = renderHook(() => useWiringUrl());

    act(() => result.current[1]({ tab: 'health' }));

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?tab=health');
  });

  it('pushes a pack change', () => {
    const { result } = renderHook(() => useWiringUrl());

    act(() => result.current[1]({ pack: 'globex' }));

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?pack=globex');
  });

  it.each<[string, Partial<WiringUrl>, string]>([
    ['select', { select: 'row:2' }, '?select=row:2'],
    ['view', { view: 'rendered' }, '?view=rendered'],
    ['block', { block: 'mini/run' }, '?block=mini/run'],
  ])('replaces on a %s change', (_name, patch, search) => {
    const { result } = renderHook(() => useWiringUrl());
    replaceState.mockClear();

    act(() => result.current[1](patch));

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.search).toBe(search);
  });

  it('drops a key back to its default out of the URL', () => {
    at('/wiring?focus=stage-plan&select=row:1&view=rendered');
    const { result } = renderHook(() => useWiringUrl());

    act(() => result.current[1]({ select: null, view: null }));

    expect(window.location.search).toBe('?focus=stage-plan');
  });

  it('navigates to the bare path when every key is a default', () => {
    at('/wiring?tab=health');
    const { result } = renderHook(() => useWiringUrl());

    act(() => result.current[1]({ tab: 'graph' }));

    expect(window.location.pathname + window.location.search).toBe('/wiring');
  });

  it('does not navigate for a patch that changes nothing', () => {
    at('/wiring?focus=stage-plan');
    const { result } = renderHook(() => useWiringUrl());
    pushState.mockClear();
    replaceState.mockClear();

    act(() => result.current[1]({ focus: 'stage-plan', select: null }));

    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('keeps query keys it does not own', () => {
    at('/wiring?scenario=unsynced&focus=a');
    const { result } = renderHook(() => useWiringUrl());

    act(() => result.current[1]({ focus: 'b' }));

    expect(window.location.search).toBe('?focus=b&scenario=unsynced');
  });

  it('ignores a key patched to undefined', () => {
    at('/wiring?focus=stage-plan&select=row:1');
    const { result } = renderHook(() => useWiringUrl());

    act(() => result.current[1]({ select: undefined, view: undefined }));

    expect(window.location.search).toBe('?focus=stage-plan&select=row:1');
  });

  it('composes two patches issued in the same tick', () => {
    const { result } = renderHook(() => useWiringUrl());

    act(() => {
      result.current[1]({ focus: 'stage-plan' });
      result.current[1]({ select: 'row:9' });
    });

    expect(result.current[0]).toEqual({
      ...DEFAULTS,
      focus: 'stage-plan',
      select: 'row:9',
    });
  });

  describe('cascade', () => {
    const DEEP =
      '/wiring?pack=acme&focus=stage-plan&select=row:136&view=rendered';

    const patchFrom = (url: string, change: Partial<WiringUrl>) => {
      at(url);
      const { result } = renderHook(() => useWiringUrl());
      pushState.mockClear();
      replaceState.mockClear();
      act(() => result.current[1](change));
      return window.location.search;
    };

    it('a changed select clears view', () => {
      expect(patchFrom(DEEP, { select: 'row:2' })).toBe(
        '?pack=acme&focus=stage-plan&select=row:2'
      );
      expect(replaceState).toHaveBeenCalledTimes(1);
      expect(pushState).not.toHaveBeenCalled();
    });

    it('closing the drawer (select to null) clears view', () => {
      expect(patchFrom(DEEP, { select: null })).toBe(
        '?pack=acme&focus=stage-plan'
      );
    });

    it('the same select clears nothing', () => {
      expect(patchFrom(DEEP, { select: 'row:136' })).toBe(
        '?pack=acme&focus=stage-plan&select=row:136&view=rendered'
      );
      expect(pushState).not.toHaveBeenCalled();
      expect(replaceState).not.toHaveBeenCalled();
    });

    it('a view set with a changed select wins', () => {
      expect(patchFrom(DEEP, { select: 'row:140', view: 'template' })).toBe(
        '?pack=acme&focus=stage-plan&select=row:140&view=template'
      );
    });

    it('a block patch on its own leaves the selection alone', () => {
      expect(
        patchFrom('/wiring?focus=a&select=row:136', { block: 'mini/run' })
      ).toBe('?focus=a&select=row:136&block=mini/run');
    });

    it('a changed focus clears the block', () => {
      expect(patchFrom('/wiring?focus=a&block=mini/run', { focus: 'b' })).toBe(
        '?focus=b'
      );
    });

    it('a changed pack clears the block', () => {
      expect(
        patchFrom('/wiring?pack=acme&focus=a&block=mini/run', {
          pack: 'gadgets',
        })
      ).toBe('?pack=gadgets');
    });

    it('a block set with a changed focus wins', () => {
      expect(
        patchFrom('/wiring?focus=a', { focus: 'mini', block: 'mini/run' })
      ).toBe('?focus=mini&block=mini/run');
    });

    it('a changed focus clears select and view but keeps the pack', () => {
      expect(patchFrom(DEEP, { focus: 'pipeline:feature' })).toBe(
        '?pack=acme&focus=pipeline:feature'
      );
      expect(pushState).toHaveBeenCalledTimes(1);
    });

    it('a select set with a changed focus wins, and view still drops', () => {
      expect(
        patchFrom(DEEP, { focus: 'pipeline:feature', select: 'row:1' })
      ).toBe('?pack=acme&focus=pipeline:feature&select=row:1');
    });

    it('a view set with a changed focus wins', () => {
      expect(
        patchFrom(DEEP, {
          focus: 'pipeline:feature',
          select: 'row:1',
          view: 'template',
        })
      ).toBe('?pack=acme&focus=pipeline:feature&select=row:1&view=template');
    });

    it('a changed pack clears focus and everything below it', () => {
      expect(patchFrom(DEEP, { pack: 'globex' })).toBe('?pack=globex');
      expect(pushState).toHaveBeenCalledTimes(1);
      expect(replaceState).not.toHaveBeenCalled();
    });

    it('a changed pack from the default pack clears focus too', () => {
      expect(
        patchFrom('/wiring?focus=stage-plan&select=row:1', { pack: 'globex' })
      ).toBe('?pack=globex');
    });

    it('the same pack clears nothing', () => {
      expect(patchFrom(DEEP, { pack: 'acme' })).toBe(
        '?pack=acme&focus=stage-plan&select=row:136&view=rendered'
      );
      expect(pushState).not.toHaveBeenCalled();
      expect(replaceState).not.toHaveBeenCalled();
    });

    it('a focus set with a changed pack wins over the drop', () => {
      expect(
        patchFrom(DEEP, { pack: 'globex', focus: 'pipeline:feature' })
      ).toBe('?pack=globex&focus=pipeline:feature');
    });

    it('a focus equal to the current one still drops select under a new pack', () => {
      expect(patchFrom(DEEP, { pack: 'globex', focus: 'stage-plan' })).toBe(
        '?pack=globex&focus=stage-plan'
      );
    });

    it('a whole deep link patches in one call', () => {
      expect(
        patchFrom('/wiring?pack=acme&focus=old&select=row:1', {
          pack: 'globex',
          focus: 'stage-plan',
          select: 'row:136',
          view: 'rendered',
        })
      ).toBe('?pack=globex&focus=stage-plan&select=row:136&view=rendered');
    });

    it('clearing the pack clears focus and everything below it', () => {
      expect(patchFrom(DEEP, { pack: null })).toBe('');
    });

    it('an empty-string focus is not a refocus', () => {
      expect(patchFrom('/wiring?select=row:1', { focus: '' })).toBe(
        '?select=row:1'
      );
      expect(pushState).not.toHaveBeenCalled();
      expect(replaceState).not.toHaveBeenCalled();
    });

    it('an empty-string value is never written to the URL', () => {
      expect(
        patchFrom('/wiring?focus=a', { select: '', pack: '', view: null })
      ).toBe('?focus=a');
      expect(replaceState).not.toHaveBeenCalled();
    });

    it('an empty string clears a value that was set', () => {
      expect(patchFrom('/wiring?focus=a&select=row:1', { select: '' })).toBe(
        '?focus=a'
      );
    });
  });

  it('hands back the same setter on every render', () => {
    const { result, rerender } = renderHook(() => useWiringUrl());
    const first = result.current[1];

    act(() => first({ focus: 'stage-plan' }));
    rerender();

    expect(result.current[1]).toBe(first);
  });
});
