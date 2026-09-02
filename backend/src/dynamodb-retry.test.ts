import { describe, expect, it } from 'vitest';

import { classifyTransactionCancellation, computeBackoffDelayMs } from './dynamodb-retry.js';

const makeTransactionCanceledException = (reasonCodes: Array<string | undefined>): Error => {
  const error = new Error('Transaction cancelled');
  Object.assign(error, {
    name: 'TransactionCanceledException',
    CancellationReasons: reasonCodes.map((code) => (code ? { Code: code } : { Code: 'None' })),
  });
  return error;
};

describe('classifyTransactionCancellation', () => {
  it('classifies a ConditionalCheckFailed on the bill/claim uniqueness positions as DUPLICATE', () => {
    const error = makeTransactionCanceledException([
      'ConditionalCheckFailed',
      'None',
      'None',
      'None',
      'None',
    ]);
    const result = classifyTransactionCancellation(error, [0, 1]);
    expect(result.category).toBe('DUPLICATE');
  });

  it('classifies a ConditionalCheckFailed on the claim-id position as DUPLICATE', () => {
    const error = makeTransactionCanceledException([
      'None',
      'ConditionalCheckFailed',
      'None',
      'None',
      'None',
    ]);
    const result = classifyTransactionCancellation(error, [0, 1]);
    expect(result.category).toBe('DUPLICATE');
  });

  it('classifies TransactionConflict on a shared aggregate item as TRANSIENT, not DUPLICATE', () => {
    const error = makeTransactionCanceledException([
      'None',
      'None',
      'TransactionConflict',
      'None',
      'None',
    ]);
    const result = classifyTransactionCancellation(error, [0, 1]);
    expect(result.category).toBe('TRANSIENT');
    expect(result.reasonCodes).toContain('TransactionConflict');
  });

  it('classifies ProvisionedThroughputExceeded as TRANSIENT', () => {
    const error = makeTransactionCanceledException([
      'None',
      'None',
      'ProvisionedThroughputExceeded',
      'None',
      'None',
    ]);
    expect(classifyTransactionCancellation(error, [0, 1]).category).toBe('TRANSIENT');
  });

  it('classifies ThrottlingError as TRANSIENT', () => {
    const error = makeTransactionCanceledException([
      'None',
      'None',
      'None',
      'ThrottlingError',
      'None',
    ]);
    expect(classifyTransactionCancellation(error, [0, 1]).category).toBe('TRANSIENT');
  });

  it('never misclassifies a duplicate-position failure as transient, even alongside a transient reason elsewhere', () => {
    const error = makeTransactionCanceledException([
      'ConditionalCheckFailed',
      'None',
      'TransactionConflict',
      'None',
      'None',
    ]);
    // Duplicate takes priority: a genuine duplicate must never be retried.
    expect(classifyTransactionCancellation(error, [0, 1]).category).toBe('DUPLICATE');
  });

  it('classifies a ConditionalCheckFailed outside the known duplicate-check positions as PERMANENT (not silently retried, not silently treated as duplicate)', () => {
    const error = makeTransactionCanceledException([
      'None',
      'None',
      'ConditionalCheckFailed',
      'None',
      'None',
    ]);
    expect(classifyTransactionCancellation(error, [0, 1]).category).toBe('PERMANENT');
  });

  it('classifies an unrecognized cancellation reason as PERMANENT', () => {
    const error = makeTransactionCanceledException([
      'None',
      'None',
      'ValidationError',
      'None',
      'None',
    ]);
    expect(classifyTransactionCancellation(error, [0, 1]).category).toBe('PERMANENT');
  });

  it('classifies a non-TransactionCanceledException error as PERMANENT', () => {
    const error = new Error('Network failure');
    const result = classifyTransactionCancellation(error, [0, 1]);
    expect(result.category).toBe('PERMANENT');
    expect(result.errorName).toBe('Error');
  });

  it('classifies a non-Error thrown value as PERMANENT', () => {
    const result = classifyTransactionCancellation('some string', [0, 1]);
    expect(result.category).toBe('PERMANENT');
  });
});

describe('computeBackoffDelayMs', () => {
  it('grows exponentially with attempt number, capped at maxDelayMs', () => {
    const options = { baseDelayMs: 10, maxDelayMs: 1000, random: () => 1 };
    expect(computeBackoffDelayMs(1, options)).toBe(10);
    expect(computeBackoffDelayMs(2, options)).toBe(20);
    expect(computeBackoffDelayMs(3, options)).toBe(40);
    expect(computeBackoffDelayMs(10, options)).toBe(1000); // capped
  });

  it('applies full jitter: delay is always between 0 and the exponential cap', () => {
    const seenDelays = new Set<number>();
    for (const random of [0, 0.25, 0.5, 0.75, 0.999]) {
      seenDelays.add(
        computeBackoffDelayMs(3, { baseDelayMs: 25, maxDelayMs: 400, random: () => random }),
      );
    }
    expect(seenDelays.size).toBeGreaterThan(1);
    for (const delay of seenDelays) {
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(100); // 25 * 2^(3-1) = 100
    }
  });
});
