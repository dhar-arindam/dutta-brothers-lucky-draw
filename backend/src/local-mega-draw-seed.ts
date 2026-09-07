import { campaignYearInKolkata } from './campaign.js';
import type { Claim, Prize } from './domain.js';
import { MegaDrawService } from './mega-draw.js';
import { resolveRuntimeMode } from './runtime-mode.js';
import { InMemoryDrawStore } from './store.js';

const megaPrizeNames = ['Grand Television', 'Premium Mixer', 'Shopping Voucher'];

const localMainPrizes: Prize[] = [
  {
    id: 'prize-001',
    name: 'Electric Kettle',
    displayName: 'Electric Kettle',
    weight: 1,
    active: true,
  },
  { id: 'prize-002', name: 'Coffee Maker', displayName: 'Coffee Maker', weight: 3, active: true },
  { id: 'prize-003', name: 'Mixer Grinder', displayName: 'Mixer Grinder', weight: 6, active: true },
];

export const isLocalMegaDrawSeedEnabled = (value = process.env.LOCAL_MEGA_DRAW_SEED): boolean =>
  value === '1';

export const createLocalMegaDrawSeed = (
  now = new Date(),
): {
  store: InMemoryDrawStore;
  megaDraw: MegaDrawService;
} => {
  if (resolveRuntimeMode() !== 'LOCAL') {
    throw new Error('Mega Draw local seed requires APP_RUNTIME=LOCAL.');
  }

  const year = campaignYearInKolkata(now);
  const claims = Array.from({ length: 12 }, (_, index): Claim => {
    const prize = localMainPrizes[index % localMainPrizes.length];
    if (!prize) {
      throw new Error('Local Mega Draw seed requires main prizes.');
    }
    const sequence = (index + 1).toString().padStart(6, '0');
    const day = (index + 1).toString().padStart(2, '0');
    return {
      claimId: `DB${year.toString().slice(-2)}-${sequence}`,
      claimTimestamp: `${year}-01-${day}T10:00:00.000Z`,
      customerName: `Mega Draw Customer ${index + 1}`,
      phone: `900000${(1000 + index).toString().slice(-4)}`,
      billNumberDisplay: `MEGA-${year}-${sequence}`,
      billNumberNormalized: `MEGA-${year}-${sequence}`,
      prize: { id: prize.id, name: prize.name, displayName: prize.displayName },
    };
  });

  const store = new InMemoryDrawStore({
    initialPrizes: localMainPrizes,
    initialClaims: claims,
    initialCampaign: {
      id: `festive-${year}`,
      timezone: 'Asia/Kolkata',
      fromDate: `${year}-01-01`,
      toDate: `${year}-01-31`,
    },
    now: () => now,
  });
  const megaDraw = new MegaDrawService(store, () => now);
  megaDraw.configure(megaPrizeNames);

  return { store, megaDraw };
};
