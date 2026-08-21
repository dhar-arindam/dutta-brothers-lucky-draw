// Scenario C: 5,000-draw statistical randomness/weight validation test.
// Before running, this scenario inspects the live campaign status via the existing
// admin campaign endpoint and aborts (without bypassing anything) if the campaign
// is not ACTIVE. There is no participation-count cap anywhere in the application
// (confirmed by inspecting backend/src/campaign.ts and /specs), so 5,000 unique
// synthetic participants are permitted whenever the campaign is active.

import { runWithConcurrency } from '../lib/concurrency-pool.mjs';
import { createHttpClient } from '../lib/http-client.mjs';
import { chiSquareGoodnessOfFit, computeLatencyStats } from '../lib/stats.mjs';
import { createRunId, generateParticipant } from '../lib/synthetic-data.mjs';

export const SCENARIO_NAME = 'randomness-5000';
const DRAW_COUNT = 5000;
const DEFAULT_CONCURRENCY = 15;

const dryRunPrizes = [
  { id: 'prize-001', name: 'Electric Kettle', weight: 1, active: true },
  { id: 'prize-002', name: 'Coffee Maker', weight: 3, active: true },
  { id: 'prize-003', name: 'Mixer Grinder', weight: 6, active: true },
];

const fetchCampaignStatus = async (target, httpClient) => {
  if (target.dryRun) {
    return { status: 'ACTIVE' };
  }

  const response = await fetch(`${target.apiBaseUrl}/api/admin/campaign`);
  const body = await response.json();
  if (!response.ok || body?.status !== 'SUCCESS') {
    throw new Error('Could not read campaign status from /api/admin/campaign.');
  }
  return body.campaign;
};

const fetchPrizeConfig = async (target) => {
  if (target.dryRun) {
    return dryRunPrizes;
  }

  const response = await fetch(`${target.apiBaseUrl}/api/admin/prizes`);
  const body = await response.json();
  if (!response.ok || body?.status !== 'SUCCESS') {
    throw new Error('Could not read prize configuration from /api/admin/prizes.');
  }
  return body.items;
};

export const run = async (target, { runId = createRunId(), concurrency = DEFAULT_CONCURRENCY } = {}) => {
  const httpClient = createHttpClient({ dryRun: target.dryRun, dryRunOptions: { prizes: dryRunPrizes } });

  const campaign = await fetchCampaignStatus(target, httpClient);
  if (campaign.status !== 'ACTIVE') {
    return {
      scenario: SCENARIO_NAME,
      runId,
      blocked: true,
      summary: {
        gate: 'BLOCKED',
        reason: `Campaign status is "${campaign.status}", not ACTIVE. Refusing to run 5,000 draws against a non-active campaign; the application rule was not bypassed.`,
      },
    };
  }

  const prizes = await fetchPrizeConfig(target);
  const eligiblePrizes = prizes.filter((prize) => prize.active && prize.weight > 0);
  if (eligiblePrizes.length === 0) {
    return {
      scenario: SCENARIO_NAME,
      runId,
      blocked: true,
      summary: {
        gate: 'BLOCKED',
        reason: 'No eligible (active, positive-weight) prizes are configured. Refusing to run the randomness test.',
      },
    };
  }

  const totalWeight = eligiblePrizes.reduce((sum, prize) => sum + prize.weight, 0);
  const expectedProbabilities = Object.fromEntries(
    eligiblePrizes.map((prize) => [prize.id, prize.weight / totalWeight]),
  );

  const drawUrl = `${target.apiBaseUrl}/api/draw`;
  const records = [];

  const worker = async (participantIndex) => {
    const participant = generateParticipant(participantIndex, runId);
    const response = await httpClient.postJson(drawUrl, {
      name: participant.name,
      phone: participant.phone,
      billNumber: participant.billNumber,
    });

    const record = {
      index: participantIndex,
      httpStatus: response.httpStatus,
      latencyMs: response.latencyMs,
      success: response.ok && response.httpStatus === 201 && response.body?.status === 'SUCCESS',
      prizeId: response.body?.prize?.id ?? null,
      claimId: response.body?.claimId ?? null,
      error: response.error,
    };
    records.push(record);
    return record;
  };

  await runWithConcurrency(
    Array.from({ length: DRAW_COUNT }, (_unused, index) => index + 1),
    worker,
    concurrency,
  );

  const successfulRecords = records.filter((record) => record.success);
  const observedCounts = {};
  const anomalies = [];

  for (const record of successfulRecords) {
    if (!record.prizeId) {
      continue;
    }
    observedCounts[record.prizeId] = (observedCounts[record.prizeId] ?? 0) + 1;
    if (!expectedProbabilities[record.prizeId]) {
      anomalies.push(`Impossible outcome: claim ${record.claimId} won prize "${record.prizeId}", which is not an active/positive-weight configured prize.`);
    }
  }

  for (const prize of eligiblePrizes) {
    const expectedCount = expectedProbabilities[prize.id] * successfulRecords.length;
    const observedCount = observedCounts[prize.id] ?? 0;
    // A prize with an expected count this high having zero wins is statistically
    // implausible (binomial P(0) is effectively zero) and indicates a real selection defect.
    if (expectedCount >= 20 && observedCount === 0) {
      anomalies.push(`Missing prize: "${prize.id}" (${prize.name}) expected ~${expectedCount.toFixed(0)} wins but received 0.`);
    }
  }

  const goodnessOfFit = chiSquareGoodnessOfFit(observedCounts, expectedProbabilities);

  const table = eligiblePrizes.map((prize) => {
    const observedCount = observedCounts[prize.id] ?? 0;
    const expectedPercent = expectedProbabilities[prize.id] * 100;
    const observedPercent = successfulRecords.length > 0 ? (observedCount / successfulRecords.length) * 100 : 0;
    return {
      prizeId: prize.id,
      prizeName: prize.name,
      configuredWeight: prize.weight,
      expectedPercent,
      observedCount,
      observedPercent,
      variancePercentPoints: observedPercent - expectedPercent,
    };
  });

  const hasImpossibleOrMissing = anomalies.length > 0;
  const finalVerdict = hasImpossibleOrMissing ? 'FAIL' : goodnessOfFit.verdict;

  const latency = computeLatencyStats(records.map((record) => record.latencyMs));

  return {
    scenario: SCENARIO_NAME,
    runId,
    summary: {
      plannedDraws: DRAW_COUNT,
      successfulDraws: successfulRecords.length,
      failedDraws: records.length - successfulRecords.length,
      gate: finalVerdict,
    },
    latency,
    randomness: {
      verdict: finalVerdict,
      statisticalVerdict: goodnessOfFit.verdict,
      statistic: goodnessOfFit.statistic,
      degreesOfFreedom: goodnessOfFit.degreesOfFreedom,
      pValue: goodnessOfFit.pValue,
      table,
      explanation:
        'PASS: p >= 0.05, no statistically significant evidence the observed distribution differs from configured weights. ' +
        'INCONCLUSIVE: 0.01 <= p < 0.05, borderline evidence; consider a larger sample before concluding. ' +
        'FAIL: p < 0.01 (or an impossible/missing-prize anomaly was detected), statistically significant deviation from configured weights.',
    },
    anomalies,
  };
};
