import { expect, test, type Page } from '@playwright/test';
import { mockSupabaseRealtime } from './mock-supabase-realtime';

const SUPABASE_ORIGIN = process.env.VITE_SUPABASE_URL || 'https://azzdesuowpdcoflmyezn.supabase.co';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

function base64Url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

const fakeJwt = [
  base64Url({ alg: 'none', typ: 'JWT' }),
  base64Url({ aud: 'authenticated', role: 'authenticated', sub: TEST_USER_ID, email: 'e2e@example.test', exp: Math.floor(Date.now() / 1000) + 3600 }),
  'e2e-signature',
].join('.');

const fakeSession = {
  access_token: fakeJwt,
  refresh_token: 'e2e-refresh-token',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user: { id: TEST_USER_ID, aud: 'authenticated', role: 'authenticated', email: 'e2e@example.test', user_metadata: {}, app_metadata: {} },
};

const fakeUser = {
  id: TEST_USER_ID,
  email: 'e2e@example.test',
  full_name: 'E2E Admin',
  role: 'super_admin',
  is_active: true,
  branch_id: null,
  created_at: new Date().toISOString(),
};

async function mockAuthenticatedApp(page: Page) {
  await mockSupabaseRealtime(page);
  // Register broad mocks first; specific mocks below intentionally win because
  // Playwright matches the most recently registered route first.
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route(`${SUPABASE_ORIGIN}/rpc/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route(`${SUPABASE_ORIGIN}/auth/v1/**`, async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/user')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeSession.user) });
      return;
    }
    if (url.includes('/auth/v1/token')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeSession) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route(new RegExp(`${SUPABASE_ORIGIN.replace('.', '\\.')}/rest/v1/users(?:\\?.*)?$`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([fakeUser]) });
  });

  await page.route(new RegExp(`${SUPABASE_ORIGIN.replace('.', '\\.')}/rest/v1/roles(?:\\?.*)?$`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route(new RegExp(`${SUPABASE_ORIGIN.replace('.', '\\.')}/rest/v1/rpc/get_login_email(?:\\?.*)?$`), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, email: fakeSession.user.email }),
    });
  });

  await page.route(new RegExp(`${SUPABASE_ORIGIN.replace('.', '\\.')}/rest/v1/rpc/record_login_success(?:\\?.*)?$`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  await page.route(new RegExp(`${SUPABASE_ORIGIN.replace('.', '\\.')}/rest/v1/rpc/record_login_failure(?:\\?.*)?$`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
}

async function loginAsE2EAdmin(page: Page) {
  await page.goto('/#/login');
  await page.locator('#login-username').fill('e2e-admin');
  await page.locator('#login-pin').fill('1234');
  await page.locator('form').getByRole('button', { name: /دخول|تسجيل الدخول|Sign in/i }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
}

const NAV_GROUP_BY_ROUTE: Record<string, string> = {
  '/branches': 'operations',
  '/inventory-center': 'centers',
  '/pos': 'main',
};

async function clickRouteLink(page: Page, route: string) {
  const target = page.locator(`a[href="#${route}"]`).first();

  if (!(await target.isVisible().catch(() => false))) {
    const group = NAV_GROUP_BY_ROUTE[route];
    if (group) {
      const toggle = page.getByTestId(`nav-group-toggle-${group}`);
      await expect(toggle).toBeVisible();
      await toggle.click();
    }
  }

  await expect(target).toBeVisible();
  await target.click();
}

test.describe('dashboard and navigation actions', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedApp(page);
    await loginAsE2EAdmin(page);
  });

  test('dashboard renders the application shell without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

    await expect(page.locator('header').first()).toBeVisible();
    await expect(page.locator('main').first()).toBeVisible();
    await expect(page.locator(`a[href="#/dashboard"]`).first()).toBeVisible();
    await expect(page.locator(`a[href="#/pos"]`).first()).toBeVisible();
    await expect(page.locator(`a[href="#/inventory-center"]`).first()).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('sidebar navigation actions keep stable route targets', async ({ page }) => {
    const cases = ['/branches', '/inventory-center', '/pos'];
    for (const route of cases) {
      await clickRouteLink(page, route);
      await expect(page).toHaveURL(new RegExp(`#${route}$`));
      await page.goto('/#/dashboard');
    }
  });

  test('header actions are real actions, not placeholders', async ({ page }) => {
    const activeOrders = page.getByRole('button', { name: /الطلبات النشطة|Active orders/i }).first();
    await expect(activeOrders).toBeVisible();
    await activeOrders.click();
    await expect(page).toHaveURL(/#\/floor-plan$/);
    await page.goto('/#/dashboard');

    const themeButton = page.getByRole('button', { name: /تغيير المظهر|Toggle theme|Dark mode|Light mode/i }).first();
    await expect(themeButton).toBeVisible();
    await themeButton.click();
    await expect(page.locator('html')).toHaveAttribute('class', /dark/);

    await page.goto('/#/dashboard');
    const signOut = page.getByRole('button', { name: /تسجيل الخروج|Sign out/i }).first();
    await expect(signOut).toBeVisible();
    await signOut.click();
    await expect(page).toHaveURL(/#\/login$/);
  });
  test('dashboard opens Today and applies complete custom Cairo dates on phone and desktop', async ({ page }) => {
    const reads: Record<string, unknown>[] = [];
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/get_dashboard_sales_snapshot**`, async (route) => {
      reads.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: {}, previous: {} }) });
    });
    await expect(page.getByTestId('dashboard-range-today')).toHaveAttribute('aria-pressed', 'true');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByTestId('dashboard-range-custom').click();
      await page.getByTestId('dashboard-custom-from').fill('2026-09-01');
      await page.getByTestId('dashboard-custom-to').fill('2026-09-30');
      await page.getByTestId('dashboard-custom-period').getByRole('button', { name: /تطبيق|Apply/ }).click();
      await expect(page.getByTestId('dashboard-selected-dates')).toHaveText('2026-09-01 — 2026-09-30');
      await expect.poll(() => reads[reads.length - 1]?.p_current_to).toBe('2026-09-30T20:59:59.999Z');
      expect(reads[reads.length - 1]?.p_current_from).toBe('2026-08-31T21:00:00.000Z');
      await expect(page.getByTestId('dashboard-custom-period')).toHaveCount(0);
      await page.getByTestId('dashboard-range-previous_month').click();
      await expect(page.getByTestId('dashboard-range-previous_month')).toHaveAttribute('aria-pressed', 'true');
    }
  });

});