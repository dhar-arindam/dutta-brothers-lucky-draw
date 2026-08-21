import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const fillValidForm = (billNumber = 'DB12345') => {
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

const successResponse = {
  status: 'SUCCESS' as const,
  claimId: 'DB26-654321',
  claimTimestamp: '2026-08-16T10:30:00.000Z',
  prize: {
    id: 'prize-003',
    name: 'Mixer Grinder',
    displayName: 'Mixer Grinder',
  },
  wheel: { sectorPrizeIds: ['prize-001', 'prize-003', 'prize-002'] },
};

describe('customer draw app gift box reveal flow', () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const goToForm = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Start Your Lucky Draw' }));
  };

  it('renders landing and transitions to form without wheel UI', () => {
    setupMatchMedia();
    render(<App />);

    expect(screen.getByTestId('landing-view')).toBeInTheDocument();
    expect(screen.getByText('A festive reward is waiting for you.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Your Lucky Draw' })).toBeInTheDocument();

    goToForm();

    expect(screen.getByTestId('form-view')).toBeInTheDocument();
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone Number')).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByLabelText('Bill Number')).toHaveAttribute('autocorrect', 'off');
    expect(screen.getByRole('button', { name: 'PLAY NOW' })).toBeInTheDocument();
    expect(screen.queryByTestId('gift-box-hero')).not.toBeInTheDocument();
    expect(screen.queryByTestId('lucky-wheel')).not.toBeInTheDocument();
  });

  it('shows validation for invalid phone', async () => {
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
      target: { value: 'DB12345' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    expect(await screen.findByText('Phone number must contain exactly 10 digits.')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows validation for invalid name characters', async () => {
    setupMatchMedia();
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fireEvent.change(screen.getByLabelText('Full Name'), {
      target: { value: 'Arindam123' },
    });
    fireEvent.change(screen.getByLabelText('Phone Number'), {
      target: { value: '9876543210' },
    });
    fireEvent.change(screen.getByLabelText('Bill Number'), {
      target: { value: 'DB12345' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    expect(await screen.findByText('Name contains unsupported characters.')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('submits valid form and transitions REVEAL -> RESULT with backend data', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => successResponse,
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    await waitFor(() => {
      expect(screen.getByTestId('anticipation-view')).toBeInTheDocument();
    }, { timeout: 1500 });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
    }, { timeout: 2500 });

    await waitFor(() => {
      expect(screen.getByTestId('gift-box-hero')).toHaveAttribute('data-state', 'BOX_REVEAL');
      expect(screen.getByTestId('reveal-overlay')).toBeInTheDocument();
    }, { timeout: 2500 });

    fireEvent.click(screen.getByTestId('gift-box-hero'));
    await waitFor(() => {
      expect(screen.getByTestId('gift-box-hero')).toHaveClass('is-open');
    });
    expect(screen.queryByTestId('reveal-confetti')).not.toBeInTheDocument();

    expect(await screen.findByText('CONGRATULATIONS!', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText('YOU WON!')).toBeInTheDocument();
    const successRegion = await screen.findByRole('heading', { name: 'CONGRATULATIONS!' });
    const successSection = successRegion.closest('section');
    expect(successSection).not.toBeNull();
    expect(within(successSection as HTMLElement).getByText('Mixer Grinder')).toBeInTheDocument();
    expect(await screen.findByText('Claim ID:')).toBeInTheDocument();
    expect(await screen.findByText('DB26-654321')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('reveal-overlay')).toHaveAttribute('data-modal-state', 'RESULT');
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'CONGRATULATIONS!' })).toHaveFocus();
    });
  }, 12000);

  it('shows ANTICIPATION before BOX_REVEAL after success', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => successResponse,
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm('DB7777');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    expect(await screen.findByTestId('anticipation-view')).toBeInTheDocument();
    expect(screen.queryByTestId('reveal-view')).not.toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
      },
      { timeout: 2500 },
    );
  });

  it('honors configured ANTICIPATION timing before BOX_REVEAL transition', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => successResponse,
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm('DB7400');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    await waitFor(() => {
      expect(screen.getByTestId('anticipation-view')).toBeInTheDocument();
    }, { timeout: 1500 });

    const anticipationStart = Date.now();

    await waitFor(() => {
      expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
    }, { timeout: 2500 });

    const anticipationElapsedMs = Date.now() - anticipationStart;
    expect(anticipationElapsedMs).toBeGreaterThanOrEqual(650);
    expect(anticipationElapsedMs).toBeLessThanOrEqual(1350);
  });

  it('supports reduced motion path while preserving authoritative result', async () => {
    setupMatchMedia(true);
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ...successResponse, claimId: 'DB26-300001' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm('DB7001');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    await waitFor(() => {
      expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
      expect(screen.getByTestId('gift-box-hero')).toHaveAttribute('data-presentation-state', 'BOX_IDLE');
    }, { timeout: 2500 });

    expect(screen.queryByText('CONGRATULATIONS!')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('gift-box-hero'));

    expect(await screen.findByText('CONGRATULATIONS!')).toBeInTheDocument();
    expect(await screen.findByText('DB26-300001')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('gift-box-hero')).toBeDisabled();
    });
  });

  it('keeps reveal and result layers mounted during transition handoff', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ...successResponse, claimId: 'DB26-350001' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm('DB7051');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    await waitFor(() => {
      expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
    }, { timeout: 2500 });

    fireEvent.click(screen.getByTestId('gift-box-hero'));

    await waitFor(() => {
      expect(screen.getByTestId('reveal-overlay')).toHaveAttribute(
        'data-presentation-state',
        'RESULT_ENTERING',
      );
      expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
      expect(screen.getByTestId('result-view')).toBeInTheDocument();
    }, { timeout: 3500 });

    expect(await screen.findByText('DB26-350001', {}, { timeout: 3500 })).toBeInTheDocument();
  });

  it('commits to final RESULT via timer fallback when transitionend timing drifts', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ...successResponse, claimId: 'DB26-360001' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm('DB7061');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    await waitFor(() => {
      expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
    }, { timeout: 2500 });

    fireEvent.click(screen.getByTestId('gift-box-hero'));

    await waitFor(() => {
      expect(screen.getByTestId('reveal-overlay')).toHaveAttribute('data-modal-state', 'BOX_REVEAL');
      expect(screen.getByTestId('reveal-overlay')).toHaveAttribute(
        'data-presentation-state',
        'RESULT_ENTERING',
      );
    }, { timeout: 3500 });

    await waitFor(() => {
      expect(screen.getByTestId('reveal-overlay')).toHaveAttribute('data-modal-state', 'RESULT');
      expect(screen.getByText('DB26-360001')).toBeInTheDocument();
    }, { timeout: 2500 });
  });

  it('supports keyboard activation for gift box opening', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ...successResponse, claimId: 'DB26-440001' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm('DB7401');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    await waitFor(
      () => {
        expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
      },
      { timeout: 2500 },
    );

    const trigger = screen.getByRole('button', { name: 'Tap to open your lucky box' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(await screen.findByText('DB26-440001', {}, { timeout: 3500 })).toBeInTheDocument();
  });

  it('moves focus into overlay and returns focus to PLAY NOW after result action', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ...successResponse, claimId: 'DB26-450001' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm('DB7451');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    await waitFor(
      () => {
        expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
      },
      { timeout: 2500 },
    );

    const overlay = screen.getByRole('dialog', { name: 'Festive lucky reveal' });
    await waitFor(() => {
      expect(overlay).toHaveFocus();
    });

    fireEvent.click(screen.getByTestId('gift-box-hero'));
    expect(await screen.findByText('DB26-450001', {}, { timeout: 3500 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Play Another Draw' }));
    await waitFor(() => {
      const playNow = screen.getByRole('button', { name: 'PLAY NOW' });
      expect(playNow).toHaveFocus();
    });
  });

  it('prevents duplicate gift box activation during opening sequence', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ...successResponse, claimId: 'DB26-460001' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm('DB7461');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    await waitFor(
      () => {
        expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
      },
      { timeout: 2500 },
    );

    const trigger = screen.getByTestId('gift-box-hero');
    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect(trigger).toBeDisabled();
    expect(trigger).toHaveClass('is-open');
    expect(await screen.findByText('DB26-460001', {}, { timeout: 3500 })).toBeInTheDocument();
  });

  it('does not expose technical processing terminology to customers', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => successResponse,
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm('DB7999');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    await waitFor(() => {
      expect(screen.getByTestId('reveal-overlay')).toBeInTheDocument();
    });

    expect(screen.queryByText(/api/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/validating/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/processing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/eligibility check/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/lambda/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/database/i)).not.toBeInTheDocument();
  });

  it('renders already claimed state without success reveal', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        status: 'ALREADY_CLAIMED',
        claimId: 'DB26-100001',
        claimTimestamp: '2026-08-16T10:30:00.000Z',
        prize: {
          id: 'prize-001',
          name: 'Electric Kettle',
          displayName: 'Electric Kettle',
        },
        message: 'This bill has already been used for the lucky draw.',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    expect(
      await screen.findByText('This bill has already been used for the lucky draw.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Original Prize:')).toBeInTheDocument();
    expect(await screen.findByText('Electric Kettle')).toBeInTheDocument();
    expect(await screen.findByText('DB26-100001')).toBeInTheDocument();
  });

  it('renders draw ended state with campaign-consistent messaging', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        status: 'ERROR',
        code: 'DRAW_ENDED',
        message: 'The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter.',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    expect(
      await screen.findByText(
        'The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Draw Ended' })).toBeInTheDocument();
  });

  it('renders no eligible prize state without win messaging', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        status: 'ERROR',
        code: 'NO_ELIGIBLE_PRIZE',
        message: 'The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter.',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    expect(
      await screen.findByText(
        'The lucky draw has ended for this festive season. Please visit the Dutta Brothers counter.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No Eligible Prize' })).toBeInTheDocument();
  });

  it('maps API validation error fields from backend response', async () => {
    setupMatchMedia();
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        status: 'ERROR',
        code: 'VALIDATION_ERROR',
        message: 'Please check the form and try again.',
        fieldErrors: {
          phone: 'Phone number must contain exactly 10 digits.',
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    expect(await screen.findByText('Phone number must contain exactly 10 digits.')).toBeInTheDocument();
  });

  it('renders explicit API_ERROR state from backend and supports retry flow', async () => {
    setupMatchMedia();
    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({
          status: 'ERROR',
          code: 'API_ERROR',
          message: 'Service temporarily unavailable. Please retry.',
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ ...successResponse, claimId: 'DB26-200001' }),
      });

    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm('DB9001');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    expect(await screen.findByText('Service temporarily unavailable. Please retry.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(
      () => {
        expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByTestId('gift-box-hero'));
    expect(await screen.findByText('DB26-200001', {}, { timeout: 3500 })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('reuses Idempotency-Key on retry and rotates key for a new logical request', async () => {
    setupMatchMedia();
    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({
          status: 'ERROR',
          code: 'API_ERROR',
          message: 'Service temporarily unavailable. Please retry.',
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ ...successResponse, claimId: 'DB26-300010' }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ ...successResponse, claimId: 'DB26-300011' }),
      });
    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm('DB9201');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));
    expect(await screen.findByText('Service temporarily unavailable. Please retry.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
    }, { timeout: 3000 });
    fireEvent.click(screen.getByTestId('gift-box-hero'));
    expect(await screen.findByText('DB26-300010', {}, { timeout: 3500 })).toBeInTheDocument();

    const firstHeaders = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const retryHeaders = mockFetch.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders['idempotency-key']).toBeDefined();
    expect(retryHeaders['idempotency-key']).toBe(firstHeaders['idempotency-key']);

    fireEvent.click(screen.getByRole('button', { name: 'Play Another Draw' }));
    fillValidForm('DB9202');
    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    await waitFor(() => {
      expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
    }, { timeout: 3000 });
    const nextHeaders = mockFetch.mock.calls[2]?.[1]?.headers as Record<string, string>;
    expect(nextHeaders['idempotency-key']).toBeDefined();
    expect(nextHeaders['idempotency-key']).not.toBe(firstHeaders['idempotency-key']);
  });

  it('renders explicit NETWORK_ERROR state on transport failure and supports retry', async () => {
    setupMatchMedia();
    mockFetch
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        json: async () => ({ ...successResponse, claimId: 'DB26-200002' }),
      });

    vi.stubGlobal('fetch', mockFetch);

    render(<App />);
    goToForm();
    fillValidForm('DB9101');

    fireEvent.click(screen.getByRole('button', { name: 'PLAY NOW' }));

    expect(
      await screen.findByText('We could not complete the draw. Please check your connection and retry.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(
      () => {
        expect(screen.getByTestId('reveal-view')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByTestId('gift-box-hero'));
    expect(await screen.findByText('DB26-200002', {}, { timeout: 3500 })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([360, 375, 390, 430])('renders mobile flow shell and CTA at %ipx viewport', (width) => {
    setupMatchMedia();
    vi.stubGlobal('fetch', mockFetch);

    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,
    });
    window.dispatchEvent(new Event('resize'));

    render(<App />);
    goToForm();

    expect(screen.queryByTestId('gift-box-hero')).not.toBeInTheDocument();
    const cta = screen.getByRole('button', { name: 'PLAY NOW' });
    expect(cta).toBeInTheDocument();
    expect(screen.getByLabelText('Phone Number')).toHaveAttribute('inputmode', 'numeric');
    expect(cta).toHaveClass('primary-cta');
  });
});

