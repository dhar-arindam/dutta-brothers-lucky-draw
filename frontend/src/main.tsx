import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AdminPrizePage } from './AdminPrizePage';
import { AdminAuthGate } from './AdminAuthGate';
import { App } from './App';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Frontend root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    {window.location.pathname === '/admin' ? (
      <AdminAuthGate>
        {(isAuthenticated, onSignIn, onSignOut, authMessage) => (
          <AdminPrizePage
            isAuthenticated={isAuthenticated}
            onSignIn={onSignIn}
            onSignOut={onSignOut}
            authMessage={authMessage}
          />
        )}
      </AdminAuthGate>
    ) : (
      <App />
    )}
  </StrictMode>,
);
