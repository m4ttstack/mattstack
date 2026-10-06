import { describe, expect, it } from 'vitest';

import {
  addableFields,
  canDraw,
  extraKeys,
  formShape,
  newEntry,
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
