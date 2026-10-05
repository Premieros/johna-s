import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTable } from '@/components/DataTable';
const columns = [{ key: 'name', header: 'Name' }];
const rows = Array.from({ length: 205 }, (_, i) => ({ id: String(i), name: `entry-${i}` }));

afterEach(cleanup);

describe('opt-in table paging', () => {
  it('bounds mounted rows and allows reaching the final row', () => {
    render(<DataTable columns={columns} data={rows} pageSize={100} />);
    expect(within(screen.getByRole('table').querySelector('tbody')!).queryByText('entry-204')).toBeNull();
    expect(within(screen.getByRole('table').querySelector('tbody')!).getAllByText('entry-0')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(within(screen.getByRole('table').querySelector('tbody')!).getAllByText('entry-204')).toHaveLength(1);
    expect(within(screen.getByRole('table').querySelector('tbody')!).queryByText('entry-0')).toBeNull();
  });
  it('filters across all pages and resets the current page when data changes', () => {
    const { rerender } = render(<DataTable columns={columns} data={rows} pageSize={100} />);
    const table = screen.getByRole('table');
    fireEvent.change(within(table).getByLabelText('Text filter in column'), { target: { value: 'entry-204' } });
    expect(within(table.querySelector('tbody')!).getByText('entry-204')).toBeTruthy();
    fireEvent.change(within(table).getByLabelText('Text filter in column'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    rerender(<DataTable columns={columns} data={rows.slice(0, 2)} pageSize={100} />);
    expect(within(screen.getByRole('table').querySelector('tbody')!).getByText('entry-0')).toBeTruthy();
  });
  it('preserves existing unpaged consumers', () => {
    render(<DataTable columns={columns} data={rows} />);
    expect(within(screen.getByRole('table').querySelector('tbody')!).getAllByText('entry-204')).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: 'Table pages' })).toBeNull();
  });
});
