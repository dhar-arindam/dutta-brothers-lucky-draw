export const validateFrontendOrigin = (origin: unknown, stageName: string): string => {
  if (typeof origin !== 'string' || origin.trim().length === 0) {
    throw new Error(`Context "frontendOrigin${stageName}" is required for stage "${stageName}".`);
  }

  const normalizedOrigin = origin.trim();
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(normalizedOrigin);
  } catch {
    throw new Error(`Context "frontendOrigin${stageName}" must be a valid HTTP(S) URL.`);
  }

  if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
    throw new Error(`Context "frontendOrigin${stageName}" must use HTTP or HTTPS.`);
  }

  if (
    parsedOrigin.hostname === 'bootstrap-placeholder.invalid' ||
    parsedOrigin.hostname === 'example.invalid' ||
    parsedOrigin.hostname.endsWith('.invalid')
  ) {
    throw new Error(
      `Context "frontendOrigin${stageName}" must not use a placeholder or reserved .invalid domain.`,
    );
  }

  return normalizedOrigin.replace(/\/$/, '');
};
