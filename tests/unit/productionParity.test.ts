import { beforeAll, describe, expect, it } from 'vitest';

let runParity: (options: Record<string, unknown>) => Promise<unknown>;
beforeAll(async () => {
  const modulePath = '../../scripts/db/check-production-parity.js';
  ({ runParity } = await import(modulePath));
});
const contract = { rpcs: [{ name: 'dangerous_sale', params: ['id'] }], tables: ['orders'] };
const good = { version: 1, valid: true, rpcs: [{ name: 'dangerous_sale', present: true }], tables: [{ name: 'orders', present: true }] };
function fixture(metadata: unknown = good, sentinel: unknown = true, status = 200) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = async (url: string, options: { body: string }) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { status, json: async () => calls.length === 1 ? metadata : sentinel };
  };
  return { calls, run: () => runParity({ url: 'https://example.invalid', key: 'anon-test', contract, fetchImpl }) };
}
describe('data-free deployment parity gate', () => {
  it('uses only two catalog/sentinel calls and never invokes operational routes', async () => {
    const f = fixture();
    await expect(f.run()).resolves.toEqual({ rpcs: 1, tables: 1, requests: 2 });
    expect(f.calls.map(c => c.url)).toEqual([
      'https://example.invalid/rest/v1/rpc/_production_api_contract_v1',
      'https://example.invalid/rest/v1/rpc/_production_schema_contract_kitchen_v1',
    ]);
    expect(f.calls[0].body).toEqual({ p_contract: contract });
    expect(f.calls[1].body).toEqual({});
  });
  it('blocks a report deployment when its runtime normalizer is missing without probing print routes', async () => {
    const reportContract = { rpcs: [{ name: 'enqueue_cloud_report_print', params: ['branch_id', 'payload', 'idempotency_key'] }], tables: ['orders'] };
    const calls: string[] = [];
    await expect(runParity({ url: 'https://example.invalid', key: 'test', contract: reportContract,
      fetchImpl: async (url: string, options: { body: string }) => {
        calls.push(url);
        const { p_contract } = JSON.parse(options.body);
        expect(p_contract.rpcs).toEqual(expect.arrayContaining([
          { name: '_normalize_thermal_print_payload', params: ['payload'] },
          { name: 'split_legacy_report_text', params: ['text'] },
        ]));
        return { status: 200, json: async () => ({ version: 1, valid: true,
          rpcs: p_contract.rpcs.map((r: { name: string }) => ({ name: r.name, present: r.name !== '_normalize_thermal_print_payload' })),
          tables: [{ name: 'orders', present: true }] }) };
      } })).rejects.toThrow('_normalize_thermal_print_payload');
    expect(calls).toEqual(['https://example.invalid/rest/v1/rpc/_production_api_contract_v1']);
  });
  it.each([400, 401, 403, 404, 500, 503])('blocks HTTP %i without operational fallback', async status => {
    const f = fixture(good, true, status);
    await expect(f.run()).rejects.toThrow('Unverifiable');
    expect(f.calls).toHaveLength(1);
  });
  it.each([
    null, { ...good, version: 2 }, { ...good, valid: false },
    { ...good, rpcs: [] }, { ...good, tables: [] },
    { ...good, rpcs: [{ name: 'other', present: true }] },
    { ...good, rpcs: [{ name: 'dangerous_sale', present: 'true' }] },
    { ...good, rpcs: [{ name: 'dangerous_sale', present: false }] },
    { ...good, tables: [{ name: 'orders', present: false }] },
    { ...good, rpcs: [...good.rpcs, ...good.rpcs] },
  ])('blocks incomplete, forged, missing or ambiguous metadata %#', async metadata => {
    const f = fixture(metadata);
    await expect(f.run()).rejects.toThrow();
    expect(f.calls).toHaveLength(1);
  });
  it.each([false, null, {}, 'true'])('blocks failed or malformed kitchen sentinel %#', async value => {
    await expect(fixture(good, value).run()).rejects.toThrow('schema contract');
  });
  it('fails closed when the transport or JSON decoding fails', async () => {
    await expect(runParity({ url: 'https://example.invalid', key: 'test', contract,
      fetchImpl: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
    await expect(runParity({ url: 'https://example.invalid', key: 'test', contract,
      fetchImpl: async () => ({ status: 200, json: async () => { throw new Error('invalid JSON'); } }) })).rejects.toThrow('invalid JSON');
  });
});
