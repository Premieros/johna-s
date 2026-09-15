export type MobilePermission = string;

export const MOBILE_ACTION_PERMISSIONS = [
  'pos.view',
  'pos.order.create',
  'pos.order.edit',
  'pos.send_kitchen',
  'pos.order.split',
  'pos.order.transfer',
  'approvals.review',
  'approvals.override',
] as const;

export interface MobileSessionProfile {
  userId: string;
  displayName: string;
  username: string;
  role: string;
  primaryBranchId: string | null;
  branchIds: string[];
  permissions: string[];
  isSuperAdmin: boolean;
}

export interface MobileBranch { id: string; name: string; nameEn?: string | null; }
export interface BranchPosConfig { taxEnabled: boolean; taxRate: number; currency: string; }
export interface DiningTableSummary {
  id: string; branchId: string; areaId?: string | null; areaName?: string | null; name: string;
  status: 'available' | 'occupied'; guestCount?: number | null; capacity?: number | null;
  activeOrderId?: string | null; activeOrderNumber?: string | null; activeWaiterName?: string | null;
}
export interface WaiterCatalogProduct {
  id: string; branchId: string; categoryId: string | null; categoryName?: string | null; name: string;
  nameEn?: string | null; description?: string | null; imageUrl?: string | null; salePrice: number; isActive: boolean;
}
export interface ModifierOption { id: string; name: string; nameEn?: string | null; priceDelta: number; isDefault: boolean; }
export interface ModifierGroup { id: string; name: string; nameEn?: string | null; minSelections: number; maxSelections: number; options: ModifierOption[]; }
export interface WaiterCartItemInput { productId: string; name: string; unitPrice: number; quantity: number; modifierOptionIds: string[]; notes?: string; }
export interface CreateTableOrderInput { branchId: string; tableId: string; guestCount: number; items: WaiterCartItemInput[]; taxEnabled: boolean; taxRate: number; notes?: string; }
export interface WaiterOrderSummary {
  orderId: string; orderNumber: string; branchId: string; tableId: string | null; tableName: string; waiterName: string;
  total: number; status: string; kitchenStatus?: string | null; sentToKitchenAt?: string | null;
}
export interface WaiterOrderDetails extends WaiterOrderSummary { guestCount: number | null; notes: string | null; items: WaiterCartItemInput[]; }
