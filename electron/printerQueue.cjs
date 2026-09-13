'use strict';

class PerPrinterQueue {
  constructor() {
    this.tails = new Map();
  }

  enqueue(printerName, task) {
    const key = String(printerName || '').trim();
    if (!key) return Promise.reject(new Error('PRINTER_NAME_REQUIRED'));
    if (typeof task !== 'function') return Promise.reject(new Error('PRINT_TASK_REQUIRED'));

    const previous = this.tails.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    const tail = current.catch(() => undefined).finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    this.tails.set(key, tail);
    return current;
  }

  clear(printerName) {
    if (printerName) this.tails.delete(String(printerName).trim());
    else this.tails.clear();
  }
}

function withTimeout(promise, timeoutMs, code = 'PRINT_TIMEOUT') {
  const ms = Math.max(1, Number(timeoutMs) || 1);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

module.exports = { PerPrinterQueue, withTimeout };
