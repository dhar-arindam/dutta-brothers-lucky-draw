const frontendUrl = process.env.PRODUCTION_FRONTEND_URL;
const apiBaseUrl = process.env.PRODUCTION_API_BASE_URL;

if (!frontendUrl) {
  throw new Error('PRODUCTION_FRONTEND_URL is required for production smoke tests.');
}
if (!apiBaseUrl) {
  throw new Error('PRODUCTION_API_BASE_URL is required for production smoke tests.');
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

  const customerPage = await assertOk('Customer landing page', frontendUrl);
  const customerHtml = await customerPage.text();
  if (!customerHtml.includes('Lucky Draw')) {
    throw new Error('Customer landing content check failed.');
  }

  const adminPage = await assertOk('Admin page', `${frontendUrl.replace(/\/$/, '')}/admin`);
  const adminHtml = await adminPage.text();
  if (!adminHtml.includes('Lucky Draw Admin')) {
    throw new Error('Admin page content check failed.');
  }

  const campaignResponse = await assertOk('Campaign endpoint', `${apiBaseUrl.replace(/\/$/, '')}/api/admin/campaign`);
  const campaignJson = await campaignResponse.json();
  if (campaignJson.status !== 'SUCCESS') {
    throw new Error('Campaign endpoint did not return SUCCESS status.');
  }

  const apiProbe = await assertOk('API base route probe', `${apiBaseUrl.replace(/\/$/, '')}/api/admin/prizes`);
  const corsOrigin = apiProbe.headers.get('access-control-allow-origin');
  if (!corsOrigin) {
    throw new Error('CORS header missing on production API probe.');
  }

  console.log('Production smoke tests passed.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
