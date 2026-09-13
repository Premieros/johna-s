'use strict';

const assert = require('node:assert/strict');
const { PerPrinterQueue, withTimeout } = require('./printerQueue.cjs');

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const queue = new PerPrinterQueue();
  const events = [];

  const first = queue.enqueue('cashier', async () => {
    events.push('cashier-1-start');
    await sleep(30);
    events.push('cashier-1-end');
    return 1;
  });
  const second = queue.enqueue('cashier', async () => {
    events.push('cashier-2-start');
    events.push('cashier-2-end');
    return 2;
  });
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(events, ['cashier-1-start', 'cashier-1-end', 'cashier-2-start', 'cashier-2-end']);

  let releaseKitchen;
  const kitchenBlocker = new Promise((resolve) => { releaseKitchen = resolve; });
  const kitchen = queue.enqueue('kitchen', async () => {
    await kitchenBlocker;
    return 'kitchen';
  });
  const barista = queue.enqueue('barista', async () => 'barista');
  assert.equal(await withTimeout(barista, 100, 'BARISTA_BLOCKED'), 'barista');
  releaseKitchen();
  assert.equal(await kitchen, 'kitchen');

  await assert.rejects(
    withTimeout(new Promise(() => {}), 20, 'EXPECTED_TIMEOUT'),
    /EXPECTED_TIMEOUT/,
  );

  console.log('printer queue tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
