import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/customer-journey.e2e.test.ts',
        'src/aws-integration.test.ts',
        'src/main.ts',
        'src/lambda.ts',
        'src/contracts.ts',
        'src/domain.ts',
        'src/runtime-mode.ts',
      ],
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
  },
});
