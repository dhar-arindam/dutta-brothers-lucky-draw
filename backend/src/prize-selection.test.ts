import { describe, expect, it } from 'vitest';

import type { Prize } from './domain.js';
import { eligiblePrizes, selectWeightedPrize } from './prize-selection.js';

const prizes: Prize[] = [
  { id: 'p-2', name: 'Two', displayName: 'Two', weight: 2, active: true },
  { id: 'p-1', name: 'One', displayName: 'One', weight: 1, active: true },
  { id: 'p-3', name: 'Three', displayName: 'Three', weight: 3, active: false },
];

describe('prize selection eligibility', () => {
  it('includes only active prizes with positive weight', () => {
    const eligible = eligiblePrizes([
      ...prizes,
      { id: 'p-0', name: 'Zero', displayName: 'Zero', weight: 0, active: true },
    ]);

    expect(eligible.map((prize) => prize.id)).toEqual(['p-2', 'p-1']);
  });

  it('returns null when weights are invalid', () => {
    const result = selectWeightedPrize(
      [{ id: 'bad', name: 'Bad', displayName: 'Bad', weight: Number.NaN, active: true }],
      () => 0.5,
    );

    expect(result).toBeNull();
  });

  it('returns null when no eligible prize exists', () => {
    const result = selectWeightedPrize(
      [{ id: 'inactive', name: 'Inactive', displayName: 'Inactive', weight: 2, active: false }],
      () => 0.4,
    );

    expect(result).toBeNull();
  });
});

describe('weighted selection boundaries', () => {
  it('selects single eligible prize deterministically', () => {
    const result = selectWeightedPrize(
      [{ id: 'single', name: 'Single', displayName: 'Single', weight: 7, active: true }],
      () => 0.99,
    );

    expect(result).not.toBeNull();
    expect(result?.selected.id).toBe('single');
    expect(result?.sectorPrizeIds).toEqual(['single']);
  });

  it('respects relative weights and deterministic boundaries', () => {
    const left = selectWeightedPrize(prizes, () => 0.1);
    const right = selectWeightedPrize(prizes, () => 0.9);

    expect(left?.selected.id).toBe('p-1');
    expect(right?.selected.id).toBe('p-2');
    expect(left?.sectorPrizeIds).toEqual(['p-1', 'p-2']);
  });

  it('falls back to the last eligible prize for boundary-edge random values', () => {
    const result = selectWeightedPrize(
      [
        { id: 'a', name: 'A', displayName: 'A', weight: 1, active: true },
        { id: 'b', name: 'B', displayName: 'B', weight: 1, active: true },
      ],
      () => 1,
    );

    expect(result?.selected.id).toBe('b');
  });
});
