export type MobilePermission =
  | 'pos.view'
  | 'pos.order.create'
  | 'pos.order.edit'
  | 'pos.send_kitchen'
  | 'pos.payment.take'
  | 'pos.order.split'
  | 'pos.order.transfer'
  | 'approvals.view';

export interface MobileSessionProfile {
  userId: string;
  displayName: string;
  branchIds: string[];
  permissions: MobilePermission[];
}

export interface DiningTableSummary {
  id: string;
  branchId: string;
  floorId?: string | null;
  name: string;
  status: 'available' | 'occupied';
  guestCount?: number | null;
  activeOrderId?: string | null;
  activeWaiterName?: string | null;
}

export interface WaiterCatalogProduct {
  id: string;
  branchId: string;
  categoryId: string | null;
  name: string;
  nameEn?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  salePrice: number;
  isActive: boolean;
  isAvailable: boolean;
}

export interface WaiterCartItemInput {
  productId: string;
  quantity: number;
  modifierOptionIds: string[];
  notes?: string;
}

export interface CreateTableOrderInput {
  branchId: string;
  tableId: string;
  guestCount: number;
  items: WaiterCartItemInput[];
  notes?: string;
}

export interface WaiterOrderSummary {
  orderId: string;
  orderNumber: string;
  branchId: string;
  tableId: string;
  tableName: string;
  waiterName: string;
  total: number;
  status: string;
  sentToKitchenAt?: string | null;
}

export interface WaiterMobileGateway {
  getSessionProfile(): Promise<MobileSessionProfile>;
  getDiningTables(branchId: string): Promise<DiningTableSummary[]>;
  getCatalog(branchId: string): Promise<WaiterCatalogProduct[]>;
  createTableOrder(input: CreateTableOrderInput): Promise<{ orderId: string; orderNumber: string }>;
  updateTableOrder(orderId: string, items: WaiterCartItemInput[]): Promise<void>;
  sendToKitchen(orderId: string): Promise<void>;
  takePayment(orderId: string): Promise<void>;
  splitOrder(orderId: string): Promise<void>;
  transferOrder(orderId: string, targetTableId: string): Promise<void>;
  getMyOrders(): Promise<WaiterOrderSummary[]>;
}
