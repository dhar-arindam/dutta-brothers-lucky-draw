// Thin fetch wrapper: records timing, enforces a timeout, never auto-retries
// (retries would corrupt duplicate-participation and randomness measurements).

const DEFAULT_TIMEOUT_MS = 10000;

// Deterministic in-process mock used only for --dry-run / offline validation.
// Mirrors the real draw API's weighted-selection contract shape without any network call.
const createDryRunResponder = (options = {}) => {
  const prizes = options.prizes ?? [
    { id: 'prize-001', name: 'Electric Kettle', weight: 1 },
    { id: 'prize-002', name: 'Coffee Maker', weight: 3 },
    { id: 'prize-003', name: 'Mixer Grinder', weight: 6 },
  ];
  const totalWeight = prizes.reduce((sum, prize) => sum + prize.weight, 0);
  const claimsByBill = new Map();
  let sequence = 0;

  const pickPrize = () => {
    const target = Math.random() * totalWeight;
    let cumulative = 0;
    for (const prize of prizes) {
      cumulative += prize.weight;
      if (target < cumulative) {
        return prize;
      }
    }
    return prizes[prizes.length - 1];
  };

  return async (path, init) => {
    if (!path.endsWith('/api/draw')) {
      return { status: 200, ok: true, json: async () => ({ status: 'SUCCESS' }) };
    }

    const body = JSON.parse(init.body);
    const billKey = body.billNumber.toUpperCase();

    const existingClaim = claimsByBill.get(billKey);
    if (existingClaim) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          status: 'ALREADY_CLAIMED',
          claimId: existingClaim.claimId,
          claimTimestamp: existingClaim.claimTimestamp,
          prize: existingClaim.prize,
          message: 'This bill has already been used for the lucky draw.',
        }),
      };
    }

    sequence += 1;
    const prize = pickPrize();
    const claim = {
      claimId: `DB26-DRYRUN-${String(sequence).padStart(6, '0')}`,
      claimTimestamp: new Date().toISOString(),
      prize: { id: prize.id, name: prize.name, displayName: prize.name },
    };
    claimsByBill.set(billKey, claim);

    return {
      status: 201,
      ok: true,
      json: async () => ({
        status: 'SUCCESS',
        claimId: claim.claimId,
        claimTimestamp: claim.claimTimestamp,
        prize: claim.prize,
        wheel: { sectorPrizeIds: prizes.map((entry) => entry.id) },
      }),
    };
  };
};

export const createHttpClient = ({ dryRun = false, dryRunOptions } = {}) => {
  const dryRunResponder = dryRun ? createDryRunResponder(dryRunOptions) : null;

  const postJson = async (url, payload, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = {}) => {
    const startedAt = performance.now();

    try {
      let response;
      if (dryRunResponder) {
        response = await dryRunResponder(url, { body: JSON.stringify(payload) });
      } else {
        const abortController = new AbortController();
        const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(payload),
            signal: abortController.signal,
          });
        } finally {
          clearTimeout(timeoutHandle);
        }
      }

      const latencyMs = performance.now() - startedAt;
      let json = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }

      return {
        ok: true,
        httpStatus: response.status,
        latencyMs,
        body: json,
        timedOut: false,
        error: null,
      };
    } catch (error) {
      const latencyMs = performance.now() - startedAt;
      const timedOut = error && error.name === 'AbortError';
      return {
        ok: false,
        httpStatus: null,
        latencyMs,
        body: null,
        timedOut,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  return { postJson };
};
