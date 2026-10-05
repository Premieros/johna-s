import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductBrowser } from '@/features/pos/components/catalog/ProductBrowser';
import type { Category, Product } from '@/lib/types';

const mocks = vi.hoisted(() => ({ read: vi.fn(), eq: vi.fn(), select: vi.fn(), from: vi.fn(), phone: true, online: true }));
vi.mock('@/api', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: (key: string) => key }) }));
vi.mock('@/context/OfflineContext', () => ({ useOffline: () => ({ isOnline: mocks.online }) }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('@/lib/permissions', () => ({ useCan: () => () => false }));
vi.mock('@/features/pos/hooks/usePhoneViewport', () => ({ usePhoneViewport: () => mocks.phone }));
const categories: Category[] = [
  { id: 'food', branch_id: 'a', name: 'Food', name_en: 'Food', description: null, created_at: '', kitchen_station_id: 'kitchen' },
  { id: 'drink', branch_id: 'a', name: 'Drink', name_en: 'Drink', description: null, created_at: '', kitchen_station_id: 'bar' },
  { id: 'other', branch_id: 'a', name: 'Other', name_en: 'Other', description: null, created_at: '', kitchen_station_id: null },
];
const products = [
  { id: 'burger', branch_id: 'a', name: 'Burger', name_en: 'Burger', category_id: 'food', sku: 'FOOD01', barcode: '101', sale_price: 100 },
  { id: 'coffee', branch_id: 'a', name: 'Coffee', name_en: 'Coffee', category_id: 'drink', sku: 'COFFEE02', barcode: '202', sale_price: 30 },
  { id: 'extra', branch_id: 'a', name: 'Extra', name_en: 'Extra', category_id: 'other', sale_price: 10 },
] as Product[];
const stations = [
  { id: 'kitchen', branch_id: 'a', name_ar: 'المطبخ', name_en: 'Kitchen', is_active: true },
  { id: 'bar', branch_id: 'a', name_ar: 'البارستا', name_en: 'Barista', is_active: true },
];
function Browser({ branch = 'a', user = 'u', cats = categories, prods = products }: { branch?: string; user?: string; cats?: Category[]; prods?: Product[] }) {
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  return <MemoryRouter><ProductBrowser branchId={branch} userId={user} products={prods} categories={cats} selectedCategory={category} search={search} onSearch={setSearch} onSelectCategory={setCategory} currency="EGP" hasBranch canModifyOrder shiftChecked shiftOpen onAddToCart={vi.fn()} /></MemoryRouter>;
}
beforeEach(() => {
  mocks.phone = true;
  mocks.online = true;
  mocks.read.mockReset().mockResolvedValue({ data: stations, error: null });
  const query = { select: mocks.select, eq: mocks.eq, order: mocks.read };
  mocks.from.mockReset().mockReturnValue(query);
  mocks.select.mockReset().mockReturnValue(query);
  mocks.eq.mockReset().mockReturnValue(query);
});
describe('phone POS station categories and product browsing', () => {
  it('reads branch-active stations only and displays their actual names and linked categories', async () => {
    render(<Browser />);
    await screen.findByTestId('pos-station-kitchen');
    expect(mocks.from).toHaveBeenCalledWith('kitchen_stations');
    expect(mocks.eq.mock.calls).toEqual([['branch_id', 'a'], ['is_active', true]]);
    fireEvent.click(screen.getByTestId('pos-station-kitchen'));
    expect(screen.getByTestId('pos-station-category-food')).toBeInTheDocument();
    expect(screen.queryByTestId('pos-station-category-drink')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pos-station-category-food'));
    expect(screen.getByTestId('pos-product-card-burger')).toBeInTheDocument();
    expect(screen.queryByTestId('pos-product-card-coffee')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pos-station-back'));
    fireEvent.click(screen.getByTestId('pos-station-bar'));
    expect(screen.getByTestId('pos-station-category-drink')).toBeInTheDocument();
    expect(screen.queryByTestId('pos-station-category-food')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pos-station-category-drink'));
    expect(screen.getByTestId('pos-product-card-coffee')).toBeInTheDocument();
    expect(screen.queryByTestId('pos-product-card-burger')).not.toBeInTheDocument();
  });
  it('returns from categories to station cards and restores all products', async () => {
    render(<Browser />);
    fireEvent.click(await screen.findByTestId('pos-station-kitchen'));
    fireEvent.click(screen.getByTestId('pos-station-category-food'));
    fireEvent.click(screen.getByTestId('pos-station-back'));
    expect(screen.getByTestId('pos-station-cards')).toBeInTheDocument();
    expect(screen.queryByTestId('pos-station-category-food')).not.toBeInTheDocument();
    expect(screen.getByTestId('pos-product-card-coffee')).toBeInTheDocument();
  });
  it('keeps name, barcode and SKU search global on phones without losing category selection', async () => {
    render(<Browser />);
    fireEvent.click(await screen.findByTestId('pos-station-kitchen'));
    fireEvent.click(screen.getByTestId('pos-station-category-food'));
    const search = within(screen.getByTestId('pos-mobile-catalog-header')).getByRole('textbox');
    for (const term of ['Coffee', '202', 'COFFEE02']) {
      fireEvent.change(search, { target: { value: term } });
      expect(screen.getByTestId('pos-product-card-coffee')).toBeInTheDocument();
      expect(screen.queryByTestId('pos-product-card-burger')).not.toBeInTheDocument();
    }
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByTestId('pos-product-card-burger')).toBeInTheDocument();
    expect(screen.queryByTestId('pos-product-card-coffee')).not.toBeInTheDocument();
  });
  it('exposes unmapped categories through All and retains legacy categories without stations', async () => {
    render(<Browser />);
    fireEvent.click(await screen.findByTestId('pos-station-all'));
    fireEvent.click(screen.getByTestId('pos-station-category-other'));
    expect(screen.getByTestId('pos-product-card-extra')).toBeInTheDocument();
    expect(screen.queryByTestId('pos-product-card-burger')).not.toBeInTheDocument();
  });
  it('falls back without stations and on read failure, allowing retry without blocking products', async () => {
    mocks.read.mockResolvedValueOnce({ data: null, error: new Error('offline') }).mockResolvedValueOnce({ data: stations, error: null });
    render(<Browser />);
    await screen.findByText('Stations unavailable; categories remain available');
    expect(screen.getByTestId('pos-product-card-burger')).toBeInTheDocument();
    expect(screen.getByTestId('pos-station-category-drink')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByTestId('pos-station-bar');
  });
  it('ignores foreign/inactive stations and clears navigation and old products for a new branch', async () => {
    mocks.read.mockResolvedValue({ data: [...stations, { ...stations[0], id: 'foreign', branch_id: 'b' }, { ...stations[1], id: 'inactive', is_active: false }], error: null });
    const linkedForeign = [...categories,
      { ...categories[0], id: 'foreign-cat', kitchen_station_id: 'foreign' },
      { ...categories[0], id: 'inactive-cat', kitchen_station_id: 'inactive' }];
    const { rerender } = render(<Browser cats={linkedForeign} />);
    fireEvent.click(await screen.findByTestId('pos-station-kitchen'));
    fireEvent.click(screen.getByTestId('pos-station-category-food'));
    expect(screen.queryByTestId('pos-station-foreign')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pos-station-inactive')).not.toBeInTheDocument();
    mocks.read.mockReturnValue(new Promise(() => {}));
    rerender(<Browser branch="b" />);
    expect(screen.queryByTestId('pos-station-kitchen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pos-product-card-burger')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.eq).toHaveBeenCalledWith('branch_id', 'b'));
  });
  it('does not request stations on desktop and preserves category-bound desktop search', () => {
    mocks.phone = false;
    render(<Browser />);
    expect(screen.queryByTestId('pos-mobile-station-navigation')).not.toBeInTheDocument();
    const desktopStrip = screen.getAllByTestId('pos-category-strip')[1];
    fireEvent.click(within(desktopStrip).getByRole('button', { name: /Food/ }));
    expect(screen.queryByTestId('pos-product-card-coffee')).not.toBeInTheDocument();
    const searches = screen.getAllByRole('textbox');
    fireEvent.change(searches[1], { target: { value: 'Coffee' } });
    expect(screen.queryByTestId('pos-product-card-coffee')).not.toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('retains all branch categories when no active station has an assignment', async () => {
    mocks.read.mockResolvedValue({ data: [], error: null });
    render(<Browser />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('pos-station-category-drink'));
    expect(screen.getByTestId('pos-product-card-coffee')).toBeInTheDocument();
  });
  it('discards a delayed old-branch read and clears station navigation on user changes', async () => {
    let finishOld!: (value: { data: typeof stations; error: null }) => void;
    const newStations = [{ ...stations[0], id: 'new-kitchen', branch_id: 'b', name_en: 'New Kitchen' }];
    mocks.read.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce({ data: newStations, error: null });
    const { rerender } = render(<Browser />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    const newCategories = [{ ...categories[0], branch_id: 'b', kitchen_station_id: 'new-kitchen' }];
    rerender(<Browser branch="b" cats={newCategories} prods={[]} />);
    await screen.findByTestId('pos-station-new-kitchen');
    await act(async () => { finishOld({ data: stations, error: null }); });
    expect(screen.queryByTestId('pos-station-kitchen')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pos-station-new-kitchen'));
    mocks.read.mockReturnValue(new Promise(() => {}));
    rerender(<Browser branch="b" user="other-user" cats={newCategories} prods={[]} />);
    expect(screen.queryByTestId('pos-station-back')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pos-station-new-kitchen')).not.toBeInTheDocument();
  });
  it('shows active empty stations, excludes the existing cashier station and keeps offline categories usable', async () => {
    mocks.read.mockResolvedValue({ data: [...stations,
      { ...stations[0], id: 'empty', name_en: 'Empty Station' },
      { ...stations[0], id: 'cashier', code: ' cashier ' }], error: null });
    const { rerender } = render(<Browser />);
    fireEvent.click(await screen.findByTestId('pos-station-empty'));
    expect(screen.getByText('No categories assigned to this station')).toBeInTheDocument();
    expect(screen.queryByTestId('pos-station-cashier')).not.toBeInTheDocument();
    const count = mocks.read.mock.calls.length;
    mocks.online = false;
    rerender(<Browser />);
    await waitFor(() => expect(screen.queryByTestId('pos-station-back')).not.toBeInTheDocument());
    expect(screen.getByTestId('pos-station-category-food')).toBeInTheDocument();
    expect(mocks.read.mock.calls.length).toBe(count);
  });
});
