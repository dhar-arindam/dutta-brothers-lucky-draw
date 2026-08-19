const frontendUrl = process.env.STAGING_FRONTEND_URL;
const apiBaseUrl = process.env.STAGING_API_BASE_URL;

if (!frontendUrl) {
  throw new Error('STAGING_FRONTEND_URL is required for staging smoke tests.');
}
if (!apiBaseUrl) {
  throw new Error('STAGING_API_BASE_URL is required for staging smoke tests.');
}

const assertOk = async (label, url, init) => {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${label} failed with status ${response.status} for ${url}`);
  }
  return response;
};

const main = async () => {
  await assertOk('CloudFront frontend', frontendUrl);

  const adminResponse = await assertOk('Admin page', `${frontendUrl.replace(/\/$/, '')}/admin`);
  const adminHtml = await adminResponse.text();
  if (!adminHtml.includes('Lucky Draw Admin')) {
    throw new Error('Admin page content check failed.');
  }

  const campaignResponse = await assertOk('Campaign endpoint', `${apiBaseUrl.replace(/\/$/, '')}/api/admin/campaign`);
  const campaignJson = await campaignResponse.json();
  if (campaignJson.status !== 'SUCCESS') {
    throw new Error('Campaign endpoint did not return SUCCESS status.');
  }

  const prizesResponse = await assertOk('Admin prizes endpoint', `${apiBaseUrl.replace(/\/$/, '')}/api/admin/prizes`);
  const corsOrigin = prizesResponse.headers.get('access-control-allow-origin');
  if (!corsOrigin) {
    throw new Error('CORS header missing on admin prizes response.');
  }

  console.log('Staging smoke tests passed.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
