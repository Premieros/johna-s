import { describe, expect, it } from 'vitest';
import {
  blockedCountStatus,
  pendingCountStatus,
  presenceStatus,
  zeroCountStatus,
} from '@/features/admin/services/systemHealthSeverity';

describe('system health severity contract', () => {
  it('treats integrity breaches as errors', () => {
    expect(zeroCountStatus(1)).toBe('error');
    expect(zeroCountStatus(3)).toBe('error');
    expect(zeroCountStatus(0)).toBe('ok');
  });

  it('keeps stale/non-critical operational findings as warnings when requested', () => {
    expect(zeroCountStatus(1, 'warning')).toBe('warning');
    expect(zeroCountStatus(0, 'warning')).toBe('ok');
    expect(pendingCountStatus(2)).toBe('warning');
    expect(pendingCountStatus(0)).toBe('ok');
  });

  it('keeps blocked/dead-letter conditions critical', () => {
    expect(blockedCountStatus(1)).toBe('error');
    expect(blockedCountStatus(0)).toBe('ok');
  });

  it('keeps missing expected operational checkpoints as warnings', () => {
    expect(presenceStatus(null)).toBe('warning');
    expect(presenceStatus('2026-09-29T01:00:00Z')).toBe('ok');
  });
});
