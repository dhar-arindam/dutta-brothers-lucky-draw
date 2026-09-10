import { MegaDrawPage } from './MegaDrawPage';

export const MegaDrawRoute = ({
  isAuthenticated,
  isChecking,
}: {
  isAuthenticated: boolean;
  isChecking: boolean;
}) => {
  if (isChecking) return <p role="status">Checking admin session...</p>;
  if (!isAuthenticated) {
    window.location.replace('/admin');
    return null;
  }
  return <MegaDrawPage />;
};
