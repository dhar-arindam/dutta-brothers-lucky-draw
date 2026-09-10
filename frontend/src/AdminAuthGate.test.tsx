import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminAuthGate } from './AdminAuthGate';

describe('AdminAuthGate', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
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
});
