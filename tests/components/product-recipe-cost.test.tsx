import { render,screen,waitFor } from '@testing-library/react';
import { describe,expect,it,vi,beforeEach } from 'vitest';
import { ProductRecipeCost } from '@/features/catalog/components/ProductRecipeCost';
const mocks=vi.hoisted(()=>({load:vi.fn()}));
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'en'})}));
vi.mock('@/features/costing/services/recipeEstimateData',()=>({loadRecipeEstimateData:mocks.load}));
beforeEach(()=>mocks.load.mockReset());
describe('recipe cost within product editor',()=>{
  it('shows cents and updates quantities without refetching prices',async()=>{
    mocks.load.mockResolvedValue({prices:{coffee:5},groupCosts:{group:3}});
    const props={branchId:'a',ingredients:[{raw_material_id:'coffee',quantity:4,wastage_percent:10}],groups:[{unit_id:'group',quantity:2}],yieldQuantity:2,salePrice:100};
    const view=render(<ProductRecipeCost {...props}/>);
    await waitFor(()=>expect(screen.getByText('17.00 EGP')).toBeVisible());
    expect(screen.getByText('Expected margin: 83%')).toBeVisible();
    view.rerender(<ProductRecipeCost {...props} groups={[{unit_id:'group',quantity:3}]}/>);
    expect(screen.getByText('20.00 EGP')).toBeVisible();
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  it('withholds cost and margin when a component group is invalid',async()=>{
    mocks.load.mockResolvedValue({prices:{},groupCosts:{group:null}});
    render(<ProductRecipeCost branchId="a" ingredients={[]} groups={[{unit_id:'group',quantity:1}]} yieldQuantity={1} salePrice={100}/>);
    await waitFor(()=>expect(screen.getByText('Incomplete')).toBeVisible());
    expect(screen.getByRole('status')).toBeVisible();
    expect(screen.getByText('Expected margin: —')).toBeVisible();
    expect(screen.queryByText('0.00 EGP')).not.toBeInTheDocument();
  });
  it('shows the sum of priced ingredients when another raw material is zero',async()=>{
    mocks.load.mockResolvedValue({prices:{priced:5,zero:0},groupCosts:{}});
    render(<ProductRecipeCost branchId="a" ingredients={[{raw_material_id:'priced',quantity:2,wastage_percent:0},{raw_material_id:'zero',quantity:1,wastage_percent:0}]} groups={[]} yieldQuantity={1} salePrice={100}/>);
    await waitFor(()=>expect(screen.getByText('10.00 EGP')).toBeVisible());
    expect(screen.queryByText('Incomplete')).not.toBeInTheDocument();
  });
});
