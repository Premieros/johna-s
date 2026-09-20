import { expect, test, type Page } from '@playwright/test';

const SUPABASE_ORIGIN = process.env.VITE_SUPABASE_URL || 'https://azzdesuowpdcoflmyezn.supabase.co';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const BRANCH_ID = '00000000-0000-0000-0000-000000000010';
const SECOND_BRANCH_ID = '00000000-0000-0000-0000-000000000011';
const PRODUCT_ID = '00000000-0000-0000-0000-000000000020';
const WAREHOUSE_ID = '00000000-0000-0000-0000-000000000030';
const TABLE_ID = '00000000-0000-0000-0000-000000000040';
const SHIFT_ID = '00000000-0000-0000-0000-000000000050';
const ORDER_ID = '00000000-0000-0000-0000-000000000060';
const ORDER_ITEM_ID = '00000000-0000-0000-0000-000000000061';
const SEND_ID = '00000000-0000-0000-0000-000000000062';

const fakeUser = { id: TEST_USER_ID, email: 'e2e@example.test', full_name: 'E2E Admin', role: 'super_admin', is_active: true, branch_id: BRANCH_ID, created_at: new Date().toISOString() };
const branches = [
  { id: BRANCH_ID, name: 'E2E Branch', name_en: 'E2E Branch', is_active: true },
  { id: SECOND_BRANCH_ID, name: 'Second Branch', name_en: 'Second Branch', is_active: true },
];
const product = { id: PRODUCT_ID, branch_id: BRANCH_ID, name: 'E2E Burger', name_en: 'E2E Burger', sku: 'E2E-001', barcode: '628000000020', sale_price: 100, product_type: 'simple', category_id: null, is_active: true, low_stock_threshold: 5 };
const diningTable = { id: TABLE_ID, branch_id: BRANCH_ID, area_id: null, name: 'Table 1', capacity: 4, status: 'vacant', shape: 'square', layout: { x: 0, y: 0, w: 120, h: 120 }, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };

let rpcCalls: string[] = [];
let rpcPayloads: Record<string, unknown[]> = {};

function base64Url(value: unknown) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function makeSession() {
  const accessToken = [base64Url({ alg: 'none', typ: 'JWT' }), base64Url({ aud: 'authenticated', role: 'authenticated', sub: TEST_USER_ID, email: fakeUser.email, exp: Math.floor(Date.now() / 1000) + 3600 }), 'e2e-signature'].join('.');
  return { access_token: accessToken, refresh_token: 'e2e-refresh-token', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: TEST_USER_ID, aud: 'authenticated', role: 'authenticated', email: fakeUser.email, user_metadata: {}, app_metadata: {} } };
}

