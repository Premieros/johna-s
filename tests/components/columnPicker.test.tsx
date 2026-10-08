import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColumnPicker } from '@/features/reporting/ColumnPicker';
describe('column picker', () => {
  it('searches all columns without changing hidden selection and dispatches moves in full order', () => {
    const toggle = vi.fn(); const move = vi.fn();
    render(<ColumnPicker columns={['Branch', 'Invoice', 'Net']} visibleColumns={['Branch', 'Net']} onToggle={toggle} onShowAll={vi.fn()} onMove={move} lang="en" hiddenCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'invoice' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    const checkbox = screen.getByRole('checkbox', { name: 'Invoice' }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(toggle).toHaveBeenCalledWith('Invoice');
    fireEvent.click(screen.getByRole('button', { name: 'Move Invoice earlier' }));
    expect(move).toHaveBeenCalledWith('Invoice', -1);
  });
  it('disables boundary moves and closes with Escape', () => {
    render(<ColumnPicker columns={['Invoice']} visibleColumns={null} onToggle={vi.fn()} onShowAll={vi.fn()} onMove={vi.fn()} lang="en" hiddenCount={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    expect((screen.getByRole('button', { name: 'Move Invoice earlier' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move Invoice later' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});
