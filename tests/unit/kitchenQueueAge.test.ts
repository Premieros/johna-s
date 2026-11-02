import { describe,it,expect } from 'vitest';
import {
  isKitchenQueueAutoClosed,
  isKitchenQueueOverdue,
  kitchenElapsedSeconds,
} from '@/features/inventory/services/kitchenQueueAge';

describe('kitchen queue display age',()=>{
 const now=Date.parse('2026-10-06T10:00:00Z');
 const item=(created_at:string,elapsed_seconds:number)=>({created_at,elapsed_seconds});

 it('marks cards overdue at 40 minutes but keeps them in the active kitchen display',()=>{
  expect(isKitchenQueueOverdue(item('2026-10-06T09:20:01Z',0),now)).toBe(false);
  expect(isKitchenQueueOverdue(item('2026-10-06T09:20:00Z',0),now)).toBe(true);
  expect(isKitchenQueueAutoClosed(item('2026-10-06T09:20:00Z',0),now)).toBe(false);
 });

 it('auto-closes only at 60 minutes after the latest kitchen send',()=>{
  expect(isKitchenQueueAutoClosed(item('2026-10-06T09:00:01Z',0),now)).toBe(false);
  expect(isKitchenQueueAutoClosed(item('2026-10-06T09:00:00Z',0),now)).toBe(true);
 });

 it('supports fallback elapsed values and clamps future timestamps',()=>{
  expect(kitchenElapsedSeconds(item('invalid',3599),now)).toBe(3599);
  expect(isKitchenQueueAutoClosed(item('invalid',3599),now)).toBe(false);
  expect(isKitchenQueueAutoClosed(item('invalid',3600),now)).toBe(true);
  expect(kitchenElapsedSeconds(item('2026-10-06T10:01:00Z',0),now)).toBe(0);
 });
});
