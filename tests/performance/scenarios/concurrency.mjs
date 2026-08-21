// Scenario D: duplicate-participation and concurrency protection test.
//
// Scenario 1: many concurrent requests using the SAME participant/bill -> expect
// exactly one successful (201 SUCCESS) claim; all others must be rejected per the
// application's existing business rule (200 ALREADY_CLAIMED), never a second claim.
//
// Scenario 2: many concurrent requests using UNIQUE participants -> expect all to
// be processed independently with no unexpected duplicate rejection.

import { createHttpClient } from '../lib/http-client.mjs';
import { createRunId, generateParticipant, generateParticipants } from '../lib/synthetic-data.mjs';

export const SCENARIO_NAME = 'concurrency';
const SAME_PARTICIPANT_CONCURRENCY = 10;
const UNIQUE_PARTICIPANT_CONCURRENCY = 10;

const submitDraw = async (httpClient, drawUrl, participant) => {
  const response = await httpClient.postJson(drawUrl, {
    name: participant.name,
    phone: participant.phone,
    billNumber: participant.billNumber,
  });

  return {
    billNumber: participant.billNumber,
    httpStatus: response.httpStatus,
    latencyMs: response.latencyMs,
    responseStatus: response.body?.status ?? null,
    claimId: response.body?.claimId ?? null,
    error: response.error,
  };
};

export const run = async (target, { runId = createRunId() } = {}) => {
  const httpClient = createHttpClient({ dryRun: target.dryRun });
  const drawUrl = `${target.apiBaseUrl}/api/draw`;

  // Scenario 1: identical participant submitted concurrently.
  const sameParticipant = generateParticipant(1, `${runId}-DUP`);
  const sameParticipantResults = await Promise.all(
    Array.from({ length: SAME_PARTICIPANT_CONCURRENCY }, () => submitDraw(httpClient, drawUrl, sameParticipant)),
  );

  const successCountScenario1 = sameParticipantResults.filter(
    (result) => result.httpStatus === 201 && result.responseStatus === 'SUCCESS',
  ).length;
  const alreadyClaimedCountScenario1 = sameParticipantResults.filter(
    (result) => result.responseStatus === 'ALREADY_CLAIMED',
  ).length;
  const uniqueClaimIdsScenario1 = new Set(
    sameParticipantResults.map((result) => result.claimId).filter((claimId) => Boolean(claimId)),
  );

  const scenario1Gate =
    successCountScenario1 === 1 &&
    alreadyClaimedCountScenario1 === SAME_PARTICIPANT_CONCURRENCY - 1 &&
    uniqueClaimIdsScenario1.size === 1
      ? 'PASS'
      : 'FAIL';

  // Scenario 2: unique participants submitted concurrently.
  const uniqueParticipants = generateParticipants(UNIQUE_PARTICIPANT_CONCURRENCY, `${runId}-UNQ`);
  const uniqueParticipantResults = await Promise.all(
    uniqueParticipants.map((participant) => submitDraw(httpClient, drawUrl, participant)),
  );

  const successCountScenario2 = uniqueParticipantResults.filter(
    (result) => result.httpStatus === 201 && result.responseStatus === 'SUCCESS',
  ).length;
  const uniqueClaimIdsScenario2 = new Set(
    uniqueParticipantResults.map((result) => result.claimId).filter((claimId) => Boolean(claimId)),
  );

  const scenario2Gate =
    successCountScenario2 === UNIQUE_PARTICIPANT_CONCURRENCY && uniqueClaimIdsScenario2.size === UNIQUE_PARTICIPANT_CONCURRENCY
      ? 'PASS'
      : 'FAIL';

  const overallGate = scenario1Gate === 'PASS' && scenario2Gate === 'PASS' ? 'PASS' : 'FAIL';

  const anomalies = [];
  if (scenario1Gate !== 'PASS') {
    anomalies.push(
      `Scenario 1 (same participant, concurrent): expected exactly 1 success, got ${successCountScenario1}; expected ${SAME_PARTICIPANT_CONCURRENCY - 1} ALREADY_CLAIMED, got ${alreadyClaimedCountScenario1}; unique claim IDs observed: ${uniqueClaimIdsScenario1.size}.`,
    );
  }
  if (scenario2Gate !== 'PASS') {
    anomalies.push(
      `Scenario 2 (unique participants, concurrent): expected ${UNIQUE_PARTICIPANT_CONCURRENCY} successes with ${UNIQUE_PARTICIPANT_CONCURRENCY} unique claim IDs, got ${successCountScenario2} successes / ${uniqueClaimIdsScenario2.size} unique claim IDs.`,
    );
  }

  return {
    scenario: SCENARIO_NAME,
    runId,
    summary: {
      gate: overallGate,
      scenario1: {
        gate: scenario1Gate,
        concurrentRequests: SAME_PARTICIPANT_CONCURRENCY,
        successCount: successCountScenario1,
        alreadyClaimedCount: alreadyClaimedCountScenario1,
        uniqueClaimIds: uniqueClaimIdsScenario1.size,
      },
      scenario2: {
        gate: scenario2Gate,
        concurrentRequests: UNIQUE_PARTICIPANT_CONCURRENCY,
        successCount: successCountScenario2,
        uniqueClaimIds: uniqueClaimIdsScenario2.size,
      },
    },
    records: { sameParticipant: sameParticipantResults, uniqueParticipants: uniqueParticipantResults },
    anomalies,
  };
};
