export type AppRuntimeMode = 'LOCAL' | 'PRODUCTION';

const normalizeRuntimeMode = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  return value.trim().toUpperCase();
};

export const resolveRuntimeMode = (
  value: string | undefined = process.env.APP_RUNTIME,
): AppRuntimeMode => {
  const normalized = normalizeRuntimeMode(value);

  // Local is the safe default for developer machines.
  if (!normalized) {
    return 'LOCAL';
  }

  if (normalized === 'LOCAL' || normalized === 'PRODUCTION') {
    return normalized;
  }

  throw new Error(
    `Invalid APP_RUNTIME value "${value}". Supported values are LOCAL or PRODUCTION.`,
  );
};
