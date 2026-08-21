// Scenario B: controlled ramp-up load test (50 -> 100 -> 250 -> 500 unique users).
// Concurrency is bounded per stage (never an uncontrolled instantaneous burst) and is
// deliberately conservative relative to the staging API Gateway throttle discovered in
// infrastructure/bin/app.ts (rateLimit: 75 req/s, burstLimit: 150 for the staging stage).
// 429s at higher concurrency are expected/attributable to that configured throttle,
// not necessarily an application defect -- this is called out explicitly in the report.
//
// Circuit breaker: after each stage, if that stage's own 5xx rate or timeout rate crosses
// a severe threshold, the ramp stops immediately rather than continuing to escalate load
// against an already-unstable backend.

import { runWithConcurrency } from '../lib/concurrency-pool.mjs';
import { createHttpClient } from '../lib/http-client.mjs';
import { computeLatencyStats } from '../lib/stats.mjs';
import { createRunId, generateParticipant } from '../lib/synthetic-data.mjs';

export const SCENARIO_NAME = 'load-500';
const HARD_MAX_USERS = 500; // no single stage may exceed 500 simulated users, enforced in code
const STAGES = [
  { label: '50-users', count: 50 },
  { label: '100-users', count: 100 },
  { label: '250-users', count: 250 },
  { label: '500-users', count: 500 },
];

const DEFAULT_CONCURRENCY = 20;
const DEFAULT_STAGE_PAUSE_MS = 5000;
const KNOWN_STAGING_THROTTLE = { rateLimitRps: 75, burstLimit: 150 };

// Circuit-breaker thresholds: a stage this unhealthy means continuing to escalate load
// would just generate more failures against an already-struggling backend.
const SEVERE_5XX_RATE = 0.3;
const SEVERE_TIMEOUT_RATE = 0.2;

export const run = async (
  target,
  { runId = createRunId(), concurrency = DEFAULT_CONCURRENCY, stagePauseMs = DEFAULT_STAGE_PAUSE_MS } = {},
) => {
  const peakStageUsers = Math.max(...STAGES.map((stage) => stage.count));
  if (peakStageUsers > HARD_MAX_USERS) {
    throw new Error(`Peak stage (${peakStageUsers} users) exceeds the hard cap of ${HARD_MAX_USERS} simulated users.`);
  }

  const httpClient = createHttpClient({ dryRun: target.dryRun });
  const drawUrl = `${target.apiBaseUrl}/api/draw`;
  const allRecords = [];
  const stageStartLog = [];
  const startedAt = Date.now();
  let participantOffset = 0;
  let stoppedEarly = null;

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

  for (const stage of STAGES) {
    console.log(
      `[performance] load-500: starting stage "${stage.label}" (${stage.count} users, offset ${participantOffset}, concurrency ${concurrency})`,
    );
    stageStartLog.push({ label: stage.label, count: stage.count, offset: participantOffset, startedAtMs: Date.now() - startedAt });

    const stageItems = Array.from({ length: stage.count }, (_unused, index) => participantOffset + index + 1);
    const stageResults = await runWithConcurrency(stageItems, worker, concurrency);
    participantOffset += stage.count;

    const stage5xxRate = stageResults.filter((r) => r.httpStatus !== null && r.httpStatus >= 500).length / stageResults.length;
    const stageTimeoutRate = stageResults.filter((r) => r.timedOut).length / stageResults.length;

    console.log(
      `[performance] load-500: stage "${stage.label}" complete -- 5xx rate ${(stage5xxRate * 100).toFixed(1)}%, timeout rate ${(stageTimeoutRate * 100).toFixed(1)}%`,
    );

    if (stage5xxRate >= SEVERE_5XX_RATE || stageTimeoutRate >= SEVERE_TIMEOUT_RATE) {
      stoppedEarly = {
        atStage: stage.label,
        reason: `Stopped after stage "${stage.label}": 5xx rate ${(stage5xxRate * 100).toFixed(1)}% (threshold ${SEVERE_5XX_RATE * 100}%) / timeout rate ${(stageTimeoutRate * 100).toFixed(1)}% (threshold ${SEVERE_TIMEOUT_RATE * 100}%) indicates severe instability.`,
      };
      console.warn(`[performance] load-500: CIRCUIT BREAKER TRIPPED -- ${stoppedEarly.reason}`);
      break;
    }

    if (stagePauseMs > 0 && stage !== STAGES[STAGES.length - 1]) {
      await new Promise((resolve) => setTimeout(resolve, stagePauseMs));
    }
  }

  const durationMs = Date.now() - startedAt;

  const successCount = allRecords.filter((record) => record.success).length;
  const timeoutCount = allRecords.filter((record) => record.timedOut).length;
  const status4xxCount = allRecords.filter((record) => record.httpStatus !== null && record.httpStatus >= 400 && record.httpStatus < 500).length;
  const status5xxCount = allRecords.filter((record) => record.httpStatus !== null && record.httpStatus >= 500).length;
  const throttledCount = allRecords.filter((record) => record.httpStatus === 429).length;

  const httpStatusDistribution = {};
  for (const record of allRecords) {
    const key = record.httpStatus === null ? 'NO_RESPONSE' : String(record.httpStatus);
    httpStatusDistribution[key] = (httpStatusDistribution[key] ?? 0) + 1;
  }

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
  if (stoppedEarly) {
    anomalies.push(`Circuit breaker stopped the ramp early: ${stoppedEarly.reason}`);
  }

  // No documented latency SLA exists in /specs; classify by stability/errors, not an invented threshold.
  let gate = 'PASS';
  if (stoppedEarly || status5xxCount > 0) {
    gate = 'FAIL';
  } else if (throttledCount > 0 || timeoutCount > 0) {
    gate = 'WARNING';
  }

  return {
    scenario: SCENARIO_NAME,
    runId,
    summary: {
      totalRequests: allRecords.length,
      plannedTotalRequests: STAGES.reduce((sum, stage) => sum + stage.count, 0),
      stoppedEarly: Boolean(stoppedEarly),
      stoppedEarlyReason: stoppedEarly?.reason ?? null,
      successCount,
      failureCount: allRecords.length - successCount,
      successPercent: allRecords.length > 0 ? (successCount / allRecords.length) * 100 : null,
      errorPercent: allRecords.length > 0 ? ((allRecords.length - successCount) / allRecords.length) * 100 : null,
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
    httpStatusDistribution,
    stages: stageStartLog,
    anomalies,
    cloudwatch: {
      correlated: false,
      note: 'CloudWatch correlation is optional/best-effort and not wired up in this implementation (no @aws-sdk/client-cloudwatch dependency present). See final report for details.',
    },
  };
};
