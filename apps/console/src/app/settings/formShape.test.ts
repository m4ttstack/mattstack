import { describe, expect, it } from 'vitest';

import {
  addableFields,
  branchSeed,
  canDraw,
  extraKeys,
  formShape,
  newEntry,
  slugOf,
  visibleFields,
} from './formShape';
import { layerOf, TEST_SCHEMAS } from './testSchemas';

describe('formShape', () => {
  it('a list of flat objects is an objectList with its required names', () => {
    const s = formShape(TEST_SCHEMAS['rt.notify.eventBridges'])!;
    expect(s.kind).toBe('objectList');
    expect(Object.keys(s.fields)).toEqual([
      'pattern',
      'category',
      'title',
      'message',
      'subjectPrefix',
      'url',
      'owner',
      'surface',
    ]);
    expect(s.required).toEqual(['pattern', 'category', 'title', 'message']);
    expect(s.fields.owner!.type).toEqual({ enum: ['human'] });
    expect(s.nested).toEqual([]);
  });

  it('a map of objects with a nested optional property draws it read-only', () => {
    const s = formShape(layerOf(TEST_SCHEMAS['deck.apps']!))!;
    expect(s.kind).toBe('objectMap');
    expect(s.nested).toEqual(['override']);
    expect(s.required).toEqual([]);
    expect(s.labels).toEqual(['name', 'value']);
  });

  it('a map keeps its schema labels', () => {
    expect(formShape(TEST_SCHEMAS['gitq.forges'])!.labels).toEqual([
      'host',
      'forge',
    ]);
  });

  it('a required nested property, or no scalar property at all, is JSON only', () => {
    expect(formShape(TEST_SCHEMAS['rt.intercepts'])).toBeNull();
    expect(
      formShape({
        type: 'array',
        items: {
          type: 'object',
          properties: { tags: { type: 'array', items: { type: 'string' } } },
        },
      })
    ).toBeNull();
    expect(formShape(TEST_SCHEMAS['board.ticketPrefixes'])).toBeNull();
    expect(formShape(undefined)).toBeNull();
  });
});

describe('entries', () => {
  const s = formShape(TEST_SCHEMAS['rt.notify.eventBridges'])!;

  it('shows required fields, set optional fields and fields the user added', () => {
    expect(visibleFields(s, { pattern: 'x', url: 'u' }, [])).toEqual([
      'pattern',
      'category',
      'title',
      'message',
      'url',
    ]);
    expect(visibleFields(s, {}, ['surface'])).toContain('surface');
  });

  it('offers only optional fields not already shown', () => {
    expect(addableFields(s, { url: 'u' }, ['owner'])).toEqual([
      'subjectPrefix',
      'surface',
    ]);
  });

  it('extra keys are anything the form does not draw', () => {
    expect(extraKeys(s, { pattern: 'x', legacy: 1 })).toEqual(['legacy']);
  });

  it('a new entry takes schema defaults and seeds a required switch off', () => {
    expect(newEntry(s)).toEqual({});
    expect(
      newEntry({
        kind: 'objectList',
        fields: {
          on: { type: 'boolean' },
          mode: { type: { enum: ['a', 'b'] }, default: 'b' },
        },
        unions: {},
        order: ['on', 'mode'],
        nested: [],
        required: ['on', 'mode'],
        labels: ['name', 'value'],
      })
    ).toEqual({ on: false, mode: 'b' });
  });

  it('canDraw needs objects where the form expects them', () => {
    expect(canDraw(s, [{ pattern: 'x' }])).toBe(true);
    expect(canDraw(s, [1])).toBe(false);
    expect(canDraw(s, { a: {} })).toBe(false);
    const map = formShape(TEST_SCHEMAS['gitq.forges'])!;
    expect(canDraw(map, { 'gitlab.example.com': { provider: 'gitlab' } })).toBe(
      true
    );
    expect(canDraw(map, { 'gitlab.example.com': 'gitlab' })).toBe(false);
  });
});

