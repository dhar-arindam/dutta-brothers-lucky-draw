import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  completeCognitoLogin,
  expireAdminSession,
  getAdminAccessToken,
  hasAdminSession,
  logoutCognito,
  startCognitoLogin,
} from './cognito-auth';

const config = {
  domain: 'https://login.example.com',
  clientId: 'client-123',
};

const originalLocation = window.location;

const setUrl = (url: string) => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL(url),
  });
};

describe('Cognito admin authentication', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('starts a PKCE login with the configured Managed Login client', async () => {
    vi.stubEnv('VITE_COGNITO_DOMAIN', config.domain);
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', config.clientId);
    setUrl('http://localhost:5173/admin');
    const assign = vi.fn();
    Object.defineProperty(window.location, 'assign', { configurable: true, value: assign });

    await startCognitoLogin();

    expect(assign).toHaveBeenCalledOnce();
    const loginUrl = new URL(assign.mock.calls[0]?.[0] as string);
    expect(loginUrl.origin).toBe(config.domain);
    expect(loginUrl.pathname).toBe('/oauth2/authorize');
    expect(loginUrl.searchParams.get('client_id')).toBe(config.clientId);
    expect(loginUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(sessionStorage.getItem('dutta-draw-admin-pkce-verifier')).toBeTruthy();
  });

  it('rejects login when Cognito configuration is missing', async () => {
    vi.stubEnv('VITE_COGNITO_DOMAIN', '');
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', '');
    await expect(startCognitoLogin()).rejects.toThrow('not configured');
  });

  it('returns no callback result when the URL has no authorization code', async () => {
    vi.stubEnv('VITE_COGNITO_DOMAIN', config.domain);
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', config.clientId);
    setUrl('http://localhost:5173/admin');

    await expect(completeCognitoLogin()).resolves.toBe(false);
  });

  it('exchanges a valid callback code and stores the access token', async () => {
    vi.stubEnv('VITE_COGNITO_DOMAIN', config.domain);
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', config.clientId);
    setUrl('http://localhost:5173/admin?code=auth-code&state=oauth-state');
    sessionStorage.setItem('dutta-draw-admin-oauth-state', 'oauth-state');
    sessionStorage.setItem('dutta-draw-admin-pkce-verifier', 'verifier');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'access-token', expires_in: 3600 }),
      }),
    );
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);

    await expect(completeCognitoLogin()).resolves.toBe(true);
    expect(getAdminAccessToken()).toBe('access-token');
    expect(hasAdminSession()).toBe(true);
  });

  it('rejects an invalid callback state and a failed token exchange', async () => {
    vi.stubEnv('VITE_COGNITO_DOMAIN', config.domain);
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', config.clientId);
    setUrl('http://localhost:5173/admin?code=auth-code&state=wrong-state');
    sessionStorage.setItem('dutta-draw-admin-oauth-state', 'expected-state');
    sessionStorage.setItem('dutta-draw-admin-pkce-verifier', 'verifier');
    await expect(completeCognitoLogin()).rejects.toThrow('Invalid Cognito login state');

    setUrl('http://localhost:5173/admin?code=auth-code&state=oauth-state');
    sessionStorage.setItem('dutta-draw-admin-oauth-state', 'oauth-state');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(completeCognitoLogin()).rejects.toThrow('could not be completed');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'missing-expiry' }),
      }),
    );
    await expect(completeCognitoLogin()).rejects.toThrow('invalid login response');
  });

  it('clears an expired session and logs out through Managed Login', () => {
    vi.stubEnv('VITE_COGNITO_DOMAIN', config.domain);
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', config.clientId);
    setUrl('http://localhost:5173/admin');
    sessionStorage.setItem(
      'dutta-draw-admin-auth',
      JSON.stringify({ accessToken: 'access-token', expiresAt: Date.now() + 60_000 }),
    );
    const assign = vi.fn();
    Object.defineProperty(window.location, 'assign', { configurable: true, value: assign });

    expireAdminSession();
    expect(hasAdminSession()).toBe(false);
    logoutCognito();
    expect(assign).toHaveBeenCalledWith(expect.stringContaining('/logout?'));
  });

  it('clears malformed and expired stored sessions', () => {
    sessionStorage.setItem('dutta-draw-admin-auth', '{malformed');
    expect(getAdminAccessToken()).toBeNull();
    sessionStorage.setItem(
      'dutta-draw-admin-auth',
      JSON.stringify({ accessToken: 'expired', expiresAt: Date.now() - 1 }),
    );
    expect(getAdminAccessToken()).toBeNull();
  });
});
