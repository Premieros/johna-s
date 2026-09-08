import { expect, test, type Locator, type Page } from '@playwright/test';

const SUPABASE_ORIGIN = process.env.VITE_SUPABASE_URL || 'https://azzdesuowpdcoflmyezn.supabase.co';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

const ROUTES = [
  '/dashboard', '/subscription', '/pos', '/operations', '/inventory-center', '/procurement-center',
  '/manufacturing-center', '/waste-center', '/kitchen-display', '/kitchen-stations', '/products',
  '/categories', '/components', '/inventory-units', '/branches', '/customers', '/suppliers', '/expenses',
  '/costing', '/accounts', '/payments', '/journal', '/treasury', '/reconciliation', '/financial-reports',
  '/sales', '/shifts', '/reports', '/users', '/subscriptions', '/audit-log', '/settings', '/raw-materials',
  '/recipes', '/production', '/warehouses', '/transfers', '/inventory-ledger', '/stock-counts',
  '/inventory-batches', '/stock-valuation', '/low-stock-alerts', '/inventory', '/purchases',
  '/purchases/requests', '/purchases/rfqs', '/purchases/receiving', '/floor-plan', '/system-health',
] as const;

function base64Url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

const fakeJwt = [
  base64Url({ alg: 'none', typ: 'JWT' }),
  base64Url({ aud: 'authenticated', role: 'authenticated', sub: TEST_USER_ID, email: 'journey@example.test', exp: Math.floor(Date.now() / 1000) + 3600 }),
  'journey-signature',
].join('.');

const fakeSession = {
  access_token: fakeJwt,
  refresh_token: 'journey-refresh-token',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user: { id: TEST_USER_ID, aud: 'authenticated', role: 'authenticated', email: 'journey@example.test', user_metadata: {}, app_metadata: {} },
};

const fakeUser = {
  id: TEST_USER_ID,
  email: 'journey@example.test',
  full_name: 'Journey Super Admin',
  username: 'journey-admin',
  role: 'super_admin',
  is_active: true,
  branch_id: null,
  created_at: new Date().toISOString(),
};

async function mockAuthenticatedApp(page: Page) {
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, email: fakeSession.user.email }) });
  });

  for (const rpc of ['record_login_success', 'record_login_failure']) {
    await page.route(new RegExp(`${SUPABASE_ORIGIN.replace('.', '\\.')}/rest/v1/rpc/${rpc}(?:\\?.*)?$`), async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
  }

  await page.route(new RegExp(`${SUPABASE_ORIGIN.replace('.', '\\.')}/rest/v1/rpc/get_pos_order_operator_labels(?:\\?.*)?$`), async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  page.on('dialog', async (dialog) => { await dialog.dismiss(); });
}

async function login(page: Page) {
  await page.goto('/#/login');
  await page.locator('#login-username').fill('journey-admin');
  await page.locator('#login-pin').fill('1234');
  await page.locator('form').getByRole('button', { name: /دخول|تسجيل الدخول|Sign in/i }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
}

async function openRoute(page: Page, route: string) {
  if (/#\/login$/.test(page.url())) {
    await login(page);
  }

  const resetRoute = route === '/dashboard' ? '/system-health' : '/dashboard';

  // Keep the authenticated SPA instance alive. A full page.goto() reload can
  // discard the mocked in-memory auth state and create false /login failures.
  await page.evaluate((hash) => { window.location.hash = hash; }, resetRoute);
  await page.waitForTimeout(80);
  await page.evaluate((hash) => { window.location.hash = hash; }, route);
  await page.waitForTimeout(120);

  // Several legacy routes intentionally redirect to their canonical pages.
  // The audit is concerned with a usable rendered destination, not preserving
  // the legacy hash verbatim.
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('body')).not.toHaveText(/^\s*$/);
  await expect(page).not.toHaveURL(/#\/login$/);
}

async function pageButtons(page: Page): Promise<Locator> {
  const main = page.locator('main:visible').first();
  if (await main.count()) return main.locator('button:visible');
  return page.locator('body button:visible');
}

async function buttonName(button: Locator) {
  const aria = (await button.getAttribute('aria-label'))?.trim();
  if (aria) return aria;
  const title = (await button.getAttribute('title'))?.trim();
  if (title) return title;
  return (await button.innerText()).replace(/\s+/g, ' ').trim();
}

async function dismissModalIfPresent(page: Page) {
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(80);

  const overlay = page.locator('div.fixed.inset-0.z-50:visible').last();
  if (!(await overlay.count())) return;

  const close = overlay.getByRole('button', { name: /إغلاق|إلغاء|رجوع|Close|Cancel|×|✕/i }).last();
  if (await close.count()) {
    await close.click({ timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(80);
  }

  if (await overlay.count()) {
    await page.keyboard.press('Escape').catch(() => undefined);
  }
}

for (const route of ROUTES) {
  test(`user journey: ${route} opens and its visible page buttons do not crash`, async ({ page }) => {
    test.setTimeout(90_000);

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await mockAuthenticatedApp(page);
    await login(page);
    await openRoute(page, route);

    expect(pageErrors, `page errors while opening ${route}`).toEqual([]);
    expect(consoleErrors, `console errors while opening ${route}`).toEqual([]);

    const initialButtons = await pageButtons(page);
    const initialCount = await initialButtons.count();

    for (let index = 0; index < initialCount; index += 1) {
      await openRoute(page, route);
      await dismissModalIfPresent(page);

      const buttons = await pageButtons(page);
      if (index >= await buttons.count()) continue;

      const button = buttons.nth(index);
      if (await button.isDisabled()) continue;

      const name = await buttonName(button);
      expect(name, `unnamed enabled button at ${route} index ${index}`).not.toBe('');

      const errorsBefore = pageErrors.length;
      const consoleBefore = consoleErrors.length;

      await button.scrollIntoViewIfNeeded();
      const actionable = await button.click({ trial: true, timeout: 1_000 }).then(() => true).catch(() => false);
      if (!actionable) continue;

      await button.click({ timeout: 5_000 });
      await page.waitForTimeout(120);
      await dismissModalIfPresent(page);

      expect(pageErrors.slice(errorsBefore), `page error after clicking "${name}" on ${route}`).toEqual([]);
      expect(consoleErrors.slice(consoleBefore), `console error after clicking "${name}" on ${route}`).toEqual([]);
      await expect(page.locator('body')).not.toHaveText(/^\s*$/);
    }
  });
}

test('user journey: redirect aliases resolve without blank pages', async ({ page }) => {
  await mockAuthenticatedApp(page);
  await login(page);

  const aliases = ['/kitchen', '/tables', '/accounting', '/employees', '/settings/basic'];
  for (const alias of aliases) {
    await openRoute(page, alias);
  }
});