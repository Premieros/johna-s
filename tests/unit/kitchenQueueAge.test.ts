import { describe,it,expect } from 'vitest';
import { isKitchenQueueExpired,kitchenElapsedSeconds } from '@/features/inventory/services/kitchenQueueAge';
describe('kitchen queue age',()=>{
 const now=Date.parse('2026-10-06T10:00:00Z');
 it('keeps 39:59 active and archives at 40:00 using queue send time',()=>{
  expect(isKitchenQueueExpired({created_at:'2026-10-06T09:20:01Z',elapsed_seconds:9999},now)).toBe(false);
  expect(isKitchenQueueExpired({created_at:'2026-10-06T09:20:00Z',elapsed_seconds:0},now)).toBe(true);
 });
 it('supports old records and a missing timestamp without negative elapsed age',()=>{
  expect(isKitchenQueueExpired({created_at:'2026-10-01T00:00:00Z',elapsed_seconds:0},now)).toBe(true);
  expect(kitchenElapsedSeconds({created_at:'invalid',elapsed_seconds:2399},now)).toBe(2399);
  expect(kitchenElapsedSeconds({created_at:'2026-10-06T10:01:00Z',elapsed_seconds:0},now)).toBe(0);
 });
});
