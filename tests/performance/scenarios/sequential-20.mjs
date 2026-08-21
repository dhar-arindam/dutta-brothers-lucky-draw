// Scenario A: 20 sequential unique users, one valid draw each.
// Acceptance: 20/20 successful, no unexpected 4xx/5xx, valid prize + claim ID,
// no duplicate-participation failures, no unexpected API errors.

import { createHttpClient } from '../lib/http-client.mjs';
import { computeLatencyStats } from '../lib/stats.mjs';
import { createRunId, generateParticipants } from '../lib/synthetic-data.mjs';

export const SCENARIO_NAME = 'sequential-20';
const PARTICIPANT_COUNT = 20;

export const run = async (target, { runId = createRunId() } = {}) => {
  const httpClient = createHttpClient({ dryRun: target.dryRun });
  const participants = generateParticipants(PARTICIPANT_COUNT, runId);
  const drawUrl = `${target.apiBaseUrl}/api/draw`;

  const records = [];
  for (const participant of participants) {
    const response = await httpClient.postJson(drawUrl, {
      name: participant.name,
      phone: participant.phone,
      billNumber: participant.billNumber,
    });

    const isSuccess = response.ok && response.httpStatus === 201 && response.body?.status === 'SUCCESS';

    records.push({
      index: participant.index,
      billNumber: participant.billNumber,
      httpStatus: response.httpStatus,
      latencyMs: response.latencyMs,
      success: isSuccess,
      prize: response.body?.prize ?? null,
      claimId: response.body?.claimId ?? null,
      responseStatus: response.body?.status ?? null,
      error: response.error,
    });
  }

  const successCount = records.filter((record) => record.success).length;
  const unexpectedStatuses = records.filter(
    (record) => record.httpStatus !== null && (record.httpStatus >= 400 || record.responseStatus === 'ALREADY_CLAIMED'),
  );
  const latency = computeLatencyStats(records.map((record) => record.latencyMs));

  const gateResult = successCount === PARTICIPANT_COUNT && unexpectedStatuses.length === 0 ? 'PASS' : 'FAIL';

  return {
    scenario: SCENARIO_NAME,
    runId,
    summary: {
      participantCount: PARTICIPANT_COUNT,
      successCount,
      failureCount: PARTICIPANT_COUNT - successCount,
      unexpectedStatusCount: unexpectedStatuses.length,
      gate: gateResult,
    },
    latency,
    records,
    anomalies: unexpectedStatuses.map(
      (record) => `Participant #${record.index} (bill ${record.billNumber}) returned unexpected status ${record.httpStatus}/${record.responseStatus}.`,
    ),
  };
};
