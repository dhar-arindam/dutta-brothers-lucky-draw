import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminAuthGate } from './AdminAuthGate';
import * as cognitoAuth from './services/cognito-auth';

describe('AdminAuthGate', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports a local session and reacts to expiry', async () => {
    render(
      <AdminAuthGate>
        {(isAuthenticated, _signIn, _signOut, message, isChecking) => (
          <output>{`${isAuthenticated}:${isChecking}:${message}`}</output>
        )}
      </AdminAuthGate>,
    );

    await waitFor(() => expect(screen.getByText('true:false:')).toBeInTheDocument());
    window.dispatchEvent(new Event('dutta-draw-admin-session-expired'));
    await waitFor(() =>
      expect(
        screen.getByText('false:false:Your admin session expired. Please sign in again.'),
      ).toBeInTheDocument(),
    );
  });

  it('reports a valid local session', async () => {
    sessionStorage.setItem(
      'dutta-draw-admin-auth',
      JSON.stringify({ accessToken: 'token', expiresAt: Date.now() + 60_000 }),
    );
    render(
      <AdminAuthGate>
        {(isAuthenticated, signIn, signOut, message, isChecking) => (
          <div>
            <output>{`${isAuthenticated}:${isChecking}:${message}`}</output>
            <button onClick={signIn}>Sign in</button>
            <button onClick={signOut}>Sign out</button>
          </div>
        )}
      </AdminAuthGate>,
    );

    await waitFor(() => expect(screen.getByText('true:false:')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(sessionStorage.getItem('dutta-draw-admin-auth')).toBeNull();
  });

  it('shows a generic message when login completion rejects a non-Error value', async () => {
    vi.spyOn(cognitoAuth, 'completeCognitoLogin').mockRejectedValue('login failed');

    render(
      <AdminAuthGate>
        {(isAuthenticated, _signIn, _signOut, message, isChecking) => (
          <output>{`${isAuthenticated}:${isChecking}:${message}`}</output>
        )}
      </AdminAuthGate>,
    );

    await waitFor(() =>
      expect(screen.getByText('false:false:Admin login failed.')).toBeInTheDocument(),
    );
  });

  it('shows the login completion error message when Cognito login fails', async () => {
    vi.spyOn(cognitoAuth, 'completeCognitoLogin').mockRejectedValue(
      new Error('Cognito login could not be completed.'),
    );

    render(
      <AdminAuthGate>
        {(isAuthenticated, _signIn, _signOut, message, isChecking) => (
          <output>{`${isAuthenticated}:${isChecking}:${message}`}</output>
        )}
      </AdminAuthGate>,
    );

    await waitFor(() =>
      expect(
        screen.getByText('false:false:Cognito login could not be completed.'),
      ).toBeInTheDocument(),
    );
  });

  it('shows the sign-in error when Cognito login cannot be started', async () => {
    vi.spyOn(cognitoAuth, 'startCognitoLogin').mockRejectedValue(
      new Error('Cognito authentication is not configured.'),
    );

    render(
      <AdminAuthGate>
        {(isAuthenticated, signIn, _signOut, message, isChecking) => (
          <div>
            <output>{`${isAuthenticated}:${isChecking}:${message}`}</output>
            <button onClick={signIn}>Sign in</button>
          </div>
        )}
      </AdminAuthGate>,
    );

    await waitFor(() => expect(screen.getByText('false:false:')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(
        screen.getByText('false:false:Cognito authentication is not configured.'),
      ).toBeInTheDocument(),
    );
  });
});
