import type { Prize } from './domain.js';

export interface PrizeSelectionResult {
  selected: Prize;
  sectorPrizeIds: string[];
}

export const eligiblePrizes = (prizes: Prize[]): Prize[] => {
  return prizes.filter((prize) => prize.active && prize.weight > 0);
};

export const selectWeightedPrize = (
  prizes: Prize[],
  random: () => number,
): PrizeSelectionResult | null => {
  if (prizes.some((prize) => !Number.isFinite(prize.weight))) {
    return null;
  }

  const eligible = eligiblePrizes(prizes).sort((a, b) => a.id.localeCompare(b.id));
  if (eligible.length === 0) {
    return null;
  }

  const totalWeight = eligible.reduce((sum, prize) => sum + prize.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }

  const target = random() * totalWeight;
  let cumulative = 0;

  for (const prize of eligible) {
    cumulative += prize.weight;
    if (target < cumulative) {
      return {
        selected: prize,
        sectorPrizeIds: eligible.map((entry) => entry.id),
      };
    }
  }

  const fallback = eligible.at(-1);
  if (!fallback) {
    return null;
  }

  return {
    selected: fallback,
    sectorPrizeIds: eligible.map((entry) => entry.id),
  };
};