async function mockPosBackend(page: Page) {
  rpcCalls = [];
  rpcPayloads = {};
  const session = makeSession();
  let currentOrder: Record<string, unknown> | null = null;
  let currentItems: Array<Record<string, unknown>> = [];
  let sentQuantity = 0;

  const orderRow = () => currentOrder || {
    id: ORDER_ID,
    branch_id: BRANCH_ID,
    order_number: 'E2E-001',
    order_type: 'takeaway',
    table_id: null,
    customer_id: null,
    guest_count: null,
    notes: null,
    status: 'open',
    cashier_id: TEST_USER_ID,
    subtotal: currentItems.reduce((sum, item) => sum + Number(item.total || item.quantity || 0) * (item.total ? 1 : 100), 0),
    discount_amount: 0,
    discount_type: 'amount',
    tax_amount: 0,
    total: currentItems.reduce((sum, item) => sum + Number(item.total || item.quantity || 0) * (item.total ? 1 : 100), 0),
    inventory_warehouse_id: WAREHOUSE_ID,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await page.route(`${SUPABASE_ORIGIN}/auth/v1/**`, async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/user')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session.user) });
    if (url.includes('/auth/v1/token')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/users**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([fakeUser]) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/products**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([product]) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/customers**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/categories**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/branches**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(branches) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/settings**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currency: 'EGP', tax_enabled: false, tax_rate: 0 }) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/warehouses**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: WAREHOUSE_ID, branch_id: BRANCH_ID, is_active: true }]) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/inventory**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ product_id: PRODUCT_ID, quantity: 20 }]) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/product_components**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/dining_tables**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([diningTable]) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/orders**`, async (r) => {
    const accept = r.request().headers()['accept'] || '';
    const wantsObject = accept.includes('vnd.pgrst.object');
    if (!currentOrder) return r.fulfill({ status: 200, contentType: 'application/json', body: wantsObject ? 'null' : '[]' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wantsObject ? currentOrder : [currentOrder]) });
  });
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/order_items**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentOrder ? currentItems.map((item, index) => ({
    id: index === 0 ? ORDER_ITEM_ID : `00000000-0000-0000-0000-${String(70 + index).padStart(12, '0')}`,
    order_id: ORDER_ID,
    product_id: item.product_id || PRODUCT_ID,
    unit_name: item.unit_name || 'piece',
    quantity: Number(item.quantity || 1),
    unit_price: Number(item.unit_price || 100),
    discount_amount: Number(item.discount_amount || 0),
    modifier_option_ids: item.modifier_option_ids || [],
    notes: item.notes || null,
  })) : []) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/order_kitchen_sends**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sentQuantity > 0 ? [{
    id: SEND_ID,
    branch_id: BRANCH_ID,
    order_id: ORDER_ID,
    order_item_id: ORDER_ITEM_ID,
    sent_at: new Date().toISOString(),
    sent_by: TEST_USER_ID,
    sent_quantity: sentQuantity,
  }] : []) }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/kitchen_sends**`, async (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`${SUPABASE_ORIGIN}/rest/v1/rpc/**`, async (r) => {
    const name = new URL(r.request().url()).pathname.split('/').pop() || '';
    rpcCalls.push(name);
    let requestPayload: Record<string, unknown> = {};
    try { requestPayload = JSON.parse(r.request().postData() || '{}') as Record<string, unknown>; } catch { requestPayload = {}; }
    rpcPayloads[name] = [...(rpcPayloads[name] || []), requestPayload];
    if (name === 'get_login_email') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, email: fakeUser.email }) });
    if (name === 'record_login_success' || name === 'record_login_failure') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    if (name === 'get_active_shift') return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        open: true,
        shared: true,
        shift: {
          id: SHIFT_ID,
          branch_id: BRANCH_ID,
          cashier_id: TEST_USER_ID,
          opened_at: new Date().toISOString(),
          opening_amount: 0,
          expected: 0,
        },
      }),
    });
    if (name === 'get_pos_product_availability') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ product_id: PRODUCT_ID, available_quantity: 20, is_available: true }]) });
    if (name === 'get_pos_cart_product_availability') {
      const items = Array.isArray(requestPayload.p_items) ? requestPayload.p_items as Array<{ product_id?: string; quantity?: number }> : [];
      const reserved = items
        .filter((item) => item.product_id === PRODUCT_ID)
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const available = Math.max(0, 20 - reserved);
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ product_id: PRODUCT_ID, available_quantity: available, is_available: available > 0 }]) });
    }
    if (name === 'get_pos_order_operator_labels') return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (name === 'create_order' || name === 'update_order') {
      const nextItems = Array.isArray(requestPayload.p_items) ? requestPayload.p_items as Array<Record<string, unknown>> : currentItems;
      currentItems = nextItems;
      currentOrder = {
        ...orderRow(),
        id: ORDER_ID,
        order_number: 'E2E-001',
        branch_id: BRANCH_ID,
        status: 'open',
        cashier_id: TEST_USER_ID,
        inventory_warehouse_id: WAREHOUSE_ID,
        subtotal: currentItems.reduce((sum, item) => sum + Number(item.quantity || 1) * Number(item.unit_price || 100), 0),
        total: currentItems.reduce((sum, item) => sum + Number(item.quantity || 1) * Number(item.unit_price || 100), 0),
      };
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, id: ORDER_ID, order_id: ORDER_ID, order_number: 'E2E-001' }) });
    }
    if (name === 'send_to_kitchen') {
      sentQuantity = Math.max(1, currentItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0));
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          id: SEND_ID,
          order_id: ORDER_ID,
          order_number: 'E2E-001',
          warehouse_id: WAREHOUSE_ID,
          sent: [{
            send_id: SEND_ID,
            order_item_id: ORDER_ITEM_ID,
            product_id: PRODUCT_ID,
            product_name: product.name,
            unit_name: 'piece',
            station_code: 'kitchen',
            quantity: sentQuantity,
            unit_price: 100,
            discount_amount: 0,
            bonus_quantity: 0,
            total: sentQuantity * 100,
            notes: null,
            modifiers: [],
          }],
          items_sent_count: 1,
          all_sent: true,
        }),
      });
    }
    if (name === 'get_order_settlement_preview') {
      const quantity = Math.max(1, sentQuantity);
      const total = quantity * 100;
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          order_id: ORDER_ID,
          branch_id: BRANCH_ID,
          warehouse_id: WAREHOUSE_ID,
          order_status: 'open',
          items: [{
            product_id: PRODUCT_ID,
            unit_name: 'piece',
            quantity,
            unit_price: 100,
            discount_amount: 0,
            bonus_quantity: 0,
            total,
            modifier_option_ids: [],
            notes: null,
            order_item_id: ORDER_ITEM_ID,
          }],
          subtotal: total,
          discount_amount: 0,
          discount_type: 'amount',
          tax_amount: 0,
          total,
          pending_quantity: quantity,
          unsent_quantity: 0,
          has_payable_items: true,
        }),
      });
    }
    if (name === 'next_sale_document_number') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, number: 'E2E-INV-001' }) });
    if (name === 'process_sale') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sale_id: 'e2e-sale-id', order_completed: true }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, id: ORDER_ID, order_id: ORDER_ID, order_number: 'E2E-001', sale_id: 'e2e-sale-id' }) });
  });
}

