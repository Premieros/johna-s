import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pricing = readFileSync('src/features/catalog/pages/PricingPage.tsx', 'utf8');
const utilities = readFileSync('src/components/PageUtilityControls.tsx', 'utf8');
const layout = readFileSync('src/components/Layout.tsx', 'utf8');
const routes = readFileSync('src/app/routes.tsx', 'utf8');
const routeDefs = readFileSync('src/core/navigation/routes.ts', 'utf8');
const menu = readFileSync('src/core/navigation/menu.config.ts', 'utf8');

describe('pricing workspace contract', () => {
  it('registers a permission-gated pricing route and menu item', () => {
    expect(routeDefs).toContain("pricing: '/pricing'");
    expect(routes).toContain('APP_ROUTES.pricing');
    expect(routes).toContain('permission="products.view"><PricingPage');
    expect(menu).toContain("id: 'pricing'");
    expect(menu).toContain("permission: 'products.view'");
  });

  it('keeps pricing branch-scoped and permission-first', () => {
    expect(pricing).toContain('const branchId = useBranchFilter()');
    expect(pricing).toContain("can('raw_materials.view')");
    expect(pricing).toContain("can('raw_materials.manage')");
    expect(pricing).toContain("can('products.view')");
    expect(pricing).toContain("can('products.edit')");
    expect(pricing).toContain(".eq('branch_id', branchId)");
    expect(pricing).toContain(".eq('unit_type', 'manufactured')");
  });

  it('does not overwrite calculated raw inventory average cost', () => {
    expect(pricing).toContain(".from('raw_materials')");
    expect(pricing).toContain('.update({ default_cost: nextCost })');
    expect(pricing).not.toContain(".from('raw_material_inventory').update");
    expect(pricing).not.toContain('avg_cost:');
  });

  it('supports all requested pricing surfaces', () => {
    expect(pricing).toContain("type PricingTab = 'raw' | 'manufactured' | 'products'");
    expect(pricing).toContain('wholesale_price');
    expect(pricing).toContain('pricing-search');
    expect(pricing).toContain('max-h-[65vh] overflow-auto');
  });
});

describe('global page utility controls', () => {
  it('adds search and scroll controls to the standard app shell', () => {
    expect(layout).toContain('<PageUtilityControls />');
    expect(utilities).toContain('input[type="search"]');
    expect(utilities).toContain("window.scrollTo({ top: 0");
    expect(utilities).toContain('document.documentElement.scrollHeight');
    expect(utilities).toContain("premier:open-command-palette");
  });

  it('does not touch printing, KDS, or kitchen dispatch', () => {
    expect(pricing).not.toContain('cloud_print_jobs');
    expect(pricing).not.toContain('send_to_kitchen');
    expect(pricing).not.toContain('kitchen_status');
    expect(utilities).not.toContain('printer');
  });
});
