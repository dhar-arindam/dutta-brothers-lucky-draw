export interface MegaPrize {
  position: number;
  name: string;
}

export interface MegaCandidate {
  identity: string;
  sourceClaimId: string;
  sourceClaimTimestamp: string;
  customerName: string;
  maskedPhone: string;
  billNumber: string;
}

export interface MegaDrawSelectedRow {
  prize: MegaPrize;
  candidate: MegaCandidate;
  selectedAt: string;
  candidatePoolCount: number;
  sourceClaimStatus: 'ACTIVE' | 'SOURCE_CLAIM_ARCHIVED';
}

export interface MegaDrawLifecycle {
  reference: string;
  executionYear: number;
  status: 'SETUP' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED';
  selectedRows: MegaDrawSelectedRow[];
  nextPrizeOrdinal: number;
  remainingPrizes: MegaPrize[];
  completedAt?: string;
}

export interface MegaDrawDrawNextResponse {
  status: 'SUCCESS';
  lifecycle: MegaDrawLifecycle;
  selectedRow: MegaDrawSelectedRow;
}

export interface MegaDrawStatusResponse {
  status: 'SUCCESS';
  execution: 'NOT_FOUND' | 'IN_PROGRESS' | 'COMPLETED';
  operation?: 'DRAW_NEXT';
  lifecycle?: MegaDrawLifecycle;
  selectedRow?: MegaDrawSelectedRow;
}

export interface MegaDrawResetResponse {
  status: 'SUCCESS';
  executionYear: number;
}

export interface MegaDrawCloseResponse {
  status: 'SUCCESS';
  lifecycle: MegaDrawLifecycle;
}
