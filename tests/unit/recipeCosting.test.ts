import { describe,expect,it } from 'vitest';
import { estimateGroupCosts,estimateRecipeCost } from '@/lib/recipeCosting';

describe('current recipe unit estimates',()=>{
  it('uses raw prices and nested quantities/waste instead of a stored group price',()=>{
    const costs=estimateGroupCosts(['parent','child'],[
      {unit_id:'child',raw_material_id:'sugar',quantity:2,wastage_percent:10},
    ],[{unit_id:'parent',component_unit_id:'child',quantity:3,wastage_percent:20}],{sugar:5});
    expect(costs.child).toBeCloseTo(11);
    expect(costs.parent).toBeCloseTo(39.6);
  });
  it('divides direct ingredients by yield while product group links remain per sale',()=>{
    expect(estimateRecipeCost([{raw_material_id:'coffee',quantity:4,wastage_percent:10}],
      [{unit_id:'group',quantity:2}],{coffee:5},{group:3},2).unitCost).toBeCloseTo(17);
    expect(estimateRecipeCost([{raw_material_id:'coffee',quantity:1,wastage_percent:0}],[],{coffee:5},{},0.5).unitCost).toBe(10);
  });
  it('marks missing prices, empty groups, unavailable children and cycles incomplete',()=>{
    const costs=estimateGroupCosts(['missing','empty','a','b','foreign'],[
      {unit_id:'missing',raw_material_id:'unknown',quantity:1,wastage_percent:0},
    ],[
      {unit_id:'a',component_unit_id:'b',quantity:1,wastage_percent:0},
      {unit_id:'b',component_unit_id:'a',quantity:1,wastage_percent:0},
      {unit_id:'foreign',component_unit_id:'otherBranch',quantity:1,wastage_percent:0},
    ],{});
    expect(Object.values(costs)).toEqual([null,null,null,null,null]);
    expect(estimateRecipeCost([], [{unit_id:'missing',quantity:1}],{},costs,1)).toEqual({unitCost:null,incomplete:true});
    expect(estimateRecipeCost([{raw_material_id:'unknown',quantity:1,wastage_percent:0}],[],{},costs,1).unitCost).toBeNull();
  });
});
