import { describe,expect,it } from 'vitest';
import { expenseCategoryLabel } from '@/features/reporting/utils/expenseCategoryLabel';
describe('expense category presentation',()=>{
 it('translates known categories without rewriting custom user labels',()=>{
  expect(expenseCategoryLabel('salaries','ar')).toBe('أجور ورواتب');
  expect(expenseCategoryLabel('other','ar')).toBe('أخرى');
  expect(expenseCategoryLabel('transport','en')).toBe('Transport');
  expect(expenseCategoryLabel('تصنيف خاص','ar')).toBe('تصنيف خاص');
  expect(expenseCategoryLabel(null,'ar')).toBe('');
 });
});
