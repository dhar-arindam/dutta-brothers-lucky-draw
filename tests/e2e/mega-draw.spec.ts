import { expect, test, type Page, type Route } from '@playwright/test';

const session = {
  accessToken: 'e2e-admin-token',
  expiresAt: Date.now() + 60 * 60 * 1000,
};

const campaign = {
  id: 'festive-2026',
  fromDate: '2026-08-18',
  toDate: '2026-10-31',
  timezone: 'Asia/Kolkata' as const,
  ended: true as const,
};

const prizes = [
  { position: 1, name: 'Grand Television' },
  { position: 2, name: 'Premium Speaker' },
];

const firstLifecycle = {
  reference: 'MEGA-2026-001',
  executionYear: 2026,
  status: 'IN_PROGRESS' as const,
  campaign,
  prizes,
  selectedRows: [
    {
      prize: prizes[0],
      candidate: {
        sourceClaimId: 'DB26-100001',
        sourceClaimTimestamp: '2026-09-01T10:00:00.000Z',
        customerName: 'Arindam Dhar',
        maskedPhone: '******3210',
        billNumber: 'DB-100001',
      },
      selectedAt: '2026-11-01T10:00:00.000Z',
      candidatePoolCount: 12,
      sourceClaimStatus: 'ACTIVE' as const,
    },
  ],
  nextPrizeOrdinal: 2,
  remainingPrizes: [prizes[1]],
};

const json = (route: Route, body: unknown) =>
  route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });

const authenticate = async (page: Page) => {
  await page.addInitScript((storedSession) => {
    sessionStorage.setItem('dutta-draw-admin-auth', JSON.stringify(storedSession));
  }, session);
};

const installMegaDrawApi = async (
  page: Page,
  initialLifecycle: typeof firstLifecycle | null = null,
) => {
  let lifecycle = initialLifecycle;
  await page.route('**/api/admin/mega-draw**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (request.method() === 'GET' && pathname === '/api/admin/mega-draw') {
      await json(route, {
        status: 'SUCCESS',
        configuration: lifecycle ? prizes : [],
        lifecycle,
      });
      return;
    }

    if (request.method() === 'PUT' && pathname === '/api/admin/mega-draw/configuration') {
      await json(route, { status: 'SUCCESS', prizes });
      return;
    }

    if (request.method() === 'POST' && pathname === '/api/admin/mega-draw/preflight') {
      await json(route, {
        status: 'SUCCESS',
        preflight: {
          reference: 'PREFLIGHT-2026-001',
          executionYear: 2026,
          expiresAt: '2026-11-01T12:30:00.000Z',
          candidateCount: 12,
          prizes,
          campaign,
        },
      });
      return;
    }

    if (request.method() === 'POST' && pathname === '/api/admin/mega-draw/draw-next') {
      lifecycle = firstLifecycle;
      await json(route, {
        status: 'SUCCESS',
        lifecycle,
        selectedRow: firstLifecycle.selectedRows[0],
      });
      return;
    }

    if (request.method() === 'POST' && pathname === '/api/admin/mega-draw/reset') {
      lifecycle = null;
      await json(route, { status: 'SUCCESS', executionYear: 2026 });
      return;
    }

    if (request.method() === 'GET' && pathname.startsWith('/api/admin/mega-draw/status/')) {
      await json(route, { status: 'SUCCESS', execution: 'COMPLETED', lifecycle });
      return;
    }

    await route.fallback();
  });
};

test('keeps the authenticated Admin return navigation available', async ({ page }) => {
  await authenticate(page);
  await installMegaDrawApi(page);
  await page.goto('/admin/mega-draw');
  await page.getByRole('link', { name: 'Back to Admin' }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

test('configures, preflights, confirms, and reveals the next backend-selected winner', async ({
  page,
}) => {
  await authenticate(page);
  await installMegaDrawApi(page);

  await page.goto('/admin/mega-draw');
  await expect(page.getByRole('heading', { name: 'Mega Draw' })).toBeVisible();

  await page.getByLabel('Mega prize 1').fill(prizes[0].name);
  await page.getByRole('button', { name: 'Add prize' }).click();
  await page.getByLabel('Mega prize 2').fill(prizes[1].name);
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await page.getByRole('button', { name: 'Prepare draw' }).click();

  await expect(page.getByRole('heading', { name: 'Preflight summary' })).toBeVisible();
  await expect(page.getByText('12 eligible candidates for 2 prizes.')).toBeVisible();
  await page.getByRole('button', { name: 'Draw next winner' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').check();
  await dialog.getByLabel(/Type DRAW NEXT MEGA PRIZE 2026/).fill('DRAW NEXT MEGA PRIZE 2026');
  await dialog.getByRole('button', { name: 'Draw next winner' }).click();

  await expect(page.getByRole('heading', { name: 'Mega Draw in progress' })).toBeVisible();
  await expect(page.getByText('1. Grand Television', { exact: true })).toBeVisible();
  await expect(page.getByText('Arindam Dhar (******3210)')).toBeVisible();
  await expect(page.getByLabel('Backend-provided prize wheel')).toHaveAttribute(
    'data-spoke-count',
    '2',
  );
  await expect(page.getByText(/Reference: MEGA-2026-001/)).toBeVisible();
});

test('requires acknowledgement and exact confirmation before reset returns to editable configuration', async ({
  page,
}) => {
  await authenticate(page);
  await installMegaDrawApi(page, firstLifecycle);

  await page.goto('/admin/mega-draw');
  await page.getByRole('button', { name: 'Reset Mega Draw' }).click();

  const dialog = page.getByRole('dialog');
  const submit = dialog.getByRole('button', { name: 'Reset Mega Draw' });
  await expect(submit).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByLabel(/Type RESET MEGA DRAW 2026/).fill('RESET MEGA DRAW 2026');
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByRole('button', { name: 'Save configuration' })).toBeVisible();
  await expect(page.getByLabel('Mega prize 1')).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Mega Draw in progress' })).not.toBeVisible();
});
