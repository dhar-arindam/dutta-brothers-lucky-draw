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
  ) => React.ReactNode;
}

type AuthState = 'CHECKING' | 'SIGNED_OUT' | 'SIGNED_IN' | 'ERROR';

export const AdminAuthGate = ({ children }: AdminAuthGateProps) => {
  const [authState, setAuthState] = useState<AuthState>('CHECKING');

  useEffect(() => {
    let active = true;
    void completeCognitoLogin()
      .then(() => {
        if (active) {
          setAuthState(hasAdminSession() ? 'SIGNED_IN' : 'SIGNED_OUT');
        }
      })
      .catch(() => {
        if (active) {
          setAuthState('ERROR');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const signIn = () => {
    void startCognitoLogin().catch(() => {
      setAuthState('ERROR');
    });
  };

  return children(authState === 'SIGNED_IN', signIn, logoutCognito);
};
