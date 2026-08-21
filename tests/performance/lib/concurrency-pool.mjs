// Bounded-concurrency task runner: never fires more than `concurrency` requests
// in flight at once, avoiding uncontrolled instantaneous bursts.

export const runWithConcurrency = async (items, worker, concurrency) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
};

// Runs a sequence of ramp stages (e.g. 50 -> 100 -> 250 -> 500 users), each stage
// using its own bounded concurrency, with an optional pause between stages.
export const runStagedRamp = async (stages, worker, { onStageStart, pauseBetweenStagesMs = 0 } = {}) => {
  const allResults = [];
  let participantOffset = 0;

  for (const stage of stages) {
    if (onStageStart) {
      onStageStart(stage, participantOffset);
    }

    const stageItems = Array.from({ length: stage.count }, (_, index) => participantOffset + index + 1);
    const stageResults = await runWithConcurrency(stageItems, worker, stage.concurrency);
    allResults.push({ stage, results: stageResults });
    participantOffset += stage.count;

    if (pauseBetweenStagesMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pauseBetweenStagesMs));
    }
  }

  return allResults;
};
