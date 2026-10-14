import { afterEach, describe, expect, it, vi } from 'vitest';
import { retryModuleLoad } from '@/lib/chunkRecovery';
import { userFacingErrorMessage } from '@/lib/userFacingError';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('module load recovery', () => {
  it('recovers one transient module failure without reloading the document', async () => {
    vi.useFakeTimers();
    const result = { default: 'screen' };
    const load = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module')).mockResolvedValueOnce(result);
    const pending = retryModuleLoad(load);
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toBe(result);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('stops after two failures', async () => {
    vi.useFakeTimers();
    const error = new TypeError('Importing a module script failed');
    const load = vi.fn().mockRejectedValue(error);
    const pending = expect(retryModuleLoad(load)).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(250);
    await pending;
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('does not retry application errors', async () => {
    const load = vi.fn().mockRejectedValue(new Error('PERMISSION_DENIED'));
    await expect(retryModuleLoad(load)).rejects.toThrow('PERMISSION_DENIED');
    expect(load).toHaveBeenCalledOnce();

  });
  it('reports a screen-file failure without claiming that a newer build caused it', () => {
    expect(userFacingErrorMessage(new Error('Failed to fetch dynamically imported module'), 'en')).toContain('Save changes before refreshing');
  });
});
