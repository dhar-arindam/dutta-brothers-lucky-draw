import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminPrizePage } from './AdminPrizePage';

const mockFetch = vi.fn();

const successJson = (payload: unknown) => ({
  ok: true,
  json: async () => payload,
  text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
});

const enqueueDashboardSuccess = () => {
  mockFetch
    .mockResolvedValueOnce(
      successJson({
        status: 'SUCCESS',
        totalSuccessfulSpins: 2,
        today: {
          date: '2026-08-16',
          successfulSpins: 1,
        },
        prizeDistribution: [
          {
            prizeId: 'prize-001',
            prizeName: 'Electric Kettle',
            givenCount: 1,
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      successJson({
        status: 'SUCCESS',
        campaign: {
          id: 'festive-2026',
          timezone: 'Asia/Kolkata',
          fromDate: '2026-08-01',
          toDate: '2026-11-01',
          status: 'ACTIVE',
        },
      }),
    )
    .mockResolvedValueOnce(
      successJson({
        status: 'SUCCESS',
        items: [
          {
            id: 'prize-001',
            name: 'Electric Kettle',
            weight: 1,
            active: true,
            givenCount: 1,
            createdAt: '2026-08-16T10:30:00.000Z',
            updatedAt: '2026-08-16T10:30:00.000Z',
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      successJson({
        status: 'SUCCESS',
        items: [
          {
            claimId: 'CLM-20260816-000001',
            claimTimestamp: '2026-08-16T10:30:00.000Z',
            customerName: 'Amit Das',
            maskedPhone: '*****1234',
            billNumber: 'AB123',
            prize: 'Electric Kettle',
          },
        ],
        nextPageToken: null,
      }),
    );
};

const waitForAutoLoad = async () => {
  await waitFor(() => {
    expect(screen.queryByText('Loading admin data...')).not.toBeInTheDocument();
  });
  expect(screen.getByRole('heading', { name: 'Lucky Draw Admin' })).toBeInTheDocument();
};

describe('admin operations page', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads admin data automatically without authentication step', async () => {
    enqueueDashboardSuccess();
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();
    expect(mockFetch).toHaveBeenCalled();
  });

  it('loads dashboard and shows prize + claim data', async () => {
    enqueueDashboardSuccess();
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    expect(screen.getAllByText('Electric Kettle').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Amit Das').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ACTIVE').length).toBeGreaterThan(0);
    expect(screen.getByText('Total Winners')).toBeInTheDocument();
    expect(screen.getByText('Today\'s Winners')).toBeInTheDocument();
    expect(screen.getByText('Prize names are fixed after creation and cannot be renamed.')).toBeInTheDocument();
    expect(screen.getByText('Weight is relative: for example, weight 10 has twice the draw chance of weight 5.')).toBeInTheDocument();
  });

  it('adds prize successfully and updates list', async () => {
    enqueueDashboardSuccess();
    mockFetch.mockResolvedValueOnce(
      successJson({
        status: 'SUCCESS',
        item: {
          id: 'prize-010',
          name: 'Mixer Grinder',
          weight: 5,
          active: true,
          givenCount: 0,
          createdAt: '2026-08-16T10:31:00.000Z',
          updatedAt: '2026-08-16T10:31:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.change(screen.getByLabelText('Prize Name'), {
      target: { value: 'Mixer Grinder' },
    });
    fireEvent.change(screen.getByLabelText('Weight', { selector: 'input#prize-weight' }), {
      target: { value: '5' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add Prize' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Prize added successfully.');
    expect(screen.getAllByText('Mixer Grinder').length).toBeGreaterThan(0);
  });

  it('deletes a claim after confirmation and reloads dashboard data', async () => {
    enqueueDashboardSuccess();
    mockFetch.mockResolvedValueOnce(successJson({ status: 'SUCCESS' }));
    mockFetch
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          totalSuccessfulSpins: 0,
          today: { date: '2026-08-16', successfulSpins: 0 },
          prizeDistribution: [],
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          campaign: {
            id: 'festive-2026',
            timezone: 'Asia/Kolkata',
            fromDate: '2026-08-01',
            toDate: '2026-11-01',
            status: 'ACTIVE',
          },
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          items: [
            {
              id: 'prize-001',
              name: 'Electric Kettle',
              weight: 1,
              active: true,
              givenCount: 0,
              createdAt: '2026-08-16T10:30:00.000Z',
              updatedAt: '2026-08-16T10:30:00.000Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(successJson({ status: 'SUCCESS', items: [], nextPageToken: null }));

    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete claim CLM-20260816-000001' })[0] as HTMLElement);

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Claim CLM-20260816-000001 deleted.');
    expect(screen.getByText('No claims yet.')).toBeInTheDocument();
  });

  it('does not delete a claim when confirmation is cancelled', async () => {
    enqueueDashboardSuccess();
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    const callCountBefore = mockFetch.mock.calls.length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete claim CLM-20260816-000001' })[0] as HTMLElement);

    expect(mockFetch.mock.calls.length).toBe(callCountBefore);
    expect(screen.getAllByText('Amit Das').length).toBeGreaterThan(0);
  });

  it('clears all claims after typed confirmation and reloads dashboard data', async () => {
    enqueueDashboardSuccess();
    mockFetch.mockResolvedValueOnce(successJson({ status: 'SUCCESS', deletedCount: 1 }));
    mockFetch
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          totalSuccessfulSpins: 0,
          today: { date: '2026-08-16', successfulSpins: 0 },
          prizeDistribution: [],
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          campaign: {
            id: 'festive-2026',
            timezone: 'Asia/Kolkata',
            fromDate: '2026-08-01',
            toDate: '2026-11-01',
            status: 'ACTIVE',
          },
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          items: [
            {
              id: 'prize-001',
              name: 'Electric Kettle',
              weight: 1,
              active: true,
              givenCount: 0,
              createdAt: '2026-08-16T10:30:00.000Z',
              updatedAt: '2026-08-16T10:30:00.000Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(successJson({ status: 'SUCCESS', items: [], nextPageToken: null }));

    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(window, 'prompt').mockReturnValue('CLEAR ALL CLAIMS');

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.click(screen.getByRole('button', { name: 'Clear All Claims' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Cleared 1 claim(s).');
    expect(screen.getByText('No claims yet.')).toBeInTheDocument();
  });

  it('does not clear claims when typed confirmation phrase is incorrect', async () => {
    enqueueDashboardSuccess();
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(window, 'prompt').mockReturnValue('nope');

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    const callCountBefore = mockFetch.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Clear All Claims' }));

    expect(mockFetch.mock.calls.length).toBe(callCountBefore);
    expect(screen.getAllByText('Amit Das').length).toBeGreaterThan(0);
  });

  it('rejects invalid add-prize form data', async () => {
    enqueueDashboardSuccess();
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.change(screen.getByLabelText('Weight', { selector: 'input#prize-weight' }), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Prize' }));

    expect(await screen.findByText('Prize name is required.')).toBeInTheDocument();
    expect(await screen.findByText('Weight must be a positive number.')).toBeInTheDocument();
  });

  it('updates prize weight', async () => {
    enqueueDashboardSuccess();
    mockFetch.mockResolvedValueOnce(
      successJson({
        status: 'SUCCESS',
        item: {
          id: 'prize-001',
          name: 'Electric Kettle',
          weight: 7,
          active: true,
          createdAt: '2026-08-16T10:30:00.000Z',
          updatedAt: '2026-08-16T10:31:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.change(screen.getByLabelText('Weight', { selector: 'input#weight-prize-001' }), {
      target: { value: '7' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Weight' })[0]);

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Weight updated. Weight is relative probability, not a percentage.');
  });

  it('toggles active status', async () => {
    enqueueDashboardSuccess();
    mockFetch.mockResolvedValueOnce(
      successJson({
        status: 'SUCCESS',
        item: {
          id: 'prize-001',
          name: 'Electric Kettle',
          weight: 1,
          active: false,
          createdAt: '2026-08-16T10:30:00.000Z',
          updatedAt: '2026-08-16T10:31:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.click(screen.getByLabelText('Active', { selector: 'input#active-prize-001' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Prize deactivated. It will be excluded from future draws.');
  });

  it('handles network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network failure'));
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We could not complete the admin request. Please try again.');
  }, 10000);

  it('loads admin requests with standard API calls on mount', async () => {
    enqueueDashboardSuccess();
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/summary',
        expect.objectContaining({
          headers: expect.objectContaining({
            'content-type': 'application/json',
          }),
        }),
      );
    });
  });

  it('refreshes admin data when Refresh is clicked', async () => {
    enqueueDashboardSuccess();
    enqueueDashboardSuccess();
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(8);
    });
  });

  it('does not render authentication controls', async () => {
    enqueueDashboardSuccess();
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);

    expect(screen.queryByLabelText(/token|password|login/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to dark/i })).toBeInTheDocument();
  });

  it('supports theme toggle and renders dark-theme controls', async () => {
    enqueueDashboardSuccess();
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Dark' }));
    expect(screen.getByRole('button', { name: 'Switch to Light' })).toBeInTheDocument();
  });

  it('renders ended campaign state detail from API payload', async () => {
    mockFetch
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          totalSuccessfulSpins: 0,
          today: { date: '2026-08-16', successfulSpins: 0 },
          prizeDistribution: [],
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          campaign: {
            id: 'festive-2026',
            timezone: 'Asia/Kolkata',
            fromDate: '2025-08-01',
            toDate: '2025-08-31',
            status: 'ENDED',
          },
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          items: [
            {
              id: 'prize-001',
              name: 'Electric Kettle',
              weight: 1,
              active: true,
              givenCount: 0,
              createdAt: '2026-08-16T10:30:00.000Z',
              updatedAt: '2026-08-16T10:30:00.000Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(successJson({ status: 'SUCCESS', items: [], nextPageToken: null }));
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    expect(screen.getByText('ENDED')).toBeInTheDocument();
    expect(screen.getByText('Customers can no longer participate.')).toBeInTheDocument();
  });

  it('renders not started campaign state detail from API payload date window', async () => {
    mockFetch
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          totalSuccessfulSpins: 0,
          today: { date: '2026-08-16', successfulSpins: 0 },
          prizeDistribution: [],
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          campaign: {
            id: 'festive-2026',
            timezone: 'Asia/Kolkata',
            fromDate: '2099-08-01',
            toDate: '2099-08-31',
            status: 'ACTIVE',
          },
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          items: [
            {
              id: 'prize-001',
              name: 'Electric Kettle',
              weight: 1,
              active: true,
              givenCount: 0,
              createdAt: '2026-08-16T10:30:00.000Z',
              updatedAt: '2026-08-16T10:30:00.000Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(successJson({ status: 'SUCCESS', items: [], nextPageToken: null }));
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    expect(screen.getByText('NOT STARTED')).toBeInTheDocument();
    expect(screen.getByText('Campaign has not started yet.')).toBeInTheDocument();
  });

  it('validates required campaign dates and rejects invalid range before API call', async () => {
    enqueueDashboardSuccess();
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.change(screen.getByLabelText('From Date'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('To Date'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('From Date is required.')).toBeInTheDocument();
    expect(await screen.findByText('To Date is required.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('From Date'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('To Date'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('To Date must be on or after From Date.')).toBeInTheDocument();
  });

  it('uses prize cards as claims filter with all-claims default view', async () => {
    enqueueDashboardSuccess();
    mockFetch.mockResolvedValueOnce(
      successJson({
        status: 'SUCCESS',
        items: [
          {
            claimId: 'CLM-20260816-000002',
            claimTimestamp: '2026-08-16T11:00:00.000Z',
            customerName: 'Riya Sen',
            maskedPhone: '*****7788',
            billNumber: 'AB124',
            prize: 'Electric Kettle',
          },
        ],
        nextPageToken: null,
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    expect(screen.queryByRole('button', { name: 'View Claims' })).not.toBeInTheDocument();

    expect(screen.getByLabelText('Prize')).toHaveValue('');

    fireEvent.click(screen.getByRole('radio', { name: 'Filter claims by Electric Kettle' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Prize')).toHaveValue('prize-001');
    });
    expect(screen.getAllByText('Riya Sen').length).toBeGreaterThan(0);
    expect(screen.getByRole('radio', { name: 'Filter claims by Electric Kettle' })).toHaveAttribute('aria-checked', 'true');
  });

  it('supports keyboard card selection and preserves filter when toggling active state', async () => {
    enqueueDashboardSuccess();
    mockFetch
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          items: [
            {
              claimId: 'CLM-20260816-000003',
              claimTimestamp: '2026-08-16T11:15:00.000Z',
              customerName: 'Keyboard User',
              maskedPhone: '*****5566',
              billNumber: 'AB126',
              prize: 'Electric Kettle',
            },
          ],
          nextPageToken: null,
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          item: {
            id: 'prize-001',
            name: 'Electric Kettle',
            weight: 1,
            active: false,
            givenCount: 1,
            createdAt: '2026-08-16T10:30:00.000Z',
            updatedAt: '2026-08-16T10:31:00.000Z',
          },
        }),
      );
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    const prizeCard = screen.getByRole('radio', { name: 'Filter claims by Electric Kettle' });
    prizeCard.focus();
    fireEvent.keyDown(prizeCard, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByLabelText('Prize')).toHaveValue('prize-001');
    });

    fireEvent.click(screen.getByLabelText('Active', { selector: 'input#active-prize-001' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Prize')).toHaveValue('prize-001');
    });
    expect(screen.getByRole('radio', { name: 'Filter claims by Electric Kettle' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByText('Keyboard User').length).toBeGreaterThan(0);
  });

  it('clears prize filter when Clear Filters is selected', async () => {
    enqueueDashboardSuccess();
    mockFetch
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          items: [
            {
              claimId: 'CLM-20260816-000004',
              claimTimestamp: '2026-08-16T11:20:00.000Z',
              customerName: 'Filtered User',
              maskedPhone: '*****1122',
              billNumber: 'AB127',
              prize: 'Electric Kettle',
            },
          ],
          nextPageToken: null,
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          items: [
            {
              claimId: 'CLM-20260816-000001',
              claimTimestamp: '2026-08-16T10:30:00.000Z',
              customerName: 'Amit Das',
              maskedPhone: '*****1234',
              billNumber: 'AB123',
              prize: 'Electric Kettle',
            },
          ],
          nextPageToken: null,
        }),
      );
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.click(screen.getByRole('radio', { name: 'Filter claims by Electric Kettle' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Prize')).toHaveValue('prize-001');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Prize')).toHaveValue('');
    });
    const clearedMessages = await screen.findAllByText('Filters cleared.');
    expect(clearedMessages.length).toBeGreaterThan(0);
  });

  it('copies claim id from desktop and shows copied feedback', async () => {
    enqueueDashboardSuccess();
    vi.stubGlobal('fetch', mockFetch);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<AdminPrizePage />);
  await waitForAutoLoad();

    fireEvent.click(screen.getAllByRole('button', { name: /Copy claim ID CLM-20260816-000001/i })[0]);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('CLM-20260816-000001');
    });
    expect(screen.getAllByText('Copied').length).toBeGreaterThan(0);
  });

  it('uses textarea fallback copy path when clipboard API is unavailable', async () => {
    enqueueDashboardSuccess();
    vi.stubGlobal('fetch', mockFetch);

    Object.defineProperty(window.navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      value: execCommand,
      configurable: true,
    });

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.click(screen.getAllByRole('button', { name: /Copy claim ID CLM-20260816-000001/i })[0]);

    await waitFor(() => {
      expect(execCommand).toHaveBeenCalledWith('copy');
    });
  });

  it('shows loading state while admin data is in-flight', async () => {
    mockFetch.mockImplementation(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);

    const loadingNodes = await screen.findAllByText('Loading admin data...');
    expect(loadingNodes.length).toBeGreaterThan(0);
  });

  it('shows empty states and filtered empty state messaging', async () => {
    mockFetch
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          totalSuccessfulSpins: 0,
          today: {
            date: '2026-08-16',
            successfulSpins: 0,
          },
          prizeDistribution: [],
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          campaign: {
            id: 'festive-2026',
            timezone: 'Asia/Kolkata',
            fromDate: '2026-08-01',
            toDate: '2026-11-01',
            status: 'ACTIVE',
          },
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          items: [
            {
              id: 'prize-001',
              name: 'Electric Kettle',
              weight: 1,
              active: true,
              givenCount: 0,
              createdAt: '2026-08-16T10:30:00.000Z',
              updatedAt: '2026-08-16T10:30:00.000Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(successJson({ status: 'SUCCESS', items: [], nextPageToken: null }))
      .mockResolvedValueOnce(successJson({ status: 'SUCCESS', items: [], nextPageToken: null }));
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    expect(screen.getByText('No claims yet.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'NoMatch' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Apply Filters' }).closest('form') as HTMLFormElement);

    expect(await screen.findByText('No claims match your filters.')).toBeInTheDocument();
  });

  it('shows generic error when initial admin payload shape is incomplete', async () => {
    mockFetch
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          totalSuccessfulSpins: 0,
          today: { date: '2026-08-16', successfulSpins: 0 },
          prizeDistribution: [],
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          campaign: {
            id: 'festive-2026',
            timezone: 'Asia/Kolkata',
            fromDate: '2026-08-01',
            toDate: '2026-11-01',
            status: 'ACTIVE',
          },
        }),
      )
      .mockResolvedValueOnce(successJson({ status: 'SUCCESS' }))
      .mockResolvedValueOnce(successJson({ status: 'SUCCESS', items: [], nextPageToken: null }));
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We could not complete the admin request. Please try again.');
  });

  it('supports next and previous claim pagination', async () => {
    mockFetch
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          totalSuccessfulSpins: 2,
          today: { date: '2026-08-16', successfulSpins: 1 },
          prizeDistribution: [],
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          campaign: {
            id: 'festive-2026',
            timezone: 'Asia/Kolkata',
            fromDate: '2026-08-01',
            toDate: '2026-11-01',
            status: 'ACTIVE',
          },
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          items: [
            {
              id: 'prize-001',
              name: 'Electric Kettle',
              weight: 1,
              active: true,
              givenCount: 1,
              createdAt: '2026-08-16T10:30:00.000Z',
              updatedAt: '2026-08-16T10:30:00.000Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          items: [
            {
              claimId: 'CLM-20260816-000001',
              claimTimestamp: '2026-08-16T10:30:00.000Z',
              customerName: 'Amit Das',
              maskedPhone: '*****1234',
              billNumber: 'AB123',
              prize: 'Electric Kettle',
            },
          ],
          nextPageToken: 'token-1',
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          items: [
            {
              claimId: 'CLM-20260816-000002',
              claimTimestamp: '2026-08-16T11:30:00.000Z',
              customerName: 'Riya Sen',
              maskedPhone: '*****7788',
              billNumber: 'AB124',
              prize: 'Electric Kettle',
            },
          ],
          nextPageToken: null,
        }),
      )
      .mockResolvedValueOnce(
        successJson({
          status: 'SUCCESS',
          items: [
            {
              claimId: 'CLM-20260816-000001',
              claimTimestamp: '2026-08-16T10:30:00.000Z',
              customerName: 'Amit Das',
              maskedPhone: '*****1234',
              billNumber: 'AB123',
              prize: 'Electric Kettle',
            },
          ],
          nextPageToken: 'token-1',
        }),
      );
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(screen.getAllByText('Riya Sen').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => {
      expect(screen.getAllByText('Amit Das').length).toBeGreaterThan(0);
    });
  });

  it('exports all data and renders last preview', async () => {
    enqueueDashboardSuccess();
    mockFetch.mockResolvedValueOnce(
      successJson('claimId,customerName\nCLM-20260816-000001,Amit Das'),
    );
    vi.stubGlobal('fetch', mockFetch);

    const createObjectURL = vi.fn(() => 'blob://claims');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    });

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.click(screen.getByRole('button', { name: 'Export All Data' }));

    expect(await screen.findByText('Last CSV Preview')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Last CSV Preview'));
    expect(screen.getByText(/claimId,customerName/)).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('shows validation error for invalid inline prize weight save', async () => {
    enqueueDashboardSuccess();
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.change(screen.getByLabelText('Weight', { selector: 'input#weight-prize-001' }), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Weight' })[0]);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Weight must be a positive number.');
  });

  it('saves campaign when valid', async () => {
    enqueueDashboardSuccess();
    mockFetch.mockResolvedValueOnce(
      successJson({
        status: 'SUCCESS',
        campaign: {
          id: 'festive-2026',
          timezone: 'Asia/Kolkata',
          fromDate: '2026-09-01',
          toDate: '2026-12-01',
          status: 'ACTIVE',
        },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.change(screen.getByLabelText('From Date'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To Date'), { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Campaign period updated successfully.');
  });

  it('shows error when filtered claims response is malformed', async () => {
    enqueueDashboardSuccess();
    mockFetch.mockResolvedValueOnce(successJson({ status: 'SUCCESS' }));
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.submit(screen.getByRole('button', { name: 'Apply Filters' }).closest('form') as HTMLFormElement);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We could not complete the admin request. Please try again.');
  });

  it('updates add-prize and claims filter input controls', async () => {
    enqueueDashboardSuccess();
    mockFetch
      .mockResolvedValueOnce(successJson({ status: 'SUCCESS', items: [], nextPageToken: null }))
      .mockResolvedValueOnce(successJson({ status: 'SUCCESS', items: [], nextPageToken: null }));
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    const activeForFuture = screen.getByLabelText('Active for future draws');
    expect(activeForFuture).toBeChecked();
    fireEvent.click(activeForFuture);
    expect(activeForFuture).not.toBeChecked();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Amit' } });
    fireEvent.change(screen.getByLabelText('Prize'), { target: { value: 'prize-001' } });
    fireEvent.change(screen.getByLabelText('From Date (Filter)'), {
      target: { value: '2026-08-16' },
    });
    fireEvent.change(screen.getByLabelText('To Date (Filter)'), {
      target: { value: '2026-08-16' },
    });
    fireEvent.change(screen.getByLabelText('Page Size'), { target: { value: '150' } });

    expect(screen.getByLabelText('Search')).toHaveValue('Amit');
    expect(screen.getByLabelText('Prize')).toHaveValue('prize-001');
    expect(screen.getByLabelText('From Date (Filter)')).toHaveValue('2026-08-16');
    expect(screen.getByLabelText('To Date (Filter)')).toHaveValue('2026-08-16');
    expect(screen.getByLabelText('Page Size')).toHaveValue('150');

    fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('from=2026-08-16T00%3A00%3A00.000Z'),
        expect.any(Object),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('to=2026-08-16T23%3A59%3A59.999Z'),
        expect.any(Object),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
    const clearedMessages = await screen.findAllByText('Filters cleared.');
    expect(clearedMessages.length).toBeGreaterThan(0);
  });

  it.each([360, 375, 390, 430])('supports prize card filter flow at mobile width %ipx', async (width) => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    window.dispatchEvent(new Event('resize'));

    enqueueDashboardSuccess();
    mockFetch.mockResolvedValueOnce(
      successJson({
        status: 'SUCCESS',
        items: [
          {
            claimId: 'CLM-20260816-000009',
            claimTimestamp: '2026-08-16T11:10:00.000Z',
            customerName: 'Mobile User',
            maskedPhone: '*****8899',
            billNumber: 'MB001',
            prize: 'Electric Kettle',
          },
        ],
        nextPageToken: null,
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    render(<AdminPrizePage />);
    await waitForAutoLoad();

    fireEvent.click(screen.getByRole('radio', { name: 'Filter claims by Electric Kettle' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Prize')).toHaveValue('prize-001');
    });
    expect(screen.getAllByText('Mobile User').length).toBeGreaterThan(0);
  });
});
