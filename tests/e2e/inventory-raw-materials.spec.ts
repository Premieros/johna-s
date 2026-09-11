import { expect, test, type Page } from '@playwright/test';

const SUPABASE_ORIGIN = process.env.VITE_SUPABASE_URL || 'https://azzdesuowpdcoflmyezn.supabase.co';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000071';
const BRANCH_ID = '00000000-0000-0000-0000-000000000072';

function base64Url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

const fakeJwt = [
  base64Url({ alg: 'none', typ: 'JWT' }),
  base64Url({ aud: 'authenticated', role: 'authenticated', sub: TEST_USER_ID, exp: Math.floor(Date.now() / 1000) + 3600 }),
  'inventory-e2e-signature',
].join('.');

const fakeSession = {
  access_token: fakeJwt,
  refresh_token: 'inventory-refresh-token',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user: { id: TEST_USER_ID, aud: 'authenticated', role: 'authenticated', email: 'inventory@example.test', user_metadata: {}, app_metadata: {} },
};

const fakeUser = {
  id: TEST_USER_ID,
  email: 'inventory@example.test',
  full_name: 'Inventory Admin',
  role: 'super_admin',
  is_active: true,
  branch_id: BRANCH_ID,
  created_at: new Date().toISOString(),
};

const branch = {
  id: BRANCH_ID,
  name: 'فرع الاختبار',
  name_en: 'Test Branch',
  is_active: true,
};

async function mockInventoryBackend(page: Page) {
  await page.route(`${SUPABASE_ORIGIN}/auth/v1/**`, async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/user')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeSession.user) });
    }
    if (url.includes('/auth/v1/token')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeSession) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const accept = route.request().headers()['accept'] || '';
    const single = accept.includes('application/vnd.pgrst.object+json');

    if (path.endsWith('/users')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(single ? fakeUser : [fakeUser]) });
    }
    if (path.endsWith('/branches')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([branch]) });
    }
    if (path.endsWith('/raw_materials')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'raw-with-balance', branch_id: BRANCH_ID, name: 'دقيق', measurement_unit: { name: 'كيلوجرام', symbol: 'كجم', code: 'kg' } },
          { id: 'raw-zero-balance', branch_id: BRANCH_ID, name: 'سكر', measurement_unit: { name: 'كيلوجرام', symbol: 'كجم', code: 'kg' } },
        ]),
      });
    }
    if (path.endsWith('/raw_material_inventory')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'balance-1', raw_material_id: 'raw-with-balance', branch_id: BRANCH_ID, quantity: 8, avg_cost: 10, min_stock: 2 },
        ]),
      });
    }
    if (path.endsWith('/inventory') || path.endsWith('/warehouses') || path.endsWith('/product_components') || path.endsWith('/roles')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]', headers: { 'content-range': '0-0/0' } });
    }
    if (path.includes('/rpc/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

async function login(page: Page) {
  await page.goto('/#/login');
  await page.locator('#login-username').fill('inventory-admin');
  await page.locator('#login-pin').fill('1234');
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/#\/dashboard$/);
}

test('inventory shows catalog raw materials even when no balance row exists', async ({ page }) => {
  await mockInventoryBackend(page);
  await login(page);
  await page.goto('/#/inventory');

  await expect(page.getByTestId('inventory-page')).toBeVisible();
  await expect(page.getByTestId('raw-material-branch-stock-panel')).toBeVisible();
  await expect(page.getByTestId('raw-stock-row-raw-with-balance')).toContainText('دقيق');
  await expect(page.getByTestId('raw-stock-row-raw-with-balance')).toContainText('8');
  await expect(page.getByTestId('raw-stock-row-raw-zero-balance')).toContainText('سكر');
  await expect(page.getByTestId('raw-stock-row-raw-zero-balance')).toContainText(/رصيد صفر|Zero balance/);
});
