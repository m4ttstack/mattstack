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
  drawerTab: 'text',
  view: null,
  rebind: false,
  attention: false,
};

const FULL: WiringUrl = {
  tab: 'surface',
  pack: 'acme',
  focus: 'stage-plan',
  select: 'input:include:gate-protocol',
  drawerTab: 'used-by',
  view: 'rendered',
  rebind: true,
  attention: true,
};

const BOARD_ROUTES: Array<[string, Partial<WiringUrl>]> = [
  ['tab=graph&focus=pipeline:feature', { focus: 'pipeline:feature' }],
  ['tab=graph&focus=stage-plan', { focus: 'stage-plan' }],
  [
    'tab=graph&focus=pipeline:feature&select=row:1',
    { focus: 'pipeline:feature', select: 'row:1' },
  ],
  [
    'tab=graph&focus=stage-plan&select=row:140',
    { focus: 'stage-plan', select: 'row:140' },
  ],
  [
    'tab=graph&focus=stage-plan&select=input:include:gate-protocol&drawerTab=used-by',
    {
      focus: 'stage-plan',
      select: 'input:include:gate-protocol',
      drawerTab: 'used-by',
    },
  ],
  [
    'tab=graph&focus=stage-plan&select=output&drawerTab=history',
    { focus: 'stage-plan', select: 'output', drawerTab: 'history' },
  ],
  [
    'tab=graph&focus=stage-plan&select=row:136&rebind=1',
    { focus: 'stage-plan', select: 'row:136', rebind: true },
  ],
];

describe('parseWiringUrl', () => {
  it('returns the defaults for an empty search', () => {
    expect(parseWiringUrl('')).toEqual(DEFAULTS);
    expect(parseWiringUrl('?')).toEqual(DEFAULTS);
  });

  it('reads every field, with or without the leading question mark', () => {
    const search =
      'tab=surface&pack=acme&focus=stage-plan&select=input:include:gate-protocol&drawerTab=used-by&view=rendered&rebind=1&attention=1';
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

  it('falls back to the default for an unknown tab, drawerTab or view', () => {
    expect(
      parseWiringUrl(
        'tab=pipeline&drawerTab=nope&view=raw&rebind=yes&attention=0'
      )
    ).toEqual(DEFAULTS);
    expect(parseWiringUrl('tab=ondemand')).toEqual(DEFAULTS);
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
      'tab=surface&pack=acme&focus=stage-plan&select=input:include:gate-protocol&drawerTab=used-by&view=rendered&rebind=1&attention=1'
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

  it('is idempotent on its own output', () => {
    const once = formatWiringUrl(parseWiringUrl('rebind=1&focus=a&tab=health'));
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
    at('/wiring?focus=stage-plan&select=row:3&drawerTab=history');
    const { result } = renderHook(() => useWiringUrl());
    expect(result.current[0]).toEqual({
      ...DEFAULTS,
      focus: 'stage-plan',
      select: 'row:3',
      drawerTab: 'history',
    });
  });

  it('reads ?attention=1', () => {
    at('/wiring?attention=1');
    const { result } = renderHook(() => useWiringUrl());
    expect(result.current[0].attention).toBe(true);
  });

  it('pushes a focus change and clears select, rebind and view', () => {
    at('/wiring?focus=pipeline:feature&select=row:1&view=rendered&rebind=1');
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

  it('keeps the drawer tab across a focus change', () => {
    at('/wiring?focus=a&select=output&drawerTab=history');
    const { result } = renderHook(() => useWiringUrl());

    act(() => result.current[1]({ focus: 'b' }));

    expect(result.current[0].drawerTab).toBe('history');
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
    ['drawerTab', { drawerTab: 'history' }, '?drawerTab=history'],
    ['view', { view: 'rendered' }, '?view=rendered'],
    ['rebind', { rebind: true }, '?rebind=1'],
  ])('replaces on a %s change', (_name, patch, search) => {
    const { result } = renderHook(() => useWiringUrl());
    replaceState.mockClear();

    act(() => result.current[1](patch));

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.search).toBe(search);
  });

  it('drops a key back to its default out of the URL', () => {
    at('/wiring?focus=stage-plan&select=row:1&drawerTab=history');
    const { result } = renderHook(() => useWiringUrl());

    act(() => result.current[1]({ select: null, drawerTab: 'text' }));

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

    act(() => result.current[1]({ select: undefined, drawerTab: undefined }));

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

  it('hands back the same setter on every render', () => {
    const { result, rerender } = renderHook(() => useWiringUrl());
    const first = result.current[1];

    act(() => first({ focus: 'stage-plan' }));
    rerender();

    expect(result.current[1]).toBe(first);
  });
});
