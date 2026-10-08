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

  test('operational reports request 100-row pages with full totals on phone and desktop', async ({ page }) => {
    const reads: Record<string, unknown>[] = [];
    let fullSalesReads = 0;
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/sales**`, async route => {
      fullSalesReads += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/get_operational_report_page**`, async route => {
      const args = route.request().postDataJSON(); reads.push(args);
      const start = Number(args.p_page) * 100;
      const rows = Array.from({ length: Math.min(100, 205 - start) }, (_, i) => ({
        id: `p-${start + i}`, invoice_number: `PAGE-${start + i}`, created_at: '2026-10-06T08:00:00Z',
        total: 10, paid_amount: 10, refunded_amount: 0, status: 'completed',
      }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, summary: { total: 2050, count: 205 } }) });
    });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#/reports');
      // Same-hash navigation keeps the prior page; start each viewport from a fresh document.
      await page.reload();
      const results = width < 640 ? page.getByTestId('reports-mobile-results') : page.getByRole('table');
      await expect(results.getByText('PAGE-0', { exact: true })).toBeVisible();
      expect(reads[reads.length - 1]?.p_page_size).toBe(100);
      const pager = page.getByRole('navigation', { name: /صفحات التقرير|Report pages/ });
      await expect(pager).toContainText('205');
      await pager.getByRole('button', { name: /التالي|Next/ }).click();
      await expect(results.getByText('PAGE-100', { exact: true })).toBeVisible();
      expect(reads[reads.length - 1]?.p_page).toBe(1);
      await expect(pager).toContainText('205');
      expect(fullSalesReads).toBe(0);
    }
  });

  test('report tools share the canonical dataset and compare compact server totals', async ({ page }) => {
    const rows=Array.from({length:205},(_,index)=>({id:`tool-${index}`,invoice_number:`TOOL-${index}`,created_at:'2026-10-06T08:00:00Z',subtotal:10,total:10,paid_amount:10,refunded_amount:0,status:'completed'}));
    let datasetReads=0; let metricReads=0; let directSalesReads=0;
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/sales**`,async route=>{directSalesReads++;await route.fulfill({status:200,contentType:'application/json',body:'[]'});});
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/get_operational_report_page**`,async route=>{
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({rows:rows.slice(0,100),summary:{total:2050,count:205}})});
    });
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/get_operational_report_dataset**`,async route=>{
      datasetReads++; await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({rows,summary:{total:2050,count:205}})});
    });
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/get_operational_report_metrics**`,async route=>{
      metricReads++;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({'Subtotal':1000,'Discount':0,'Tax':0,'Invoice Total':1000,'Paid':1000,'Refunded':0,'Net Sales':1000,'Net Collection':1000})});
    });
    await page.goto('/#/reports');
    await expect(page.getByRole('table').getByText('TOOL-0',{exact:true})).toBeVisible();
    expect(datasetReads).toBe(0);
    const tools=page.getByTestId('report-workbench');
    await tools.getByRole('button',{name:/أدوات الجدول والتحليل الكامل|Table tools & full analysis/}).click();
    await expect(tools.getByText(/205 (صف|rows) \/ 205/)).toBeVisible();
    await tools.getByRole('button',{name:/مقارنة بالفترة السابقة|Compare previous period/}).click();
    await expect(tools.getByText(/الفترة المقارنة:|Comparison period:/)).toBeVisible();
    expect(metricReads).toBe(1); expect(datasetReads).toBe(1);
    await tools.locator('summary').click();
    await tools.getByRole('textbox',{name:/الفاتورة فلتر|Invoice filter/}).fill('TOOL-204');
    await expect(tools.getByRole('button',{name:'TOOL-204',exact:true})).toBeVisible();
    const download=page.waitForEvent('download');
    await tools.getByRole('button',{name:'CSV',exact:true}).click();
    await download;
    expect(datasetReads).toBe(1); expect(directSalesReads).toBe(0);
  });

  test('KDS separates 40-minute work and completed history and finishes only an empty voided order on phone and desktop', async ({ page }) => {
    const branch = '00000000-0000-0000-0000-000000000010';
    let finished = false;
    const historyReads: Record<string, unknown>[] = [];
    const finishReads: Record<string, unknown>[] = [];
    let ordinaryStatusWrites = 0;
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/branches**`, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: branch, name: 'KDS Test', is_active: true }]) });
    });
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/get_my_kitchen_stations**`, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: branch, code: 'main', name_ar: 'مطبخ', name_en: 'Kitchen', is_active: true }]) });
    });
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/get_kitchen_queue**`, async route => {
      const rows = [{ order_id: 'recent', order_number: 'RECENT-KDS', station: 'main', kitchen_status: 'sent', created_at: new Date(Date.now() - 60000).toISOString(), elapsed_seconds: 60, items: [{ product_name: 'Meal', quantity: 1 }] }];
      if (!finished) rows.push({ order_id: 'empty', order_number: 'VOIDED-KDS', station: 'main', kitchen_status: 'cooking', created_at: new Date(Date.now() - 3000000).toISOString(), elapsed_seconds: 3000, items: [], notes: '- Kitchen void: 1x Product' } as typeof rows[number]);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    });
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/get_kitchen_completed_history**`, async route => {
      const args = route.request().postDataJSON(); historyReads.push(args);
      const start = Number(args.p_page) * 100;
      const rows = Array.from({ length: Math.min(100, 205 - start) }, (_, i) => ({ order_id: `h-${start + i}`, order_number: `DONE-${start + i}`, kitchen_status: 'served', updated_at: new Date().toISOString() }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, count: 205 }) });
    });
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/finish_empty_kitchen_order**`, async route => {
      finishReads.push(route.request().postDataJSON()); finished = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, changed: true }) });
    });
    await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/set_kitchen_status**`, async route => {
      ordinaryStatusWrites += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    });
    for (const width of [390, 1280]) {
      finished = false;
      const historyCount = historyReads.length;
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#/kitchen-display');
      await page.reload();
      await expect(page.getByText('#RECENT-KDS', { exact: true })).toBeVisible();
      await expect(page.getByText('#VOIDED-KDS', { exact: true })).toHaveCount(0);
      expect(historyReads.length).toBe(historyCount);
      await page.getByRole('tab', { name: /تجاوزت 40 دقيقة|Over 40 minutes/ }).click();
      await expect(page.getByText('#VOIDED-KDS', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: /إنهاء الطلب الملغي الخالي من الأصناف|Finish empty voided order/ }).click();
      await expect(page.getByText('#VOIDED-KDS', { exact: true })).toHaveCount(0);
      expect(finishReads[finishReads.length - 1]).toEqual({ p_order_id: 'empty', p_branch_id: branch });
      expect(ordinaryStatusWrites).toBe(0);
      await page.getByRole('tab', { name: /منتهية|Completed/ }).click();
      await expect(page.getByText('#DONE-0', { exact: true })).toBeVisible();
      const pager = page.getByRole('navigation', { name: /صفحات الطلبات المنتهية|Completed order pages/ });
      await expect(pager).toContainText('205');
      await pager.getByRole('button', { name: /التالي|Next/ }).click();
      await expect(page.getByText('#DONE-100', { exact: true })).toBeVisible();
      expect(historyReads[historyReads.length - 1]?.p_page).toBe(1);
    }
  });

});