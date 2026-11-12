import {describe,it,expect} from 'vitest';
import {formatPercentValue} from '@/lib/format';
describe('financial percentage values',()=>{
 it('distinguishes valid zero from missing or invalid values',()=>{
  expect(formatPercentValue(0)).toBe('0%');for(const value of [null,undefined,NaN,Infinity])expect(formatPercentValue(value)).toBe('—');
 });
 it('retains fractional and negative percentages through the shared formatter',()=>{
  expect(formatPercentValue(17.35,1)).toBe('17.4%');expect(formatPercentValue(-10)).toBe('-10%');
 });
});
