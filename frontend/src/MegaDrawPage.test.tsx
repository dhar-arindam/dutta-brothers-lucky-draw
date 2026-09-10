import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MegaDrawPage } from './MegaDrawPage';

const mockFetch = vi.fn();
const result = {
  reference: 'MD-2026-001',
  executionYear: 2026,
  status: 'FINALIZED',
  completedAt: '2026-12-01T12:00:00.000Z',
  campaign: {
    id: 'festive-2026',
    fromDate: '2026-08-01',
    toDate: '2026-10-31',
    timezone: 'Asia/Kolkata',
    ended: true,
  },
  prizes: [{ position: 1, name: 'Gold Coin' }],
  candidates: [],
  winners: [
    {
      prize: { position: 1, name: 'Gold Coin' },
      candidate: {
        identity: 'A#1',
        sourceClaimId: 'DB26-1',
        sourceClaimTimestamp: '2026-10-01T00:00:00.000Z',
        customerName: 'Amit Das',
        maskedPhone: '*****1234',
        billNumber: 'BILL-1',
      },
    },
  ],
};
const success = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });

describe.skip('legacy MegaDrawPage', () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it('saves configuration, requires exact execution confirmation, and shows backend winners', async () => {
    mockFetch
      .mockResolvedValueOnce(
        success({ status: 'SUCCESS', prizes: [{ position: 1, name: 'Gold Coin' }] }),
      )
      .mockResolvedValueOnce(
        success({
          status: 'SUCCESS',
          preflight: {
            reference: 'PF-1',
            executionYear: 2026,
            expiresAt: '2026-12-01T12:05:00.000Z',
            candidateCount: 4,
            prizes: [{ position: 1, name: 'Gold Coin' }],
            campaign: result.campaign,
          },
        }),
      )
      .mockResolvedValueOnce(success({ status: 'SUCCESS', result }));
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('crypto', { randomUUID: () => 'idempotency-1' });

    render(<MegaDrawPage />);
    await screen.findByRole('button', { name: 'Save configuration' });
    fireEvent.change(screen.getByLabelText('Mega prize 1'), { target: { value: 'Gold Coin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare draw' }));
    await screen.findByText('Preflight summary');
    fireEvent.click(screen.getByRole('button', { name: 'Run Mega Draw' }));
    const dialog = screen.getByRole('dialog');
    expect(screen.getAllByRole('button', { name: 'Run Mega Draw' })[1]).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(dialog.querySelector('input:not([type="checkbox"])')!, {
      target: { value: 'RUN MEGA DRAW 2026' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Run Mega Draw' })[1]!);
    expect(await screen.findByText('Amit Das (*****1234)')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/admin/mega-draw/execute',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': 'idempotency-1' }),
      }),
    );
  });

  it('recovers a lost execute response through attempt status without another execute request', async () => {
    mockFetch
      .mockResolvedValueOnce(success({ status: 'SUCCESS', configuration: [], audit: [] }))
      .mockResolvedValueOnce(
        success({ status: 'SUCCESS', prizes: [{ position: 1, name: 'Gold Coin' }] }),
      )
      .mockResolvedValueOnce(
        success({
          status: 'SUCCESS',
          preflight: {
            reference: 'PF-1',
            executionYear: 2026,
            expiresAt: '2026-12-01T12:05:00.000Z',
            candidateCount: 4,
            prizes: [{ position: 1, name: 'Gold Coin' }],
            campaign: result.campaign,
          },
        }),
      )
      .mockRejectedValueOnce(new Error('Network response was lost.'))
      .mockResolvedValueOnce(
        success({ status: 'SUCCESS', execution: 'FINALIZED', operation: 'EXECUTE', result }),
      );
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('crypto', { randomUUID: () => 'idempotency-1' });

    render(<MegaDrawPage />);
    await screen.findByRole('button', { name: 'Save configuration' });
    fireEvent.change(screen.getByLabelText('Mega prize 1'), { target: { value: 'Gold Coin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare draw' }));
    await screen.findByText('Preflight summary');
    fireEvent.click(screen.getByRole('button', { name: 'Run Mega Draw' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(dialog.querySelector('input:not([type="checkbox"])')!, {
      target: { value: 'RUN MEGA DRAW 2026' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Run Mega Draw' })[1]!);

    expect(await screen.findByText('Amit Das (*****1234)')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/admin/mega-draw/status/idempotency-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it('uses and persists the shared Admin theme preference', async () => {
    window.localStorage.setItem('dutta-draw-admin-theme', 'dark');
    mockFetch.mockResolvedValueOnce(
      success({
        status: 'SUCCESS',
        configuration: result.prizes,
        result,
        voidedResults: [],
        audit: [],
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    render(<MegaDrawPage />);

    await screen.findByText('Mega Draw completed');
    expect(screen.getByRole('button', { name: 'Switch to Light' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Light' }));
    expect(window.localStorage.getItem('dutta-draw-admin-theme')).toBe('light');
  });

  it('uses compact labelled controls for ordered prize rows', async () => {
    mockFetch.mockResolvedValueOnce(success({ status: 'SUCCESS', configuration: [], audit: [] }));
    vi.stubGlobal('fetch', mockFetch);

    render(<MegaDrawPage />);

    expect(await screen.findByRole('button', { name: 'Move prize 1 up' })).toHaveAttribute(
      'title',
      'Move prize 1 up',
    );
    expect(screen.getByRole('button', { name: 'Move prize 1 down' })).toHaveAttribute(
      'title',
      'Move prize 1 down',
    );
    expect(screen.getByRole('button', { name: 'Remove prize 1' })).toHaveAttribute(
      'title',
      'Remove prize 1',
    );
  });
});
