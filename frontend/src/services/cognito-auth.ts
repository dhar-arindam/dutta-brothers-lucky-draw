const STORAGE_KEY = 'dutta-draw-admin-auth';
const VERIFIER_KEY = 'dutta-draw-admin-pkce-verifier';
const STATE_KEY = 'dutta-draw-admin-oauth-state';

interface CognitoConfig {
  domain: string;
  clientId: string;
  redirectUri: string;
  logoutUri: string;
}

interface StoredSession {
  accessToken: string;
  expiresAt: number;
}

const getConfig = (): CognitoConfig | null => {
  const domain = import.meta.env.VITE_COGNITO_DOMAIN;
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  if (!domain || !clientId || typeof window === 'undefined') {
    return null;
  }

  return {
    domain: `${domain.startsWith('http') ? '' : 'https://'}${domain.replace(/\/$/, '')}`,
    clientId,
    redirectUri: `${window.location.origin}/admin`,
    logoutUri: `${window.location.origin}/admin`,
  };
};

const base64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const randomString = (length: number): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
};

const createChallenge = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
};

const readSession = (): StoredSession | null => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const session = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof session.accessToken !== 'string' ||
      typeof session.expiresAt !== 'number' ||
      session.expiresAt <= Date.now()
    ) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session as StoredSession;
  } catch {
    return null;
  }
};

export const getAdminAccessToken = (): string | null => readSession()?.accessToken ?? null;

export const hasAdminSession = (): boolean => getAdminAccessToken() !== null;

export const expireAdminSession = (): void => {
  sessionStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event('dutta-draw-admin-session-expired'));
};

export const startCognitoLogin = async (): Promise<void> => {
  const config = getConfig();
  if (!config) {
    throw new Error('Cognito authentication is not configured.');
  }

  const verifier = randomString(64);
  const state = randomString(32);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const challenge = await createChallenge(verifier);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email profile dutta-admin/admin',
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  window.location.assign(`${config.domain}/oauth2/authorize?${params.toString()}`);
};

export const completeCognitoLogin = async (): Promise<boolean> => {
  const config = getConfig();
  if (!config || typeof window === 'undefined') {
    return false;
  }

  const query = new URLSearchParams(window.location.search);
  const code = query.get('code');
  if (!code) {
    return false;
  }

  const state = query.get('state');
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!state || state !== expectedState || !verifier) {
    throw new Error('Invalid Cognito login state.');
  }

  const response = await fetch(`${config.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    throw new Error('Cognito login could not be completed.');
  }

  const tokenResponse = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!tokenResponse.access_token || !tokenResponse.expires_in) {
    throw new Error('Cognito returned an invalid login response.');
  }

  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      accessToken: tokenResponse.access_token,
      expiresAt: Date.now() + tokenResponse.expires_in * 1000 - 30_000,
    }),
  );
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  window.history.replaceState({}, '', config.redirectUri);
  return true;
};

export const logoutCognito = (): void => {
  const config = getConfig();
  sessionStorage.removeItem(STORAGE_KEY);
  if (config) {
    window.location.assign(
      `${config.domain}/logout?${new URLSearchParams({
        client_id: config.clientId,
        logout_uri: config.logoutUri,
      }).toString()}`,
    );
  }
};
