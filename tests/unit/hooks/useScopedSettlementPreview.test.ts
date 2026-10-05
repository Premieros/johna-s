import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScopedSettlementPreview } from '@/features/pos/hooks/useScopedSettlementPreview';
const fetch = vi.hoisted(() => vi.fn());
vi.mock('@/features/pos/services/settlementPreview', () => ({ fetchOrderSettlementPreview: fetch }));
const response = (order: string, branch: string, warehouse: string) => ({preview:{order_id:order,branch_id:branch,warehouse_id:warehouse,success:true,items:[],total:20},error:null});
const deferred = () => { let resolve!: (value: ReturnType<typeof response>) => void; const promise = new Promise<ReturnType<typeof response>>(yes=>{resolve=yes;}); return {promise,resolve}; };
beforeEach(()=>fetch.mockReset());
describe('settlement scope isolation',()=>{
  it('discards a late old-order preview including its warehouse',async()=>{
    const a=deferred(); const b=deferred(); fetch.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const {result,rerender}=renderHook(({order,branch})=>useScopedSettlementPreview(order,branch),{initialProps:{order:'a',branch:'branch-a'}});
    let old!: ReturnType<typeof result.current.load>;
    act(()=>{old=result.current.load();});
    rerender({order:'b',branch:'branch-b'});
    expect(result.current.preview).toBeNull();
    let fresh!: ReturnType<typeof result.current.load>; act(()=>{fresh=result.current.load();});
    await act(async()=>{b.resolve(response('b','branch-b','warehouse-b'));await fresh;});
    await act(async()=>{a.resolve(response('a','branch-a','warehouse-a'));expect((await old).preview).toBeNull();});
    expect(result.current.preview?.warehouse_id).toBe('warehouse-b');
  });
  it('clears an existing preview on branch change and rejects foreign server scope',async()=>{
    fetch.mockResolvedValue(response('a','branch-a','warehouse-a'));
    const {result,rerender}=renderHook(({branch})=>useScopedSettlementPreview('a',branch),{initialProps:{branch:'branch-a'}});
    await act(async()=>{await result.current.load();});
    expect(result.current.preview?.warehouse_id).toBe('warehouse-a');
    rerender({branch:'branch-b'}); expect(result.current.preview).toBeNull();
    await act(async()=>{expect((await result.current.load()).error).toBe('SETTLEMENT_PREVIEW_SCOPE_MISMATCH');});
    expect(result.current.preview).toBeNull();
  });
  it('closing checkout invalidates pending work and ignores errors from superseded reads',async()=>{
    const pending=deferred();fetch.mockReturnValue(pending.promise);
    const {result}=renderHook(()=>useScopedSettlementPreview('a','branch-a'));
    let loading!: ReturnType<typeof result.current.load>;act(()=>{loading=result.current.load();});
    act(()=>result.current.clear());
    await act(async()=>{pending.resolve(response('a','branch-a','warehouse-a'));expect((await loading).preview).toBeNull();});
    expect(result.current.preview).toBeNull();
  });
  it('refreshes the pinned warehouse for each confirmation read',async()=>{
    fetch.mockResolvedValueOnce(response('a','branch-a','warehouse-old')).mockResolvedValueOnce(response('a','branch-a','warehouse-new'));
    const {result}=renderHook(()=>useScopedSettlementPreview('a','branch-a'));
    await act(async()=>{await result.current.load();});
    await act(async()=>{await result.current.load();});
    await waitFor(()=>expect(result.current.preview?.warehouse_id).toBe('warehouse-new'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
