import { describe, expect, test } from 'bun:test';

import type { BoardMRWithReview } from '../../types.ts';
import { personRound } from '../RespondGateHeader.tsx';

const mr = (m: object) => m as unknown as BoardMRWithReview;

describe("a respond gate's own response round", () => {
  test("a gate opened during this person's live run reads the run's round", () => {
    const m = mr({
      respond: { person: 'renee', startedAt: 100, responseRound: 3 },
      respondRounds: { renee: 3 },
    });
    expect(personRound(150, 'renee', m)).toBe(3);
  });

  test("another person's live run never lends its round", () => {
    const m = mr({
      respond: { person: 'john', startedAt: 100, responseRound: 3 },
      respondRounds: { john: 3, renee: 1 },
    });
    expect(personRound(50, 'renee', m)).toBe(1);
  });

  test('a gate parked from before the live run reads the recorded count', () => {
    const m = mr({
      respond: { person: 'renee', startedAt: 100, responseRound: 3 },
      respondRounds: { renee: 3 },
    });
    expect(personRound(50, 'renee', m)).toBe(3);
  });

  test('a person with no recorded round has none', () => {
    expect(personRound(50, 'renee', mr({}))).toBeUndefined();
  });
});
