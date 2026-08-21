// Resolves and hard-validates the staging target before any performance test runs.
// This is the primary safety gate: production can never be targeted from this framework.

const APPROVED_STACK_NAME = 'DuttaDrawFoundationStackStaging';
const APPROVED_API_HOST_SUFFIX = '.execute-api.ap-south-1.amazonaws.com';
const APPROVED_FRONTEND_HOST_SUFFIX = '.cloudfront.net';
const REQUIRED_CONFIRMATION = 'RUN_PERFORMANCE_TEST';

class UnsafeTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafeTargetError';
  }
}

const assertApprovedHost = (label, url, suffix) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeTargetError(`${label} is not a valid URL: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new UnsafeTargetError(`${label} must use https. Got: ${parsed.protocol}`);
  }

  if (!parsed.hostname.endsWith(suffix)) {
    throw new UnsafeTargetError(
      `${label} hostname "${parsed.hostname}" is not an approved staging host (expected suffix "${suffix}").`,
    );
  }

  return parsed;
};

// Resolves the performance-test target strictly from explicit environment variables.
// Never guesses, never falls back to a hardcoded or cached hostname.
export const resolveTarget = (env = process.env) => {
  const stackName = env.PERFORMANCE_TARGET_STACK_NAME;
  const apiBaseUrl = env.PERFORMANCE_TARGET_API_BASE_URL;
  const frontendUrl = env.PERFORMANCE_TARGET_FRONTEND_URL;
  const confirmation = env.PERFORMANCE_CONFIRM;
  const dryRun = env.PERFORMANCE_DRY_RUN === 'true';

  if (!dryRun) {
    if (!stackName) {
      throw new UnsafeTargetError('PERFORMANCE_TARGET_STACK_NAME is required.');
    }
    if (stackName !== APPROVED_STACK_NAME) {
      throw new UnsafeTargetError(
        `Refusing to run: stack "${stackName}" is not the approved staging stack "${APPROVED_STACK_NAME}".`,
      );
    }
    if (!apiBaseUrl) {
      throw new UnsafeTargetError('PERFORMANCE_TARGET_API_BASE_URL is required.');
    }
    if (!frontendUrl) {
      throw new UnsafeTargetError('PERFORMANCE_TARGET_FRONTEND_URL is required.');
    }
    assertApprovedHost('PERFORMANCE_TARGET_API_BASE_URL', apiBaseUrl, APPROVED_API_HOST_SUFFIX);
    assertApprovedHost('PERFORMANCE_TARGET_FRONTEND_URL', frontendUrl, APPROVED_FRONTEND_HOST_SUFFIX);

    if (confirmation !== REQUIRED_CONFIRMATION) {
      throw new UnsafeTargetError(
        `Refusing to run: PERFORMANCE_CONFIRM must exactly equal "${REQUIRED_CONFIRMATION}".`,
      );
    }
  }

  const resolved = {
    dryRun,
    stackName: dryRun ? APPROVED_STACK_NAME : stackName,
    apiBaseUrl: dryRun ? 'https://dry-run.execute-api.ap-south-1.amazonaws.com' : apiBaseUrl.replace(/\/$/, ''),
    frontendUrl: dryRun ? 'https://dry-run.cloudfront.net' : frontendUrl.replace(/\/$/, ''),
  };

  // Required by spec: print the resolved target before any execution.
  console.log('[performance] Resolved target:', JSON.stringify(resolved, null, 2));

  return resolved;
};

export { UnsafeTargetError, APPROVED_STACK_NAME, REQUIRED_CONFIRMATION };
