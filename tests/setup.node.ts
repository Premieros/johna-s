import { afterEach, vi } from 'vitest';
// Pure file/schema contracts do not import React cleanup or DOM polyfills.
afterEach(() => vi.restoreAllMocks());
