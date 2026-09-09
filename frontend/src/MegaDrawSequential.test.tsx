import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MegaDrawPage } from './MegaDrawPage';

const mockFetch = vi.fn();
const prizes = [
  { position: 1, name: 'Gold Coin' },
  { position: 2, name: 'Silver Coin' },
];
const campaign = {
  id: 'festive-2026',
  fromDate: '2026-08-01',
  toDate: '2026-10-31',
  timezone: 'Asia/Kolkata' as const,
  ended: true as const,
};
const row = {
  prize: prizes[0],
  candidate: {
    identity: 'BILL-1#9999912345',
    sourceClaimId: 'DB26-1',
    sourceClaimTimestamp: '2026-10-01T00:00:00.000Z',
    customerName: 'Amit Das',
    maskedPhone: '*****1234',
    billNumber: 'BILL-1',
  },
  selectedAt: '2026-12-01T12:00:00.000Z',
  candidatePoolCount: 4,
  sourceClaimStatus: 'ACTIVE' as const,
};
const lifecycle = {
  reference: 'MD-2026-001',
  executionYear: 2026,
  status: 'IN_PROGRESS' as const,
  campaign,
  prizes,
  selectedRows: [row],
  nextPrizeOrdinal: 2,
  remainingPrizes: [prizes[1]],
};
const success = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });

describe('sequential Mega Draw', () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it('runs the draw directly from the wheel with no confirmation prompt', async () => {
    mockFetch
      .mockResolvedValueOnce(success({ status: 'SUCCESS', configuration: [] }))
      .mockResolvedValueOnce(success({ status: 'SUCCESS', prizes }))
      .mockResolvedValueOnce(
        success({
          status: 'SUCCESS',
          preflight: {
            reference: 'PF-1',
            executionYear: 2026,
            expiresAt: '2026-12-01T12:05:00.000Z',
            candidateCount: 4,
            prizes,
            campaign,
          },
        }),
      )
      .mockResolvedValueOnce(success({ status: 'SUCCESS', lifecycle, selectedRow: row }));
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('crypto', { randomUUID: () => 'idempotency-1' });
    render(<MegaDrawPage />);
    await screen.findByRole('button', { name: 'Save configuration' });
    fireEvent.change(screen.getByLabelText('Mega prize 1'), { target: { value: 'Gold Coin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add prize' }));
    fireEvent.change(screen.getByLabelText('Mega prize 2'), { target: { value: 'Silver Coin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'Prepare draw' }).at(-1)!);
    await screen.findByText('Preflight summary');
    fireEvent.click(screen.getAllByRole('button', { name: 'Prepare draw' }).at(-1)!);
    const wheel = await screen.findByRole('button', { name: 'Draw next Mega prize: Silver Coin' });
    expect(wheel).toBeEnabled();
    fireEvent.click(wheel);
    expect(
      await screen.findByRole('heading', { name: 'Mega Draw in progress' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Amit Das (*****1234)')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Backend-provided prize wheel')).toHaveAttribute(
      'data-spoke-count',
      '2',
    );
    expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/admin/mega-draw/draw-next',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'idempotency-1' }),
        body: JSON.stringify({
          preflightReference: 'PF-1',
        }),
      }),
    );
  });

  it('labels icon-only prize controls for assistive technology and hover help', async () => {
    mockFetch.mockResolvedValueOnce(success({ status: 'SUCCESS', configuration: [] }));
    vi.stubGlobal('fetch', mockFetch);

    render(<MegaDrawPage />);

    const moveUp = await screen.findByRole('button', { name: 'Move prize 1 up' });
    expect(moveUp).toHaveAttribute('title', 'Move prize 1 up');
    expect(screen.getByRole('button', { name: 'Move prize 1 down' })).toHaveAttribute(
      'title',
      'Move prize 1 down',
    );
    expect(screen.getByRole('button', { name: 'Remove prize 1' })).toHaveAttribute(
      'title',
      'Remove prize 1',
    );
  });

  it('resumes a partial lifecycle with configuration locked', async () => {
    mockFetch.mockResolvedValueOnce(
      success({ status: 'SUCCESS', configuration: prizes, lifecycle }),
    );
    vi.stubGlobal('fetch', mockFetch);
    render(<MegaDrawPage />);
    expect(
      await screen.findByRole('heading', { name: 'Mega Draw in progress' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save configuration' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Configuration is locked after the first winner. Reset Mega Draw to make configuration editable again.',
      ),
    ).toBeInTheDocument();
  });

  it('resets to editable configuration after normal confirmation', async () => {
    mockFetch
      .mockResolvedValueOnce(success({ status: 'SUCCESS', configuration: prizes, lifecycle }))
      .mockResolvedValueOnce(success({ status: 'SUCCESS', executionYear: 2026 }))
      .mockResolvedValueOnce(success({ status: 'SUCCESS', configuration: prizes }));
    vi.stubGlobal('fetch', mockFetch);

    render(<MegaDrawPage />);

    await screen.findByRole('heading', { name: 'Mega Draw in progress' });
    fireEvent.click(screen.getByRole('button', { name: 'Reset Mega Draw' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Reset Mega Draw' });
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(dialog.querySelector('input')).not.toBeInTheDocument();
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(await screen.findByRole('button', { name: 'Save configuration' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Mega Draw in progress' }),
    ).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/admin/mega-draw/reset',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ acknowledgement: true, confirmation: 'RESET MEGA DRAW 2026' }),
      }),
    );
  });

  it('closes a completed draw after exact acknowledgement and retains its results read-only', async () => {
    const completed = {
      ...lifecycle,
      status: 'COMPLETED' as const,
      remainingPrizes: [],
      completedAt: '2026-12-01T12:00:00.000Z',
    };
    mockFetch
      .mockResolvedValueOnce(
        success({ status: 'SUCCESS', configuration: prizes, lifecycle: completed }),
      )
      .mockResolvedValueOnce(
        success({ status: 'SUCCESS', lifecycle: { ...completed, status: 'CLOSED' } }),
      );
    vi.stubGlobal('fetch', mockFetch);

    render(<MegaDrawPage />);
    await screen.findByRole('heading', { name: 'Mega Draw completed' });
    fireEvent.click(screen.getByRole('button', { name: 'Close Mega Draw' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(dialog.querySelector('input:not([type="checkbox"])')!, {
      target: { value: 'CLOSE MEGA DRAW 2026' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Mega Draw' }));

    expect(await screen.findByRole('heading', { name: 'Mega Draw closed' })).toBeInTheDocument();
    expect(screen.getByText('Amit Das (*****1234)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset Mega Draw' })).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/admin/mega-draw/close',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ acknowledgement: true, confirmation: 'CLOSE MEGA DRAW 2026' }),
      }),
    );
  });
});
