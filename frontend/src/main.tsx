import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AdminPrizePage } from './AdminPrizePage';
import { App } from './App';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Frontend root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>{window.location.pathname === '/admin' ? <AdminPrizePage /> : <App />}</StrictMode>,
);
