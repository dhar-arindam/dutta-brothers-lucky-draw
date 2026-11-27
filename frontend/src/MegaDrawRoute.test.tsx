import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MegaDrawRoute } from './MegaDrawRoute';

vi.mock('./MegaDrawPage', () => ({
  MegaDrawPage: () => <div>Mega Draw Page</div>,
}));

describe('MegaDrawRoute', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading status while the admin session is checked', () => {
    render(<MegaDrawRoute isAuthenticated={false} isChecking />);

    expect(screen.getByRole('status')).toHaveTextContent('Checking admin session...');
  });

  it('renders nothing for an unauthenticated admin session', () => {
    const { container } = render(<MegaDrawRoute isAuthenticated={false} isChecking={false} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the Mega Draw page for an authenticated admin', () => {
    render(<MegaDrawRoute isAuthenticated isChecking={false} />);

    expect(screen.getByText('Mega Draw Page')).toBeInTheDocument();
  });
});
