import { expect, test, type Page } from '@playwright/test';

const SUPABASE_ORIGIN = process.env.VITE_SUPABASE_URL || 'https://azzdesuowpdcoflmyezn.supabase.co';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

function base64Url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

const fakeJwt = [
  base64Url({ alg: 'none', typ: 'JWT' }),
  base64Url({ aud: 'authenticated', role: 'authenticated', sub: TEST_USER_ID, email: 'responsive@example.test', exp: Math.floor(Date.now() / 1000) + 3600 }),
  'e2e-signature',
].join('.');

const fakeSession = {
  access_token: fakeJwt,
  refresh_token: 'responsive-refresh-token',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user: { id: TEST_USER_ID, aud: 'authenticated', role: 'authenticated', email: 'responsive@example.test', user_metadata: {}, app_metadata: {} },
};

const fakeUser = {
  id: TEST_USER_ID,
  email: 'responsive@example.test',
  full_name: 'Responsive Admin',
  role: 'super_admin',
  is_active: true,
  branch_id: null,
  created_at: new Date().toISOString(),
};

async function mockAuthenticatedApp(page: Page) {
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
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
  await page.route(new RegExp(`${SUPABASE_ORIGIN.replace('.', '\\.')}/rest/v1/users(?:\\?.*)?$`), async (route) => {
    const accept = route.request().headers()['accept'] || '';
    const single = accept.includes('application/vnd.pgrst.object+json');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(single ? fakeUser : [fakeUser]) });
  });
  await page.route(new RegExp(`${SUPABASE_ORIGIN.replace('.', '\\.')}/rest/v1/roles(?:\\?.*)?$`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/**`, async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() || '';
    if (name === 'get_login_email') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, email: fakeSession.user.email }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
}

async function login(page: Page) {
  await page.goto('/#/login');
  await page.locator('#login-username').fill('responsive-admin');
  await page.locator('#login-pin').fill('1234');
  await page.locator('form').getByRole('button', { name: /دخول|تسجيل الدخول|Sign in/i }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
}

const viewports = [
  { name: 'small phone', width: 360, height: 800 },
  { name: 'tablet portrait', width: 768, height: 1024 },
  { name: 'tablet landscape', width: 1024, height: 768 },
  { name: 'desktop browser', width: 1366, height: 768 },
];

for (const viewport of viewports) {
  test(`app shell fits ${viewport.name} without page-level horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockAuthenticatedApp(page);
    await login(page);

    await expect(page.locator('header').first()).toBeVisible();
    await expect(page.locator('main').first()).toBeVisible();

    const metrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      direction: document.documentElement.dir,
    }));

    expect(metrics.direction).toBe('rtl');
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  });
}

test('critical shell and page actions remain clickable on a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockAuthenticatedApp(page);
  await login(page);

  const sidebarOpen = page.getByTestId('sidebar-open');
  await expect(sidebarOpen).toBeVisible();
  await sidebarOpen.click();
  await expect(page.getByTestId('sidebar-close')).toBeVisible();
  await expect(page.getByTestId('mobile-sidebar-backdrop')).toBeVisible();
  await page.getByTestId('sidebar-close').click();
  await expect(page.getByTestId('mobile-sidebar-backdrop')).toBeHidden();

  await expect(page.getByTestId('theme-toggle')).toBeVisible();
  await page.getByTestId('theme-toggle').click();

  await expect(page.getByTestId('active-orders-button')).toBeVisible();
  await page.getByTestId('active-orders-button').click();
  await expect(page).toHaveURL(/#\/floor-plan$/);
  await expect(page.getByTestId('active-orders-page')).toBeVisible();

  await page.goto('/#/products');
  await expect(page.getByTestId('products-page')).toBeVisible();
  await expect(page.getByTestId('products-add')).toBeVisible();
  await page.getByTestId('products-add').click();
  await expect(page).toHaveURL(/#\/products\/setup$/);

  await page.goto('/#/dashboard');
  await expect(page.getByTestId('user-menu-button')).toBeVisible();
  await page.getByTestId('user-menu-button').click();
  await expect(page).toHaveURL(/#\/settings$/);
});
