import { expect, test, type Page } from '@playwright/test';
import { mockSupabaseRealtime } from './mock-supabase-realtime';

const SUPABASE_ORIGIN = process.env.VITE_SUPABASE_URL || 'https://azzdesuowpdcoflmyezn.supabase.co';

const protectedRoutes = [
  '/dashboard', '/pos', '/floor-plan', '/kitchen', '/tables', '/products', '/inventory',
  '/warehouses', '/raw-materials', '/recipes', '/production', '/transfers', '/inventory-ledger',
  '/branches', '/purchases', '/customers', '/suppliers', '/expenses', '/sales', '/shifts',
  '/reports', '/financial-reports', '/accounting', '/accounts', '/payments', '/journal',
  '/treasury', '/reconciliation', '/users', '/employees', '/audit-log', '/settings',
  '/settings/basic', '/system-health', '/subscription', '/subscriptions',
];

async function mockUnauthenticatedBackend(page: Page) {
  await mockSupabaseRealtime(page);
  // Public smoke tests must never depend on the real Supabase project. The
  // authenticated POS/dashboard suites already provide their own backend mocks.
  // Keep this suite deterministic and focused on routing/login UI behavior.
  await page.route(`${SUPABASE_ORIGIN}/auth/v1/**`, async (route) => {
    const url = route.request().url();

    if (url.includes('/auth/v1/token')) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }),
      });
      return;
    }

    if (url.includes('/auth/v1/session')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: null, token_type: 'bearer', user: null }),
      });
      return;
    }

    if (url.includes('/auth/v1/user')) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'No session' }) });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route(`${SUPABASE_ORIGIN}/storage/v1/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test.describe('public application smoke', () => {
  test.beforeEach(async ({ page }) => {
    await mockUnauthenticatedBackend(page);
  });

  test('login page renders without browser console errors', async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/#/login');
    await expect(page.getByRole('heading', { name: /مرحباً بك|Welcome back/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /English|العربية/i })).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toBeVisible();

    await page.getByRole('button', { name: /English|العربية/i }).click();
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toHaveText(/Sign in/i);

    expect(consoleErrors).toEqual([]);

    // Native review captures of the supplied identity in both existing modes.
    for (const mode of ['light', 'dark']) {
      await page.evaluate((theme) => {
        localStorage.setItem('pos_theme', theme);
        localStorage.setItem('pos_lang', 'ar');
      }, mode);
      await page.reload();
      await expect(page.getByTestId('login-panel')).toBeVisible();
      for (const [name, width, height] of [['desktop', 1366, 900], ['mobile', 390, 844]] as const) {
        await page.setViewportSize({ width, height });
        await expect(page.getByTestId('login-panel')).toHaveCSS('opacity', '1');
        await testInfo.attach(`premier-${mode}-${name}`, {
          body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
        });
      }
    }
  });

  test('enabled organization signup opens from login without touching live Auth', async ({page})=>{
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/get_public_tenant_registration_status`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:true})}));
    await page.goto('/#/login');
    await page.getByRole('link',{name:/إنشاء مؤسسة جديدة|Create an organization/}).click();
    await expect(page).toHaveURL(/#\/register$/);
    await expect(page.getByTestId('organization-signup-form')).toBeVisible();
    await expect(page.locator('#signup-organization')).toBeVisible();
    await expect(page.locator('#signup-email')).toBeVisible();
    await page.setViewportSize({width:390,height:844});
    await expect(page.locator('#signup-confirm')).toBeVisible();
    await page.getByRole('button',{name:/العودة لتسجيل الدخول|Back to sign in/}).click();
    await expect(page).toHaveURL(/#\/login$/);
  });

  test('paused organization signup hides registration and blocks direct entry',async({page})=>{
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/get_public_tenant_registration_status`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:false})}));
    await page.goto('/#/register');
    await expect(page.getByText(/إنشاء المؤسسات الجديدة متوقف حاليًا|New organization registration is currently paused/)).toBeVisible();
    await expect(page.getByTestId('organization-signup-form')).toHaveCount(0);
    await page.getByRole('link',{name:/تسجيل الدخول|Sign in/}).click();
    await expect(page.getByRole('link',{name:/إنشاء مؤسسة جديدة|Create an organization/})).toHaveCount(0);
  });

  test('login validation blocks invalid PIN without leaving login', async ({ page }) => {
    await page.goto('/#/login');
    await page.locator('#login-username').fill('smoke-test');
    await page.locator('#login-pin').fill('12');
    await page.locator('form button[type="submit"]').click();

    await expect(page).toHaveURL(/#\/login$/);
    await expect(page.getByText(/4|أربع|four/i).first()).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toBeEnabled();
  });

  for (const route of protectedRoutes) {
    test(`protected route ${route} redirects unauthenticated users to login`, async ({ page }) => {
      await page.goto(`/#${route}`);
      await expect(page).toHaveURL(/#\/login$/);
      await expect(page.getByRole('heading', { name: /مرحباً بك|Welcome back/i })).toBeVisible();
    });
  }
});
