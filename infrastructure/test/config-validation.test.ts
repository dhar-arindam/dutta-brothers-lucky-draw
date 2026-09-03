import { describe, expect, it } from 'vitest';

import { validateFrontendOrigin } from '../lib/config-validation.js';

describe('frontend origin validation', () => {
  it('accepts HTTP(S) origins and removes a trailing slash', () => {
    expect(validateFrontendOrigin('https://admin.example.com/', 'Prod')).toBe(
      'https://admin.example.com',
    );
    expect(validateFrontendOrigin('http://localhost:5173', 'Dev')).toBe('http://localhost:5173');
  });

  it('rejects missing, malformed, unsupported, and placeholder origins', () => {
    expect(() => validateFrontendOrigin('', 'Staging')).toThrow(/required/);
    expect(() => validateFrontendOrigin('not-a-url', 'Staging')).toThrow(/valid HTTP\(S\) URL/);
    expect(() => validateFrontendOrigin('ftp://admin.example.com', 'Staging')).toThrow(
      /HTTP or HTTPS/,
    );
    expect(() =>
      validateFrontendOrigin('https://bootstrap-placeholder.invalid', 'Staging'),
    ).toThrow(/placeholder/);
    expect(() => validateFrontendOrigin('https://example.invalid', 'Prod')).toThrow(/placeholder/);
  });
});
