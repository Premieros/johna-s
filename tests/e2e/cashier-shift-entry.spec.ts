import { expect, test, type Page } from '@playwright/test';

const SUPABASE_ORIGIN = process.env.VITE_SUPABASE_URL || 'https://azzdesuowpdcoflmyezn.supabase.co';
const USER_ID = '00000000-0000-0000-0000-000000000101';
const BRANCH_ID = '00000000-0000-0000-0000-000000000110';
const WAREHOUSE_ID = '00000000-0000-0000-0000-000000000130';

const fakeUser = {
  id: USER_ID,
  email: 'cashier-e2e@example.test',
  full_name: 'E2E Cashier',
  role: 'cashier',
  is_active: true,
  branch_id: BRANCH_ID,
  created_at: new Date().toISOString(),
};

let openShiftPayload: Record<string, unknown> | null = null;

function base64Url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function makeSession() {
  const accessToken = [
    base64Url({ alg: 'none', typ: 'JWT' }),
    base64Url({ aud: 'authenticated', role: 'authenticated', sub: USER_ID, email: fakeUser.email, exp: Math.floor(Date.now() / 1000) + 3600 }),
    'e2e-signature',
  ].join('.');
  return {
    access_token: accessToken,
    refresh_token: 'e2e-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: fakeUser.email, user_metadata: {}, app_metadata: {} },
  };
}

async function mockCashierBackend(page: Page) {
  openShiftPayload = null;
  const session = makeSession();

  await page.route(`${SUPABASE_ORIGIN}/auth/v1/**`, async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/user')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session.user) });
    }
    if (url.includes('/auth/v1/token')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route(`${SUPABASE_ORIGIN}/rest/v1/users**`, async (route) => {
    // Supabase/PostgREST returns a JSON object for .maybeSingle() requests and
    // an array for normal collection reads. Mirror that behavior so permission
    // checks exercise the same user shape as production.
    const accept = route.request().headers()['accept'] || '';
    const single = accept.includes('application/vnd.pgrst.object+json');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(single ? fakeUser : [fakeUser]),
    });
  });
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/roles**`, async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        role: 'cashier',
        name: 'Cashier',
        permissions: ['dashboard.view', 'pos.view', 'pos.order.create', 'pos.order.edit', 'shifts.view', 'shifts.open'],
        is_system: true,
      }]),
    });
  });
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/branches**`, async (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: BRANCH_ID, name: 'E2E Branch', name_en: 'E2E Branch', is_active: true }]) });
  });
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/settings**`, async (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currency: 'EGP', tax_enabled: false, tax_rate: 0 }) });
  });
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/warehouses**`, async (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: WAREHOUSE_ID, branch_id: BRANCH_ID, is_active: true }]) });
  });
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/products**`, async (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/shifts**`, async (route) => {
    const headers = route.request().headers();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/0', ...('prefer' in headers ? {} : {}) },
      body: '[]',
    });
  });

  await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/**`, async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() || '';
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>; } catch { /* noop */ }

    if (name === 'get_login_email') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, email: fakeUser.email }) });
    }
    if (name === 'record_login_success' || name === 'record_login_failure') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    }
    if (name === 'get_active_shift') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, open: false }) });
    }
    if (name === 'get_pos_product_availability') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (name === 'open_shift') {
      openShiftPayload = payload;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, shift_id: '00000000-0000-0000-0000-000000000199' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
}

async function login(page: Page) {
  await page.goto('/#/login');
  await page.locator('#login-username').fill('e2e-cashier');
  await page.locator('#login-pin').fill('1234');
  await page.locator('form').getByRole('button', { name: /دخول|تسجيل الدخول|Sign in/i }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
}

test('cashier with no active shift gets a real open-shift workflow from POS', async ({ page }) => {
  await mockCashierBackend(page);
  await login(page);

  await page.goto('/#/pos');
  const shiftButton = page.getByTestId('pos-shift-button');
  await expect(shiftButton).toBeVisible({ timeout: 15000 });
  await expect(shiftButton).toHaveAttribute('title', /فتح وردية|Open Shift/i);

  await shiftButton.click();
  await expect(page).toHaveURL(/#\/shifts$/);
  await expect(page.getByTestId('shifts-page')).toBeVisible({ timeout: 10000 });

  const openButton = page.getByRole('button', { name: /فتح.*(?:وردية|شيفت)|Open Shift/i }).first();
  await expect(openButton).toBeVisible();
  await openButton.click();

  const openingInput = page.getByRole('spinbutton', { name: /المبلغ الافتتاحي|رصيد الافتتاح|Opening Amount/i });
  await expect(openingInput).toHaveCount(0);

  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: /فتح.*(?:وردية|شيفت)|Open Shift/i }).click();

  await expect.poll(() => openShiftPayload, { timeout: 10000 }).not.toBeNull();
  expect(openShiftPayload).toMatchObject({
    p_branch_id: BRANCH_ID,
    p_opening_amount: 0,
  });
});