async function login(page: Page) {
  await page.goto('/#/login');
  await page.locator('#login-username').fill('e2e-admin');
  await page.locator('#login-pin').fill('1234');
  await page.locator('form').getByRole('button', { name: /دخول|تسجيل الدخول|Sign in/i }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
}

async function addProduct(page: Page) {
  await page.waitForLoadState('networkidle');
  const productCard = page.getByTestId(`pos-product-card-${PRODUCT_ID}`);
  await expect(productCard.getByText('E2E Burger', { exact: true })).toBeVisible({ timeout: 10000 });
  const addButton = productCard.getByRole('button', { name: /^(إضافة|Add)$/i });
  await expect(addButton).toBeEnabled({ timeout: 10000 });
  await addButton.click({ timeout: 10000 });
  await expect(page.getByTestId(`pos-cart-qty-${PRODUCT_ID}`)).toHaveText('1', { timeout: 10000 });
  expect(rpcCalls).not.toContain('get_pos_cart_product_availability');
  await expect(addButton).toBeEnabled({ timeout: 10000 });
}

async function sendCurrentOrderToKitchen(page: Page) {
  await page.getByTestId('pos-action-send-kitchen').click();
  await expect(page.getByText(/إرسال للمطبخ \(1\)|Sent to kitchen \(1\)/i)).toBeVisible({ timeout: 10000 });
  await expect.poll(() => rpcCalls.includes('send_to_kitchen'), { timeout: 10000 }).toBe(true);
  await expect(page.getByTestId('pos-action-pay')).toBeVisible({ timeout: 10000 });
}

function tableButton(page: Page) {
  return page.getByRole('button', { name: new RegExp(diningTable.name, 'i') });
}

test.describe('POS action-level', () => {
  test.beforeEach(async ({ page }) => {
    await mockPosBackend(page);
    await login(page);
    const posLink = page.getByRole('link', { name: /نقطة البيع|POS/i }).first();
    await expect(posLink).toBeVisible({ timeout: 10000 });
    await posLink.click();
    await expect(page).toHaveURL(/#\/pos$/);
    await page.getByTestId('pos-action-new-order').click();
    await expect(page.getByTestId('pos-tables-landing-actions')).toBeVisible({ timeout: 15000 });
    await expect(tableButton(page)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('body')).not.toHaveText(/Error Loading Data|خطأ في تحميل البيانات/i);
  });

  test('starts quick pickup, adds product, changes quantity, sends to kitchen, and opens payment', async ({ page }) => {
    await page.getByTestId('pos-start-quick-order').click();
    await addProduct(page);
    await page.getByTestId(`pos-cart-qty-increase-${PRODUCT_ID}`).click();
    await expect(page.getByTestId(`pos-cart-qty-${PRODUCT_ID}`)).toHaveText('2');
    await expect(page.getByTestId('pos-action-pay')).toHaveCount(0);
    await sendCurrentOrderToKitchen(page);
    await page.getByTestId('pos-action-pay').click();
    await expect(page.getByTestId('pos-payment-confirm')).toBeVisible();
    await expect(page.getByTestId('pos-payment-method-cash')).toBeVisible();
  });

  test('keeps the rebuilt mobile POS dock, order sheet, totals, and payment usable on a small phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByTestId('pos-start-quick-order').click();

    await expect(page.getByTestId('pos-mobile-command-dock')).toBeVisible();
    const productCard = page.getByTestId(`pos-product-card-${PRODUCT_ID}`);
    await productCard.getByRole('button', { name: /^(إضافة|Add)$/i }).click();

    await page.getByTestId('pos-mobile-nav-order').click();
    await expect(page.getByTestId('pos-mobile-order-sheet')).toBeVisible();
    await expect(page.locator(`[data-testid="pos-cart-qty-${PRODUCT_ID}"]:visible`)).toHaveText('1');
    await expect(page.locator('[data-testid="pos-total-value"]:visible')).toContainText('100');

    const sheet = page.getByTestId('pos-mobile-order-sheet-panel');
    const sheetBounds = await sheet.boundingBox();
    expect(sheetBounds).not.toBeNull();
    expect(sheetBounds!.x).toBeGreaterThanOrEqual(0);
    expect(sheetBounds!.x + sheetBounds!.width).toBeLessThanOrEqual(361);

    await page.getByTestId('pos-mobile-order-close').click();
    await expect(page.getByTestId('pos-mobile-order-sheet')).toBeHidden();

    await expect(page.getByTestId('pos-action-pay')).toHaveCount(0);
    await sendCurrentOrderToKitchen(page);
    await page.getByTestId('pos-action-pay').click();

    await expect(page.getByTestId('pos-mobile-order-sheet')).toBeVisible();
    await expect(page.getByTestId('pos-payment-panel')).toBeVisible();
    await expect(page.getByTestId('pos-payment-method-cash')).toBeVisible();
    await expect(page.getByTestId('pos-payment-confirm')).toBeVisible();

    const checkoutBounds = await page.getByTestId('pos-payment-confirm').boundingBox();
    expect(checkoutBounds).not.toBeNull();
    expect(checkoutBounds!.x).toBeGreaterThanOrEqual(0);
    expect(checkoutBounds!.x + checkoutBounds!.width).toBeLessThanOrEqual(361);

    const widths = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      dockBottom: Math.round(
        window.innerHeight - (document.querySelector('[data-testid="pos-mobile-command-dock"]')?.getBoundingClientRect().bottom || 0),
      ),
    }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
    expect(Math.abs(widths.dockBottom)).toBeLessThanOrEqual(1);

    await page.getByTestId('pos-payment-method-cash').click();
    await page.getByTestId('pos-payment-confirm').click();
    await expect.poll(() => rpcCalls.includes('process_sale'), { timeout: 10000 }).toBe(true);
  });

  test('keeps fullscreen POS inside compact, standard, and large phone widths', async ({ page }) => {
    for (const viewport of [
      { width: 320, height: 720 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.getByTestId('pos-workspace')).toBeVisible();
      await expect(page.getByTestId('pos-mobile-command-dock')).toBeVisible();

      const metrics = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      expect(metrics.document).toBeLessThanOrEqual(metrics.viewport + 1);
      expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1);
    }
  });

  test('shares the active branch between fullscreen POS and the global header selector', async ({ page }) => {
    await page.getByLabel(/المزيد|More/i).click();
    const posBranchSelector = page.locator('select').filter({ has: page.locator(`option[value="${SECOND_BRANCH_ID}"]`) });
    await expect(posBranchSelector).toHaveValue(BRANCH_ID);
    await posBranchSelector.selectOption(SECOND_BRANCH_ID);

    await page.goto('/#/dashboard');
    await expect(page.getByTestId('branch-indicator')).toContainText('Second Branch');
    await page.getByTestId('branch-indicator').click();
    await page.getByTestId(`branch-option-${BRANCH_ID}`).click();
    await expect(page.getByTestId('branch-indicator')).toContainText('E2E Branch');

    await page.getByRole('link', { name: /نقطة البيع|POS/i }).first().click();
    await expect(page).toHaveURL(/#\/pos$/);
    await page.getByLabel(/المزيد|More/i).click();
    await expect(page.locator('select').filter({ has: page.locator(`option[value="${SECOND_BRANCH_ID}"]`) })).toHaveValue(BRANCH_ID);
  });

  test('vacant table starts a dine-in order directly from the landing floor', async ({ page }) => {
    await tableButton(page).click();
    await expect(page.getByText('E2E Burger', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('pos-tables-landing-actions')).toBeHidden();
  });

  test('drive-thru captures plate and starts the order action', async ({ page }) => {
    await page.getByTestId('pos-tables-start-drive-thru').click();
    await page.getByTestId('pos-drive-thru-plate').fill('ABC-1234');
    await page.getByTestId('pos-drive-thru-customer').fill('Drive Customer');
    await page.getByTestId('pos-drive-thru-people').fill('2');
    await page.getByTestId('pos-drive-thru-start').click();
    await expect(page.getByTestId('pos-drive-thru-plate')).toBeHidden();
    await expect(page.getByRole('button', { name: /E2E Burger/i })).toBeVisible({ timeout: 10000 });
  });

  test('delivery captures phone and address and starts the order action', async ({ page }) => {
    await page.getByTestId('pos-tables-start-delivery').click();
    await page.getByTestId('pos-delivery-phone').fill('01000000000');
    await page.getByTestId('pos-delivery-address').fill('E2E Address');
    await page.getByTestId('pos-delivery-notes').fill('Leave at door');
    await page.getByTestId('pos-delivery-start').click();
    await expect(page.getByTestId('pos-delivery-phone')).toBeHidden();
    await expect(page.getByRole('button', { name: /E2E Burger/i })).toBeVisible({ timeout: 10000 });
  });

  test('discount action changes the order total', async ({ page }) => {
    await page.getByTestId('pos-start-quick-order').click();
    await addProduct(page);
    await expect(page.getByTestId('pos-total-value')).toContainText('100');
    await page.getByTestId('pos-action-discount').click();
    await expect(page.getByTestId('pos-discount-editor')).toBeVisible();
    await page.getByTestId('pos-discount-percent').click();
    await page.getByTestId('pos-discount-input').fill('10');
    await expect(page.getByTestId('pos-discount-value')).toContainText('10');
    await expect(page.getByTestId('pos-total-value')).toContainText('90');
  });

  test('hold action persists the order and changes it to held', async ({ page }) => {
    await page.getByTestId('pos-start-quick-order').click();
    await addProduct(page);
    await page.getByTestId('pos-action-hold').click();
    await expect(page.getByTestId('pos-action-hold')).toBeVisible();
    await expect.poll(() => rpcCalls.includes('create_order'), { timeout: 10000 }).toBe(true);
    await expect.poll(() => rpcCalls.includes('set_order_status'), { timeout: 10000 }).toBe(true);
    const statusPayload = (rpcPayloads.set_order_status?.[0] || {}) as { p_status?: string };
    expect(statusPayload.p_status).toBe('held');
  });

  test('send to kitchen sends the selected item and shows the kitchen confirmation', async ({ page }) => {
    await page.getByTestId('pos-start-quick-order').click();
    await addProduct(page);
    await page.getByTestId('pos-action-send-kitchen').click();
    await expect(page.getByText(/إرسال للمطبخ \(1\)|Sent to kitchen \(1\)/i)).toBeVisible({ timeout: 10000 });
    await expect(rpcCalls).toContain('create_order');
    await expect(page.getByTestId('pos-action-send-kitchen')).toBeVisible();
  });

  test('complete sale executes kitchen send, payment confirmation, and process_sale', async ({ page }) => {
    await page.getByTestId('pos-start-quick-order').click();
    await addProduct(page);
    await expect(page.getByTestId('pos-action-pay')).toHaveCount(0);
    await sendCurrentOrderToKitchen(page);
    await page.getByTestId('pos-action-pay').click();
    await expect(page.getByTestId('pos-payment-method-cash')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('pos-payment-method-cash').click();
    await page.getByTestId('pos-payment-confirm').click();
    await expect.poll(() => rpcCalls.includes('next_sale_document_number'), { timeout: 10000 }).toBe(true);
    await expect.poll(() => rpcCalls.includes('process_sale'), { timeout: 10000 }).toBe(true);
    const payload = (rpcPayloads.process_sale?.[0] || {}) as { p_status?: string; p_payment_method?: string; p_order_type?: string; p_shift_id?: string };
    expect(payload.p_status).toBe('completed');
    expect(payload.p_payment_method).toBe('cash');
    expect(payload.p_order_type).toBe('takeaway');
    expect(payload.p_shift_id).toBe(SHIFT_ID);
  });

  test('landing actions expose tables-first direct flows and back navigation', async ({ page }) => {
    await expect(page.getByTestId('pos-tables-landing-actions')).toBeVisible();
    await expect(page.getByTestId('pos-start-quick-order')).toBeVisible();
    await expect(page.getByTestId('pos-tables-start-drive-thru')).toBeVisible();
    await expect(page.getByTestId('pos-tables-start-delivery')).toBeVisible();
    await expect(page.getByTestId('pos-tables-active-orders')).toBeVisible();
    await expect(tableButton(page)).toBeVisible();
    await page.getByTestId('pos-tables-start-drive-thru').click();
    await expect(page.getByText(/أدخل رقم اللوحة لبدء الطلب|Enter the plate to start/i)).toBeVisible();
    await expect(page.getByTestId('pos-drive-thru-plate')).toBeVisible();
    await page.getByRole('button', { name: /رجوع|Back/i }).click();
    await expect(page.getByTestId('pos-tables-landing-actions')).toBeVisible();
    await expect(tableButton(page)).toBeVisible();
  });
});