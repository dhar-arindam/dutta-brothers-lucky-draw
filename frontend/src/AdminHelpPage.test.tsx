import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AdminHelpPage } from './AdminHelpPage';

describe('AdminHelpPage', () => {
  it('renders the guide contents and links back to admin workflows', () => {
    render(<AdminHelpPage />);

    expect(screen.getByRole('main', { name: 'Admin user guide' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Admin user guide' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Admin' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: 'Open Mega Draw' })).toHaveAttribute(
      'href',
      '/admin/mega-draw',
    );
    expect(screen.getByText('Reopen/New Cycle')).toBeInTheDocument();
    expect(screen.getByText(/Closed cycles appear in collapsed panels/)).toBeInTheDocument();
  });

  it('restores the saved dark theme and switches back to light', () => {
    window.localStorage.setItem('dutta-draw-admin-theme', 'dark');

    render(<AdminHelpPage />);

    const guide = screen.getByRole('main', { name: 'Admin user guide' });
    expect(guide).toHaveClass('admin-help-dark');
    expect(screen.getByRole('button', { name: 'Switch to Light' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Light' }));

    expect(guide).toHaveClass('admin-help-light');
    expect(screen.getByRole('button', { name: 'Switch to Dark' })).toBeInTheDocument();
    expect(window.localStorage.getItem('dutta-draw-admin-theme')).toBe('light');
  });
});
