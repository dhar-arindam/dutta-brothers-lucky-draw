import type {
  AlreadyClaimedResponse,
  DrawErrorResponse,
  DrawHttpResponse,
  DrawRequest,
  DrawSuccessResponse,
} from './contracts.js';
import { isCampaignActive } from './campaign.js';
import { ClaimIdGenerator } from './claim-id.js';
import type { Campaign } from './domain.js';
import { selectWeightedPrize } from './prize-selection.js';
import { InMemoryDrawStore } from './store.js';
import { validateDrawRequest } from './validation.js';

interface DrawDependencies {
  campaign?: Campaign;
  getCampaign?: () => Campaign | { fromDate?: string; toDate?: string };
  claimIdGenerator: ClaimIdGenerator;
  store: InMemoryDrawStore;
  random: () => number;
  now: () => Date;
}

export class DrawService {
  private readonly dependencies: DrawDependencies;

  public constructor(dependencies: DrawDependencies) {
    this.dependencies = dependencies;
  }

  public execute(request: DrawRequest): DrawHttpResponse {
    const validationResult = validateDrawRequest(request);
    if ('fieldErrors' in validationResult) {
      const response: DrawErrorResponse = {
        status: 'ERROR',
        code: 'VALIDATION_ERROR',
        message: validationResult.message,
        fieldErrors: validationResult.fieldErrors,
      };

      return {
        statusCode: 400,
        body: response,
      };
    }

    const now = this.dependencies.now();
    const activeCampaign = this.dependencies.getCampaign
      ? this.dependencies.getCampaign()
      : this.dependencies.campaign;

    if (!activeCampaign || !isCampaignActive(activeCampaign, now)) {
      return {
        statusCode: 409,
        body: {
          status: 'ERROR',
          code: 'DRAW_ENDED',
          message: 'The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter.',
        },
      };
    }

    const selectedPrize = selectWeightedPrize(
      this.dependencies.store.listEligiblePrizesForDraw(),
      this.dependencies.random,
    );

    if (!selectedPrize) {
      return {
        statusCode: 409,
        body: {
          status: 'ERROR',
          code: 'NO_ELIGIBLE_PRIZE',
          message: 'The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter.',
        },
      };
    }

    const claim = {
      claimId: this.dependencies.claimIdGenerator.next(),
      claimTimestamp: now.toISOString(),
      customerName: validationResult.name,
      phone: validationResult.phone,
      billNumberDisplay: validationResult.billNumberDisplay,
      billNumberNormalized: validationResult.billNumberNormalized,
      prize: {
        id: selectedPrize.selected.id,
        name: selectedPrize.selected.name,
        displayName: selectedPrize.selected.displayName,
      },
    };

    const persisted = this.dependencies.store.createClaimAndUpdateAggregatesAtomic({
      claim,
      now,
    });

    if (persisted.type === 'EXISTS') {
      const alreadyClaimed: AlreadyClaimedResponse = {
        status: 'ALREADY_CLAIMED',
        claimId: persisted.claim.claimId,
        claimTimestamp: persisted.claim.claimTimestamp,
        prize: persisted.claim.prize,
        message: 'This bill has already been used for the lucky draw.',
      };

      return {
        statusCode: 200,
        body: alreadyClaimed,
      };
    }

    const success: DrawSuccessResponse = {
      status: 'SUCCESS',
      claimId: persisted.claim.claimId,
      claimTimestamp: persisted.claim.claimTimestamp,
      prize: persisted.claim.prize,
      wheel: {
        sectorPrizeIds: selectedPrize.sectorPrizeIds,
      },
    };

    return {
      statusCode: 201,
      body: success,
    };
  }
}

export const defaultCampaign: Campaign = {
  id: 'festive-2026',
  timezone: 'Asia/Kolkata',
  startAt: '2026-08-01T00:00:00.000Z',
  endAt: '2026-11-01T18:29:59.000Z',
};

export const createDefaultDrawService = (store: InMemoryDrawStore): DrawService => {
  return new DrawService({
    getCampaign: () => store.getCampaign(),
    claimIdGenerator: new ClaimIdGenerator(),
    store,
    random: Math.random,
    now: () => new Date(),
  });
};
