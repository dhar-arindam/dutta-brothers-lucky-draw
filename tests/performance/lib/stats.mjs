// Latency percentile helpers plus a chi-square goodness-of-fit test for prize-weight validation.
// No external stats library is used; the incomplete-gamma implementation below is a standard
// Lanczos + series/continued-fraction approach (Numerical Recipes style), self-contained and
// accurate enough for the small degrees-of-freedom this suite uses (num prizes - 1).

const percentile = (sortedValues, p) => {
  if (sortedValues.length === 0) {
    return null;
  }
  const rank = (p / 100) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }
  const weight = rank - lowerIndex;
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
};

export const computeLatencyStats = (latenciesMs) => {
  if (latenciesMs.length === 0) {
    return { count: 0, min: null, max: null, mean: null, p50: null, p90: null, p95: null, p99: null };
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);

  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
};

// --- Incomplete gamma function machinery (for chi-square CDF) ---

const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

const logGamma = (x) => {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }

  const shifted = x - 1;
  let a = LANCZOS_COEFFICIENTS[0];
  const t = shifted + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_G + 2; i += 1) {
    a += LANCZOS_COEFFICIENTS[i] / (shifted + i);
  }

  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(a);
};

// Regularized lower incomplete gamma P(s, x) via series expansion. Converges well for x < s + 1.
const gammaSeries = (s, x) => {
  if (x <= 0) {
    return 0;
  }

  let sum = 1 / s;
  let term = sum;
  let n = s;
  for (let i = 0; i < 500; i += 1) {
    n += 1;
    term *= x / n;
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-14) {
      break;
    }
  }

  return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
};

// Regularized upper incomplete gamma Q(s, x) via continued fraction. Converges well for x >= s + 1.
const gammaContinuedFraction = (s, x) => {
  const TINY = 1e-300;
  let b = x + 1 - s;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;

  for (let i = 1; i < 500; i += 1) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) {
      d = TINY;
    }
    c = b + an / c;
    if (Math.abs(c) < TINY) {
      c = TINY;
    }
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) {
      break;
    }
  }

  return Math.exp(-x + s * Math.log(x) - logGamma(s)) * h;
};

const regularizedGammaP = (s, x) => {
  if (x < 0 || s <= 0) {
    throw new Error('regularizedGammaP requires x >= 0 and s > 0.');
  }
  if (x === 0) {
    return 0;
  }
  if (x < s + 1) {
    return gammaSeries(s, x);
  }
  return 1 - gammaContinuedFraction(s, x);
};

const regularizedGammaQ = (s, x) => {
  return 1 - regularizedGammaP(s, x);
};

// Upper-tail p-value for a chi-square statistic with `degreesOfFreedom` degrees of freedom.
export const chiSquarePValue = (statistic, degreesOfFreedom) => {
  if (degreesOfFreedom <= 0) {
    return null;
  }
  if (statistic <= 0) {
    return 1;
  }
  return regularizedGammaQ(degreesOfFreedom / 2, statistic / 2);
};

// Pearson's chi-square goodness-of-fit test comparing observed win counts per prize
// against the counts expected from configured weights.
export const chiSquareGoodnessOfFit = (observedCounts, expectedProbabilities) => {
  const categories = Object.keys(expectedProbabilities);
  const totalObserved = categories.reduce((sum, id) => sum + (observedCounts[id] ?? 0), 0);

  let statistic = 0;
  const perCategory = categories.map((id) => {
    const observed = observedCounts[id] ?? 0;
    const expected = expectedProbabilities[id] * totalObserved;
    const contribution = expected > 0 ? (observed - expected) ** 2 / expected : observed > 0 ? Infinity : 0;
    statistic += contribution;
    return { id, observed, expected, contribution };
  });

  const degreesOfFreedom = categories.length - 1;
  const pValue = degreesOfFreedom > 0 ? chiSquarePValue(statistic, degreesOfFreedom) : null;

  let verdict;
  if (degreesOfFreedom <= 0 || pValue === null) {
    verdict = 'INCONCLUSIVE';
  } else if (pValue >= 0.05) {
    verdict = 'PASS';
  } else if (pValue >= 0.01) {
    verdict = 'INCONCLUSIVE';
  } else {
    verdict = 'FAIL';
  }

  return {
    totalObserved,
    degreesOfFreedom,
    statistic,
    pValue,
    verdict,
    perCategory,
  };
};
