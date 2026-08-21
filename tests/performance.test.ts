import { describe, expect, it } from 'vitest';

import { runWithConcurrency } from './performance/lib/concurrency-pool.mjs';
import { chiSquareGoodnessOfFit, computeLatencyStats } from './performance/lib/stats.mjs';
import { generateParticipant, generateParticipants, isSyntheticBillNumber } from './performance/lib/synthetic-data.mjs';
import { resolveTarget, UnsafeTargetError } from './performance/lib/target.mjs';

describe('performance test framework: target safety gate', () => {
  it('resolves a dry-run target without requiring any env vars', () => {
    const target = resolveTarget({ PERFORMANCE_DRY_RUN: 'true' });
    expect(target.dryRun).toBe(true);
    expect(target.apiBaseUrl).toContain('execute-api.ap-south-1.amazonaws.com');
  });

  it('refuses to run when the stack name is not the approved staging stack', () => {
    expect(() =>
      resolveTarget({
        PERFORMANCE_TARGET_STACK_NAME: 'DuttaDrawFoundationStackProd',
        PERFORMANCE_TARGET_API_BASE_URL: 'https://abc123.execute-api.ap-south-1.amazonaws.com',
        PERFORMANCE_TARGET_FRONTEND_URL: 'https://abc123.cloudfront.net',
        PERFORMANCE_CONFIRM: 'RUN_PERFORMANCE_TEST',
      }),
    ).toThrow(UnsafeTargetError);
  });

  it('refuses to run when the API hostname is not an approved staging host', () => {
    expect(() =>
      resolveTarget({
        PERFORMANCE_TARGET_STACK_NAME: 'DuttaDrawFoundationStackStaging',
        PERFORMANCE_TARGET_API_BASE_URL: 'https://evil.example.com',
        PERFORMANCE_TARGET_FRONTEND_URL: 'https://abc123.cloudfront.net',
        PERFORMANCE_CONFIRM: 'RUN_PERFORMANCE_TEST',
      }),
    ).toThrow(UnsafeTargetError);
  });

  it('refuses to run without the exact required confirmation phrase', () => {
    expect(() =>
      resolveTarget({
        PERFORMANCE_TARGET_STACK_NAME: 'DuttaDrawFoundationStackStaging',
        PERFORMANCE_TARGET_API_BASE_URL: 'https://abc123.execute-api.ap-south-1.amazonaws.com',
        PERFORMANCE_TARGET_FRONTEND_URL: 'https://abc123.cloudfront.net',
        PERFORMANCE_CONFIRM: 'yes please',
      }),
    ).toThrow(UnsafeTargetError);
  });

  it('accepts a fully valid, explicitly confirmed staging target', () => {
    const target = resolveTarget({
      PERFORMANCE_TARGET_STACK_NAME: 'DuttaDrawFoundationStackStaging',
      PERFORMANCE_TARGET_API_BASE_URL: 'https://abc123.execute-api.ap-south-1.amazonaws.com/',
      PERFORMANCE_TARGET_FRONTEND_URL: 'https://abc123.cloudfront.net/',
      PERFORMANCE_CONFIRM: 'RUN_PERFORMANCE_TEST',
    });

    expect(target.dryRun).toBe(false);
    expect(target.apiBaseUrl).toBe('https://abc123.execute-api.ap-south-1.amazonaws.com');
    expect(target.frontendUrl).toBe('https://abc123.cloudfront.net');
  });
});

describe('performance test framework: synthetic data generation', () => {
  it('generates unique, validator-compliant participants', () => {
    const participants = generateParticipants(200, 'TESTRUN');
    const names = new Set(participants.map((participant) => participant.name));
    const phones = new Set(participants.map((participant) => participant.phone));
    const bills = new Set(participants.map((participant) => participant.billNumber));

    expect(names.size).toBe(200);
    expect(phones.size).toBe(200);
    expect(bills.size).toBe(200);

    for (const participant of participants) {
      expect(participant.name).toMatch(/^[\p{L} .'-]+$/u);
      expect(participant.phone).toMatch(/^\d{10}$/);
      expect(participant.billNumber).toMatch(/^[A-Za-z0-9./-]+$/);
      expect(isSyntheticBillNumber(participant.billNumber)).toBe(true);
    }
  });

  it('produces different bill numbers for the same index across different run IDs', () => {
    const first = generateParticipant(1, 'RUN-A');
    const second = generateParticipant(1, 'RUN-B');
    expect(first.billNumber).not.toBe(second.billNumber);
  });
});

describe('performance test framework: latency stats', () => {
  it('computes percentile stats over a known distribution', () => {
    const latencies = Array.from({ length: 100 }, (_, index) => index + 1);
    const stats = computeLatencyStats(latencies);

    expect(stats.count).toBe(100);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(100);
    expect(stats.p50).toBeCloseTo(50.5, 1);
    expect(stats.p99).toBeGreaterThan(stats.p95);
    expect(stats.p95).toBeGreaterThan(stats.p90);
  });

  it('handles an empty latency list without throwing', () => {
    const stats = computeLatencyStats([]);
    expect(stats.count).toBe(0);
    expect(stats.p50).toBeNull();
  });
});

describe('performance test framework: chi-square goodness of fit', () => {
  it('reports PASS when observed counts closely match configured weights', () => {
    // weights 1:3:6 over 10,000 draws -> expected 1000/3000/6000
    const result = chiSquareGoodnessOfFit(
      { 'prize-001': 1005, 'prize-002': 2990, 'prize-003': 6005 },
      { 'prize-001': 0.1, 'prize-002': 0.3, 'prize-003': 0.6 },
    );

    expect(result.verdict).toBe('PASS');
    expect(result.pValue).toBeGreaterThanOrEqual(0.05);
  });

  it('reports FAIL when observed counts are grossly skewed from configured weights', () => {
    const result = chiSquareGoodnessOfFit(
      { 'prize-001': 9000, 'prize-002': 500, 'prize-003': 500 },
      { 'prize-001': 0.1, 'prize-002': 0.3, 'prize-003': 0.6 },
    );

    expect(result.verdict).toBe('FAIL');
    expect(result.pValue).toBeLessThan(0.01);
  });

  it('flags a hard-coded/single-prize outcome as a statistical failure', () => {
    const result = chiSquareGoodnessOfFit(
      { 'prize-001': 0, 'prize-002': 0, 'prize-003': 10000 },
      { 'prize-001': 0.1, 'prize-002': 0.3, 'prize-003': 0.6 },
    );

    expect(result.verdict).toBe('FAIL');
  });
});

describe('performance test framework: bounded concurrency pool', () => {
  it('never exceeds the configured concurrency limit', async () => {
    let inFlight = 0;
    let maxObservedConcurrency = 0;

    const worker = async () => {
      inFlight += 1;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    };

    await runWithConcurrency(Array.from({ length: 40 }, (_unused, index) => index), worker, 5);

    expect(maxObservedConcurrency).toBeLessThanOrEqual(5);
  });

  it('processes every item exactly once', async () => {
    const processed = [];
    await runWithConcurrency(
      Array.from({ length: 25 }, (_unused, index) => index),
      async (item) => {
        processed.push(item);
      },
      7,
    );

    expect(processed.sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_unused, index) => index));
  });
});
