#!/usr/bin/env node
// CLI entry point for the staging performance test suite.
//
// Usage:
//   node tests/performance/run.mjs <scenario> [--dry-run]
//   scenario: sequential-20 | load-500 | randomness-5000 | concurrency | all
//
// Real staging execution requires PERFORMANCE_TARGET_STACK_NAME,
// PERFORMANCE_TARGET_API_BASE_URL, PERFORMANCE_TARGET_FRONTEND_URL, and
// PERFORMANCE_CONFIRM=RUN_PERFORMANCE_TEST to be set (see lib/target.mjs).
// Pass --dry-run (or PERFORMANCE_DRY_RUN=true) to validate the framework
// end-to-end against an in-process mock with zero network calls.

import { resolveTarget } from './lib/target.mjs';
import { writeReport } from './lib/report.mjs';
import * as sequential20 from './scenarios/sequential-20.mjs';
import * as load500 from './scenarios/load-500.mjs';
import * as randomness5000 from './scenarios/randomness-5000.mjs';
import * as concurrency from './scenarios/concurrency.mjs';

const SCENARIOS = {
  'sequential-20': sequential20,
  'load-500': load500,
  'randomness-5000': randomness5000,
  concurrency,
};

const SAFE_TO_ALL_ORDER = ['sequential-20', 'concurrency', 'load-500', 'randomness-5000'];

const parseArgs = (argv) => {
  const [scenarioName, ...rest] = argv;
  const dryRunFlag = rest.includes('--dry-run');
  return { scenarioName, dryRunFlag };
};

const runScenario = async (name, target) => {
  const module = SCENARIOS[name];
  if (!module) {
    throw new Error(`Unknown scenario "${name}". Valid options: ${Object.keys(SCENARIOS).join(', ')}, all`);
  }

  console.log(`\n[performance] ==== Running scenario: ${name} ====`);
  const report = await module.run(target);
  console.log(`[performance] Scenario "${name}" gate: ${report.summary?.gate ?? 'UNKNOWN'}`);
  writeReport(name, report);
  return report;
};

const main = async () => {
  const { scenarioName, dryRunFlag } = parseArgs(process.argv.slice(2));

  if (!scenarioName) {
    console.error('Usage: node tests/performance/run.mjs <sequential-20|load-500|randomness-5000|concurrency|all> [--dry-run]');
    process.exitCode = 1;
    return;
  }

  if (dryRunFlag) {
    process.env.PERFORMANCE_DRY_RUN = 'true';
  }

  const target = resolveTarget();

  const namesToRun = scenarioName === 'all' ? SAFE_TO_ALL_ORDER : [scenarioName];
  const reports = [];
  let hadFailure = false;

  for (const name of namesToRun) {
    const report = await runScenario(name, target);
    reports.push(report);
    if (report.summary?.gate === 'FAIL' || report.summary?.gate === 'BLOCKED') {
      hadFailure = true;
    }
  }

  console.log('\n[performance] ==== Run complete ====');
  for (const report of reports) {
    console.log(`  ${report.scenario}: ${report.summary?.gate ?? 'UNKNOWN'}`);
  }

  process.exitCode = hadFailure ? 1 : 0;
};

main().catch((error) => {
  console.error('[performance] Fatal error:', error);
  process.exitCode = 1;
});
