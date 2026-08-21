// Deterministic-per-run synthetic participant generation for performance tests.
// Names/bills are unique within a run (identifiable PERFTEST- prefix) and never collide
// with real customer data. A run ID scopes uniqueness across separate executions so
// re-running the suite never re-hits a previous run's claimed bill numbers.

const PHONE_PREFIX = '90000'; // synthetic block reserved for performance testing
const BILL_PREFIX = 'PERFTEST';
const NAME_PREFIX = 'Perf Test User';

// Converts a 1-based index into a letters-only suffix (A, B, ... Z, AA, AB, ...),
// since the name validator only allows letters, spaces, '.', "'", and '-' (no digits).
const indexToLetters = (index) => {
  let value = index;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
};

export const createRunId = () => {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
};

// Generates one unique synthetic participant for the given 1-based index within a run.
export const generateParticipant = (index, runId) => {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error('generateParticipant requires a positive integer index.');
  }
  if (!runId) {
    throw new Error('generateParticipant requires a runId for cross-run uniqueness.');
  }

  const paddedIndex = String(index).padStart(5, '0');
  const phoneSuffix = String(index % 100000).padStart(5, '0');

  return {
    index,
    runId,
    name: `${NAME_PREFIX} ${indexToLetters(index)}`,
    phone: `${PHONE_PREFIX}${phoneSuffix}`,
    billNumber: `${BILL_PREFIX}-${runId}-${paddedIndex}`,
  };
};

export const generateParticipants = (count, runId) => {
  const participants = [];
  for (let index = 1; index <= count; index += 1) {
    participants.push(generateParticipant(index, runId));
  }
  return participants;
};

export const isSyntheticBillNumber = (billNumber) => {
  return typeof billNumber === 'string' && billNumber.toUpperCase().startsWith(`${BILL_PREFIX}-`);
};
