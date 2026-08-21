// Scenario B: controlled ramp-up load test (50 -> 100 -> 250 -> 500 unique users).
// Concurrency is bounded per stage (never an uncontrolled instantaneous burst) and is
// deliberately conservative relative to the staging API Gateway throttle discovered in
// infrastructure/bin/app.ts (rateLimit: 75 req/s, burstLimit: 150 for the staging stage).
// 429s at higher concurrency are expected/attributable to that configured throttle,
// not necessarily an application defect -- this is called out explicitly in the report.

import { runStagedRamp } from '../lib/concurrency-pool.mjs';
import { createHttpClient } from '../lib/http-client.mjs';
import { computeLatencyStats } from '../lib/stats.mjs';
import { createRunId, generateParticipant } from '../lib/synthetic-data.mjs';

export const SCENARIO_NAME = 'load-500';
const HARD_MAX_USERS = 500; // never exceed 500 simulated users, enforced in code
// The originally suggested stage sizes (50, 100, 250, 500) sum to 900 total participants,
// which conflicts with the explicit hard cap of 500 total simulated users. The hard limit
// takes priority: stages are scaled down (same increasing-ramp shape, cumulative total = 500).
const STAGES = [
  { label: '50-users', count: 50 },
  { label: '100-users', count: 100 },
  { label: '150-users', count: 150 },
  { label: '200-users', count: 200 },
];

const DEFAULT_CONCURRENCY = 20;
const DEFAULT_STAGE_PAUSE_MS = 5000;
const KNOWN_STAGING_THROTTLE = { rateLimitRps: 75, burstLimit: 150 };

export const run = async (
  target,
  { runId = createRunId(), concurrency = DEFAULT_CONCURRENCY, stagePauseMs = DEFAULT_STAGE_PAUSE_MS } = {},
) => {
  const totalPlanned = STAGES.reduce((sum, stage) => sum + stage.count, 0);
  if (totalPlanned > HARD_MAX_USERS) {
    throw new Error(`Planned load (${totalPlanned}) exceeds the hard cap of ${HARD_MAX_USERS} simulated users.`);
  }

  const httpClient = createHttpClient({ dryRun: target.dryRun });
  const drawUrl = `${target.apiBaseUrl}/api/draw`;
  const allRecords = [];

  const worker = async (participantIndex) => {
    const participant = generateParticipant(participantIndex, runId);
    const response = await httpClient.postJson(drawUrl, {
      name: participant.name,
      phone: participant.phone,
      billNumber: participant.billNumber,
    });

    const record = {
      index: participantIndex,
      billNumber: participant.billNumber,
      httpStatus: response.httpStatus,
      latencyMs: response.latencyMs,
      success: response.ok && response.httpStatus === 201 && response.body?.status === 'SUCCESS',
      timedOut: response.timedOut,
      error: response.error,
    };
    allRecords.push(record);
    return record;
  };

  const stageStartLog = [];
  const startedAt = Date.now();

  await runStagedRamp(STAGES.map((stage) => ({ ...stage, concurrency })), worker, {
    onStageStart: (stage, offset) => {
      console.log(`[performance] load-500: starting stage "${stage.label}" (${stage.count} users, offset ${offset}, concurrency ${concurrency})`);
      stageStartLog.push({ label: stage.label, count: stage.count, offset, startedAtMs: Date.now() - startedAt });
    },
    pauseBetweenStagesMs: stagePauseMs,
  });

  const durationMs = Date.now() - startedAt;

  const successCount = allRecords.filter((record) => record.success).length;
  const timeoutCount = allRecords.filter((record) => record.timedOut).length;
  const status4xxCount = allRecords.filter((record) => record.httpStatus !== null && record.httpStatus >= 400 && record.httpStatus < 500).length;
  const status5xxCount = allRecords.filter((record) => record.httpStatus !== null && record.httpStatus >= 500).length;
  const throttledCount = allRecords.filter((record) => record.httpStatus === 429).length;

  const latency = computeLatencyStats(allRecords.map((record) => record.latencyMs));
  const requestsPerSecond = durationMs > 0 ? (allRecords.length / durationMs) * 1000 : null;

  const anomalies = [];
  if (status5xxCount > 0) {
    anomalies.push(`${status5xxCount} request(s) returned a 5xx error.`);
  }
  if (throttledCount > 0) {
    anomalies.push(
      `${throttledCount} request(s) were throttled (429). This is expected once demand exceeds the configured staging API Gateway throttle (${KNOWN_STAGING_THROTTLE.rateLimitRps} rps / ${KNOWN_STAGING_THROTTLE.burstLimit} burst) and is attributable to that configuration, not necessarily an application defect.`,
    );
  }

  // No documented latency SLA exists in /specs; classify by stability/errors, not an invented threshold.
  let gate = 'PASS';
  if (status5xxCount > 0) {
    gate = 'FAIL';
  } else if (throttledCount > 0 || timeoutCount > 0) {
    gate = 'WARNING';
  }

  return {
    scenario: SCENARIO_NAME,
    runId,
    summary: {
      totalRequests: allRecords.length,
      successCount,
      failureCount: allRecords.length - successCount,
      successPercent: (successCount / allRecords.length) * 100,
      errorPercent: ((allRecords.length - successCount) / allRecords.length) * 100,
      requestsPerSecond,
      timeoutCount,
      status4xxCount,
      status5xxCount,
      throttledCount,
      durationMs,
      concurrencyUsed: concurrency,
      knownStagingThrottle: KNOWN_STAGING_THROTTLE,
      gate,
    },
    latency,
    stages: stageStartLog,
    anomalies,
    cloudwatch: {
      correlated: false,
      note: 'CloudWatch correlation is optional/best-effort and not wired up in this implementation (no @aws-sdk/client-cloudwatch dependency present). See final report for details.',
    },
  };
};
