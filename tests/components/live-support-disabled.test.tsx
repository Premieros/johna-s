import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SupportLauncher } from '@/features/support/SupportLauncher';
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'employee' } }) }));
describe('disabled live support', () => {
  it('adds no launcher or keyboard listener when the feature is off', () => {
    const listener = vi.spyOn(window, 'addEventListener');
    render(<SupportLauncher />);
    expect(screen.queryByRole('button', { name: 'الدعم المباشر' })).not.toBeInTheDocument();
    expect(listener.mock.calls.some(([event]) => event === 'keydown')).toBe(false);
  });
});
