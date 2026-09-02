export type AdminErrorCode =
  'VALIDATION_ERROR' | 'REQUEST_TOO_LARGE' | 'EXPORT_TOO_LARGE' | 'INTERNAL_ERROR';

export interface AdminPrize {
  id: string;
  name: string;
  weight: number;
  active: boolean;
  givenCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface AdminPrizesListResponse {
  status: 'SUCCESS';
  items: AdminPrize[];
}

export interface AdminPrizeItemResponse {
  status: 'SUCCESS';
  item: AdminPrize;
}

export interface AdminClaimItem {
  claimId: string;
  claimTimestamp: string;
  customerName: string;
  maskedPhone: string;
  billNumber: string;
  prize: string;
}

export interface AdminClaimsListResponse {
  status: 'SUCCESS';
  items: AdminClaimItem[];
  nextPageToken: string | null;
}

export interface AdminClaimDeleteResponse {
  status: 'SUCCESS';
}

export interface AdminClaimsClearResponse {
  status: 'SUCCESS';
  deletedCount: number;
}

export interface AdminSummaryDistributionItem {
  prizeId: string;
  prizeName: string;
  givenCount: number;
}

export interface AdminSummaryResponse {
  status: 'SUCCESS';
  totalSuccessfulSpins: number;
  today: {
    date: string;
    successfulSpins: number;
  };
  prizeDistribution: AdminSummaryDistributionItem[];
}

export interface AdminCampaignResponse {
  status: 'SUCCESS';
  campaign: {
    id: string;
    status: 'ACTIVE' | 'ENDED';
    timezone: 'Asia/Kolkata';
    fromDate: string;
    toDate: string;
  };
}

export interface AdminCsvResponse {
  statusCode: 200 | 400 | 413 | 500;
  body: string;
  headers: Record<string, string>;
}

export interface AdminErrorResponse {
  status: 'ERROR';
  code: AdminErrorCode;
  message: string;
  fieldErrors?: Partial<
    Record<
      'name' | 'weight' | 'active' | 'pageSize' | 'from' | 'to' | 'fromDate' | 'toDate',
      string
    >
  >;
}

export type AdminPrizeResponse =
  | AdminPrizesListResponse
  | AdminPrizeItemResponse
  | AdminClaimsListResponse
  | AdminClaimDeleteResponse
  | AdminClaimsClearResponse
  | AdminSummaryResponse
  | AdminCampaignResponse
  | AdminErrorResponse;

export interface AdminHttpResponse {
  statusCode: 200 | 201 | 400 | 413 | 500;
  body: AdminPrizeResponse;
}
export type DrawErrorCode =
  'VALIDATION_ERROR' | 'DRAW_ENDED' | 'NO_ELIGIBLE_PRIZE' | 'REQUEST_TOO_LARGE' | 'INTERNAL_ERROR';

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

export interface DrawHttpResponse {
  statusCode: 200 | 201 | 400 | 409 | 413 | 500;
  body: DrawResponse;
}
