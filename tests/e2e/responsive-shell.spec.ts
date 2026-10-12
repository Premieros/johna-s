import { expect, test, type Page } from '@playwright/test';
import { mockSupabaseRealtime } from './mock-supabase-realtime';

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
  await mockSupabaseRealtime(page);
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
  { name: 'compact phone', width: 320, height: 720 },
  { name: 'small phone', width: 360, height: 800 },
  { name: 'standard phone', width: 390, height: 844 },
  { name: 'large phone', width: 430, height: 932 },
  { name: 'tablet portrait', width: 768, height: 1024 },
  { name: 'tablet landscape', width: 1024, height: 768 },
  { name: 'desktop browser', width: 1366, height: 768 },
  { name: 'large desktop', width: 1920, height: 1080 },
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

  await page.getByTestId('sidebar-open').click();
  await expect(page.getByTestId('mobile-theme-toggle')).toBeVisible();
  await page.getByTestId('mobile-theme-toggle').click();
  await page.getByTestId('sidebar-close').click();
  await expect(page.getByTestId('mobile-sidebar-backdrop')).toBeHidden();

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


test('mobile thumb navigation and full controls remain reachable on a compact phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await mockAuthenticatedApp(page);
  await login(page);

  const quickNav = page.getByTestId('mobile-bottom-nav');
  await expect(quickNav).toBeVisible();
  await expect(page.getByTestId('mobile-nav-dashboard')).toBeVisible();
  await expect(page.getByTestId('mobile-bottom-more')).toBeVisible();

  await page.getByTestId('mobile-bottom-more').click();
  await expect(page.getByTestId('mobile-sidebar-controls')).toBeVisible();
  await expect(page.getByTestId('mobile-branch-select')).toBeVisible();
  await expect(page.getByTestId('mobile-language-toggle')).toBeVisible();
  await expect(page.getByTestId('mobile-theme-toggle')).toBeVisible();
  await expect(page.getByTestId('mobile-sign-out')).toBeVisible();

  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bottomNavBottom: Math.round(
      window.innerHeight - (document.querySelector('[data-testid="mobile-bottom-nav"]')?.getBoundingClientRect().bottom || 0),
    ),
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(Math.abs(metrics.bottomNavBottom)).toBeLessThanOrEqual(1);
});

test('phone-only bottom navigation gives way to the tablet shell at 768px', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await mockAuthenticatedApp(page);
  await login(page);

  await expect(page.getByTestId('mobile-bottom-nav')).toBeHidden();
  await expect(page.getByTestId('sidebar-open')).toBeVisible();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  test(`document scrolling and pressed feedback remain usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockAuthenticatedApp(page);
    await login(page);
    await expect(page.getByTestId('app-main')).toBeVisible();
    await expect(page.getByTestId('page-progress-loader')).toBeHidden();
    // Give the real shell deterministic overflow independent of empty mocked reports.
    await page.getByTestId('app-main').evaluate((element) => {
      const spacer = document.createElement('div');
      spacer.style.height = '3000px';
      element.appendChild(spacer);
    });
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, 450);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await page.mouse.wheel(0, -450);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(100);

    const action = viewport.width < 1024
      ? page.getByTestId('sidebar-open')
      : page.getByTestId('theme-toggle');
    await action.hover();
    await page.mouse.down();
    await expect.poll(() => action.evaluate((element) => getComputedStyle(element).filter)).toContain('brightness');
    await page.mouse.up();
    if (viewport.width < 1024) {
      await expect(page.getByTestId('mobile-sidebar-backdrop')).toBeVisible();
      await page.getByTestId('sidebar-close').click();
      await expect(page.getByTestId('mobile-sidebar-backdrop')).toBeHidden();
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.wheel(0, 450);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    }
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }]) {
  test(`shared dialog scrolls independently and navigation recovers at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockAuthenticatedApp(page);
    await login(page);
    await page.goto('/#/categories');
    await expect(page.getByTestId('categories-add')).toBeVisible();
    await page.getByTestId('categories-add').click();
    const body = page.getByTestId('modal-body');
    await expect(body).toBeVisible();
    await body.evaluate((element) => {
      const spacer = document.createElement('div');
      spacer.style.height = '2500px';
      element.appendChild(spacer);
    });
    const bounds = await body.boundingBox();
    if (!bounds) throw new Error('Dialog scroll body is absent');
    const initialPageScroll = await page.evaluate(() => window.scrollY);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, 500);
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    expect(await page.evaluate(() => window.scrollY)).toBe(initialPageScroll);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByTestId('modal-root')).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    await page.getByTestId('active-orders-button').click();
    await expect(page).toHaveURL(/#\/floor-plan$/);
    await expect(page.getByTestId('active-orders-page')).toBeVisible();
  });
}

test.describe('sidebar gesture ownership without retries', () => {
  test.describe.configure({ retries: 0 });
  for (const width of [390, 1366]) {
    test(`closed sidebar releases document gestures repeatedly at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await mockAuthenticatedApp(page);
      await login(page);
      await expect(page.getByTestId('page-progress-loader')).toBeHidden();
      await page.getByTestId('app-main').evaluate((element) => {
        const spacer = document.createElement('div');
        spacer.style.height = '3000px';
        element.appendChild(spacer);
      });
      const sidebar = page.getByTestId('app-sidebar');
      for (let cycle = 0; cycle < 6; cycle += 1) {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        if (width < 1024) {
          await page.getByTestId('sidebar-open').click();
          await expect(sidebar).toHaveCSS('pointer-events', 'auto');
          await page.getByTestId('sidebar-close').click();
          await expect(page.getByTestId('mobile-sidebar-backdrop')).toBeHidden();
        } else {
          if (cycle > 0) await page.getByTestId('desktop-sidebar-toggle').click();
          await expect(sidebar).toHaveCSS('pointer-events', 'auto');
          await page.getByTestId('desktop-sidebar-hide').click();
        }
        // Do not wait for the closing transform: closed state must release
        // input even while the 200ms animation is still on screen.
        await expect(sidebar).toHaveCSS('pointer-events', 'none');
        const point = width < 1024 ? { x: width / 2, y: 422 } : { x: width - 130, y: 422 };
        expect(await page.evaluate(({ x, y }) =>
          !!document.elementFromPoint(x, y)?.closest('[data-testid="app-sidebar"]'), point)).toBe(false);
        await page.mouse.move(point.x, point.y);
        await page.mouse.wheel(0, 450);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
      }
    });
  }
});