describe('tagged unions', () => {
  const tabs = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1 },
        source: {
          title: 'Shows',
          oneOf: [
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'authors' } },
              required: ['kind'],
            },
            {
              type: 'object',
              properties: {
                kind: { type: 'string', const: 'codeowners' },
                section: { type: 'string', minLength: 1 },
                excludeMembers: { type: 'boolean' },
              },
              required: ['kind', 'section'],
            },
          ],
        },
        note: { type: 'string' },
      },
      required: ['id', 'source'],
    },
  };

  it('draws a tagged oneOf as a union in schema order, not a nested property', () => {
    const shape = formShape(tabs)!;
    expect(shape.order).toEqual(['id', 'source', 'note']);
    expect(shape.nested).toEqual([]);
    expect(shape.unions.source).toEqual({
      title: 'Shows',
      tag: 'kind',
      branches: [
        { value: 'authors', fields: {}, required: [] },
        {
          value: 'codeowners',
          fields: {
            section: { type: 'string' },
            excludeMembers: { type: 'boolean' },
          },
          required: ['section'],
        },
      ],
    });
  });

  it('a new entry starts on the first branch', () => {
    expect(newEntry(formShape(tabs)!)).toEqual({ source: { kind: 'authors' } });
  });

  it('draws only entries whose tag names a branch', () => {
    const shape = formShape(tabs)!;
    expect(
      canDraw(shape, [
        { id: 'a', source: { kind: 'codeowners', section: 'Web' } },
      ])
    ).toBe(true);
    expect(canDraw(shape, [{ id: 'a', source: { kind: 'other' } }])).toBe(
      false
    );
  });

  it('a union never reads as an extra key', () => {
    expect(
      extraKeys(formShape(tabs)!, { id: 'a', source: { kind: 'authors' } })
    ).toEqual([]);
  });
});

describe('field annotations', () => {
  const schema = {
    type: 'array',
    minItems: 1,
    uniqueBy: 'id',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', slugFrom: 'label' },
        label: { type: 'string' },
        channel: { type: 'string', inherits: 'board.slack.channel' },
        source: {
          oneOf: [
            {
              type: 'object',
              properties: {
                kind: {
                  type: 'string',
                  const: 'codeowners',
                  title: 'CODEOWNERS section',
                },
                section: { type: 'string', suggest: 'codeowners-sections' },
                hide: { type: 'boolean', default: true },
              },
              required: ['kind', 'section'],
            },
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'authors' } },
              required: ['kind'],
            },
          ],
        },
        extra: {
          oneOf: [
            {
              type: 'object',
              properties: { t: { const: 'a' } },
              required: ['t'],
            },
            {
              type: 'object',
              properties: { t: { const: 'b' } },
              required: ['t'],
            },
          ],
        },
      },
      required: ['id', 'label', 'source'],
    },
  };

  it('reads slugFrom, inherits, suggest, list floor and uniqueBy', () => {
    const shape = formShape(schema)!;
    expect(shape.fields.id!.slugFrom).toBe('label');
    expect(shape.fields.channel!.inherits).toBe('board.slack.channel');
    expect(shape.unions.source!.branches[0]!.fields.section!.suggest).toBe(
      'codeowners-sections'
    );
    expect(shape.unions.source!.branches[0]!.title).toBe('CODEOWNERS section');
    expect(shape.minItems).toBe(1);
    expect(shape.uniqueBy).toBe('id');
  });

  it('a branch starts with its tag and its declared defaults', () => {
    const u = formShape(schema)!.unions.source!;
    expect(branchSeed(u, u.branches[0]!)).toEqual({
      kind: 'codeowners',
      hide: true,
    });
    expect(newEntry(formShape(schema)!)).toEqual({
      source: { kind: 'codeowners', hide: true },
    });
  });

  it('offers an optional union under Add property', () => {
    expect(addableFields(formShape(schema)!, {}, [])).toEqual([
      'channel',
      'extra',
    ]);
  });

  it('draws a list whose items hold only a union', () => {
    const only = {
      type: 'array',
      items: {
        type: 'object',
        properties: { source: schema.items.properties.source },
      },
    };
    expect(formShape(only)?.order).toEqual(['source']);
  });

  it('slugs free text and keeps it unique', () => {
    expect(slugOf('Web Reviews!', [])).toBe('web-reviews');
    expect(slugOf('Web', ['web', 'web-2'])).toBe('web-3');
    expect(slugOf('!!!', [])).toBe('item');
  });
});
