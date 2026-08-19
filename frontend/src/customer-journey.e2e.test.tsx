import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

const mockFetch = vi.fn();

const setupMatchMedia = (prefersReducedMotion = false) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => {
      return {
        matches: prefersReducedMotion && query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  );
};

const fillForm = (billNumber: string) => {
  fireEvent.change(screen.getByLabelText('Full Name'), {
    target: { value: 'Arindam Roy' },
  });
  fireEvent.change(screen.getByLabelText('Phone Number'), {
    target: { value: '9876543210' },
  });
  fireEvent.change(screen.getByLabelText('Bill Number'), {
    target: { value: billNumber },
  });
};

const goToForm = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Start Your Lucky Draw' }));
};

describe('customer journey e2e gift box flow', () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('E2E-01 Successful Draw', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        status: 'SUCCESS',
        claimId: 'DB26-100101',
        claimTimestamp: '2026-08-16T10:30:00.000Z',
        prize: {
          id: 'prize-003',
          name: 'Mixer Grinder',
          displayName: 'Mixer Grinder',
        },
        wheel: { sectorPrizeIds: ['prize-001', 'prize-002', 'prize-003'] },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillForm('DB1001');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('anticipation-view')).toBeInTheDocument();
      expect(screen.getByTestId('reveal-overlay')).toBeInTheDocument();
    }, { timeout: 1500 });

    await waitFor(
      () => {
        expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByTestId('gift-box-hero'));

    expect(await screen.findByText('CONGRATULATIONS!', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText('YOU WON!')).toBeInTheDocument();
    expect((await screen.findAllByText('Mixer Grinder')).length).toBeGreaterThan(0);
    expect(await screen.findByText('DB26-100101')).toBeInTheDocument();
    expect(screen.queryByTestId('lucky-wheel')).not.toBeInTheDocument();
  }, 12000);

  it('E2E-01B Successful Draw with reduced motion still requires tap', async () => {
    setupMatchMedia(true);
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        status: 'SUCCESS',
        claimId: 'DB26-100102',
        claimTimestamp: '2026-08-16T10:30:00.000Z',
        prize: {
          id: 'prize-003',
          name: 'Mixer Grinder',
          displayName: 'Mixer Grinder',
        },
        wheel: { sectorPrizeIds: ['prize-001', 'prize-002', 'prize-003'] },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillForm('DB1002');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    await waitFor(() => {
      expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
    }, { timeout: 2500 });

    expect(screen.queryByText('CONGRATULATIONS!')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('gift-box-hero'));

    expect(await screen.findByText('CONGRATULATIONS!', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText('DB26-100102')).toBeInTheDocument();
  });

  it('E2E-02 Invalid Phone', async () => {
    setupMatchMedia();
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();

    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'Arindam Roy' },
    });
    fireEvent.change(screen.getByLabelText('Phone Number'), {
      target: { value: '987654321' },
    });
    fireEvent.change(screen.getByLabelText('Bill Number'), {
      target: { value: 'DB2001' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    expect(await screen.findByText('Phone number must contain exactly 10 digits.')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('E2E-06 Draw Ended', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        status: 'ERROR',
        code: 'DRAW_ENDED',
        message: 'The lucky draw has ended for today. Please visit the Dutta Brothers counter.',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillForm('DB3001');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    expect(
      await screen.findByText(
        'The lucky draw has ended for today. Please visit the Dutta Brothers counter.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Draw Ended' })).toBeInTheDocument();
  });

  it('E2E-07 No Eligible Prize', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        status: 'ERROR',
        code: 'NO_ELIGIBLE_PRIZE',
        message: 'The lucky draw has ended for today. Please visit the Dutta Brothers counter.',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillForm('DB4001');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    expect(
      await screen.findByText(
        'The lucky draw has ended for today. Please visit the Dutta Brothers counter.',
      ),
    ).toBeInTheDocument();
  });

  it('E2E-08 API Failure', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        status: 'ERROR',
        code: 'API_ERROR',
        message: 'Service temporarily unavailable. Please retry.',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillForm('DB5001');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    expect(await screen.findByText('Service temporarily unavailable. Please retry.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('E2E-09 Lost Response and Retry', async () => {
    setupMatchMedia();
    mockFetch
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({
        json: async () => ({
          status: 'ALREADY_CLAIMED',
          claimId: 'DB26-900001',
          claimTimestamp: '2026-08-16T10:30:00.000Z',
          prize: {
            id: 'prize-002',
            name: 'Coffee Maker',
            displayName: 'Coffee Maker',
          },
          message: 'This bill has already been used for the lucky draw.',
        }),
      });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillForm('DB9001');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));
    expect(
      await screen.findByText('We could not complete the draw. Please check your connection and retry.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByText('This bill has already been used for the lucky draw.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('DB26-900001')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

