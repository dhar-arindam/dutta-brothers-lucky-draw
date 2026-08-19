export type DrawStatus = 'SUCCESS' | 'ALREADY_CLAIMED';

export type DrawErrorCode =
  'VALIDATION_ERROR' | 'DRAW_ENDED' | 'NO_ELIGIBLE_PRIZE' | 'INTERNAL_ERROR';

export interface DrawRequest {
  name: string;
  phone: string;
  billNumber: string;
}

export interface PrizeView {
  id: string;
  name: string;
  displayName: string;
}

export interface DrawSuccessResponse {
  status: 'SUCCESS';
  claimId: string;
  claimTimestamp: string;
  prize: PrizeView;
  wheel: {
    sectorPrizeIds: string[];
  };
}

export interface AlreadyClaimedResponse {
  status: 'ALREADY_CLAIMED';
  claimId: string;
  claimTimestamp: string;
  prize: PrizeView;
  message: string;
}

export interface DrawErrorResponse {
  status: 'ERROR';
  code: DrawErrorCode;
  message: string;
  fieldErrors?: Partial<Record<'name' | 'phone' | 'billNumber', string>>;
}

export type DrawResponse = DrawSuccessResponse | AlreadyClaimedResponse | DrawErrorResponse;
