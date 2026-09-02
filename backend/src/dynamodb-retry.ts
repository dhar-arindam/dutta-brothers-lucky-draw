// Classifies DynamoDB TransactWriteCommand failures and computes retry backoff.
// Kept separate from durable-dynamodb-store.ts so the pure logic (no AWS calls,
// no I/O) can be unit tested directly and deterministically.

export type TransactionFailureCategory = 'DUPLICATE' | 'TRANSIENT' | 'PERMANENT';

export interface TransactionCancellationReason {
  Code?: string;
  Message?: string;
}

export interface ClassifiedTransactionFailure {
  category: TransactionFailureCategory;
  reasonCodes: string[];
  errorName: string;
}

// Cancellation reason codes that indicate the transaction failed due to genuine
// write contention (another concurrent transaction touching the same item) or
// transient capacity pressure -- both are safe to retry without risking a
// duplicate claim, since the whole transaction (including the bill/claim
// uniqueness conditions) is retried atomically as a unit.
const TRANSIENT_REASON_CODES = new Set([
  'TransactionConflict',
  'ThrottlingError',
  'ProvisionedThroughputExceeded',
]);

// Reason codes that indicate a genuine business-rule condition failed
// (the bill number or claim ID already exists) -- must never be retried,
// since retrying would just fail identically forever.
const DUPLICATE_REASON_CODES = new Set(['ConditionalCheckFailed']);

const isTransactionCanceledException = (
  error: unknown,
): error is { name: string; CancellationReasons?: TransactionCancellationReason[] } => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'TransactionCanceledException'
  );
};

// `duplicateCheckIndexes` identifies which TransactItems positions carry the
// bill/claim-uniqueness conditions, so a ConditionalCheckFailed on the shared
// aggregate items (which never carries that condition) is never misread as a duplicate.
export const classifyTransactionCancellation = (
  error: unknown,
  duplicateCheckIndexes: number[],
): ClassifiedTransactionFailure => {
  const errorName = error instanceof Error ? error.name : typeof error;

  if (!isTransactionCanceledException(error)) {
    return { category: 'PERMANENT', reasonCodes: [], errorName };
  }

  const reasons = error.CancellationReasons ?? [];
  const reasonCodes = reasons
    .map((reason) => reason.Code ?? 'None')
    .filter((code) => code !== 'None');

  const hasDuplicateConflict = duplicateCheckIndexes.some(
    (index) => reasons[index]?.Code === 'ConditionalCheckFailed',
  );
  if (hasDuplicateConflict) {
    return { category: 'DUPLICATE', reasonCodes, errorName };
  }

  const hasKnownDuplicateCodeElsewhere = reasonCodes.some((code) =>
    DUPLICATE_REASON_CODES.has(code),
  );
  if (hasKnownDuplicateCodeElsewhere && !hasDuplicateConflict) {
    // A ConditionalCheckFailed outside the known duplicate-check positions is unexpected;
    // treat conservatively as permanent rather than silently reclassifying it.
    return { category: 'PERMANENT', reasonCodes, errorName };
  }

  const hasTransientReason = reasonCodes.some((code) => TRANSIENT_REASON_CODES.has(code));
  if (hasTransientReason) {
    return { category: 'TRANSIENT', reasonCodes, errorName };
  }

  return { category: 'PERMANENT', reasonCodes, errorName };
};

export interface BackoffOptions {
  baseDelayMs: number;
  maxDelayMs: number;
  random?: () => number;
}

// Full-jitter bounded exponential backoff: delay = random(0, min(maxDelayMs, baseDelayMs * 2^(attempt-1))).
export const computeBackoffDelayMs = (attempt: number, options: BackoffOptions): number => {
  const random = options.random ?? Math.random;
  const exponential = options.baseDelayMs * 2 ** (attempt - 1);
  const cap = Math.min(options.maxDelayMs, exponential);
  return Math.floor(random() * cap);
};
