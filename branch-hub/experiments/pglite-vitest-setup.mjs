import { vi } from 'vitest';
vi.mock('../../tests/integration/db',async()=>import('./pglite-test-db.mjs'));
// A missed helper substitution must never fall back to a real PostgreSQL socket.
vi.mock('pg',()=>({default:{Client:class {constructor(){throw new Error('Native PostgreSQL connections are forbidden in this lab');}}}}));
