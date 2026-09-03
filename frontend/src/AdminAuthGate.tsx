import { useEffect, useState } from 'react';

import {
  completeCognitoLogin,
  hasAdminSession,
  logoutCognito,
  startCognitoLogin,
} from './services/cognito-auth';

interface AdminAuthGateProps {
  children: (
    isAuthenticated: boolean,
    onSignIn: () => void,
    onSignOut: () => void,
    authMessage: string,
  ) => React.ReactNode;
}

type AuthState = 'CHECKING' | 'SIGNED_OUT' | 'SIGNED_IN' | 'ERROR';

export const AdminAuthGate = ({ children }: AdminAuthGateProps) => {
  const [authState, setAuthState] = useState<AuthState>('CHECKING');
  const [authMessage, setAuthMessage] = useState('');

  useEffect(() => {
    let active = true;
    void completeCognitoLogin()
      .then(() => {
        if (active) {
          setAuthState(hasAdminSession() ? 'SIGNED_IN' : 'SIGNED_OUT');
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setAuthMessage(error instanceof Error ? error.message : 'Admin login failed.');
          setAuthState('ERROR');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onSessionExpired = () => {
      setAuthMessage('Your admin session expired. Please sign in again.');
      setAuthState('SIGNED_OUT');
    };
    window.addEventListener('dutta-draw-admin-session-expired', onSessionExpired);
    return () => window.removeEventListener('dutta-draw-admin-session-expired', onSessionExpired);
  }, []);

  const signIn = () => {
    void startCognitoLogin().catch((error: unknown) => {
      setAuthMessage(error instanceof Error ? error.message : 'Admin login failed.');
      setAuthState('ERROR');
    });
  };

  return children(authState === 'SIGNED_IN', signIn, logoutCognito, authMessage);
};
