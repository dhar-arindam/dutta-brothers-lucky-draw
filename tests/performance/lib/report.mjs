// Writes a machine-readable JSON result and a human-readable Markdown summary.
// Results are written under tests/performance/results/ which is gitignored;
// CI publishes this directory as a workflow artifact instead of committing it.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(currentDir, '..', 'results');

export const writeReport = (scenarioName, report) => {
  mkdirSync(resultsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `${scenarioName}-${timestamp}`;

  const jsonPath = path.join(resultsDir, `${baseName}.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

  const markdownPath = path.join(resultsDir, `${baseName}.md`);
  writeFileSync(markdownPath, toMarkdown(scenarioName, report), 'utf-8');

  console.log(`[performance] Report written: ${jsonPath}`);
  console.log(`[performance] Report written: ${markdownPath}`);

  return { jsonPath, markdownPath };
};

const toMarkdown = (scenarioName, report) => {
  const lines = [];
  lines.push(`# Performance Report: ${scenarioName}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.summary ?? {}, null, 2));
  lines.push('```');

  if (report.latency) {
    lines.push('');
    lines.push('## Latency (ms)');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|---|---|');
    for (const [key, value] of Object.entries(report.latency)) {
      lines.push(`| ${key} | ${typeof value === 'number' ? value.toFixed(2) : value} |`);
    }
  }

  if (report.randomness) {
    lines.push('');
    lines.push('## Randomness Assessment');
    lines.push('');
    lines.push(`Result: **${report.randomness.verdict}**`);
    lines.push('');
    lines.push(
      `Chi-square statistic: ${report.randomness.statistic.toFixed(4)}, degrees of freedom: ${report.randomness.degreesOfFreedom}, p-value: ${
        report.randomness.pValue === null ? 'n/a' : report.randomness.pValue.toFixed(6)
      }`,
    );
    lines.push('');
    lines.push('| Prize | Configured Weight | Expected % | Observed Count | Observed % | Variance |');
    lines.push('|---|---|---|---|---|---|');
    for (const row of report.randomness.table ?? []) {
      lines.push(
        `| ${row.prizeId} | ${row.configuredWeight} | ${row.expectedPercent.toFixed(2)}% | ${row.observedCount} | ${row.observedPercent.toFixed(2)}% | ${row.variancePercentPoints.toFixed(2)} pts |`,
      );
    }
  }

  if (report.anomalies && report.anomalies.length > 0) {
    lines.push('');
    lines.push('## Anomalies');
    lines.push('');
    for (const anomaly of report.anomalies) {
      lines.push(`- ${anomaly}`);
    }
  }

  return lines.join('\n');
};
