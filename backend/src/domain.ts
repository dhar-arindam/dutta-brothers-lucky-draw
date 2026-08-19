export interface Campaign {
  id: string;
  timezone: 'Asia/Kolkata';
  startAt: string;
  endAt: string;
}

export interface Prize {
  id: string;
  name: string;
  displayName: string;
  weight: number;
  active: boolean;
}

export interface ConfiguredPrize extends Prize {
  createdAt: string;
  updatedAt: string;
}

export interface Claim {
  claimId: string;
  claimTimestamp: string;
  customerName: string;
  phone: string;
  billNumberDisplay: string;
  billNumberNormalized: string;
  prize: {
    id: string;
    name: string;
    displayName: string;
  };
}

export interface AggregatesSnapshot {
  totalSuccessfulSpins: number;
  byDate: Record<string, number>;
  byPrizeId: Record<string, { prizeName: string; successfulSpins: number }>;
}

export interface DrawStoreSnapshot {
  claimCount: number;
  aggregate: AggregatesSnapshot;
}
