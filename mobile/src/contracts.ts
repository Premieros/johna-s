export type MobileOrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export interface MobileCatalogProduct {
  id: string;
  branchId: string;
  categoryId: string | null;
  name: string;
  nameEn?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  salePrice: number;
  isActive: boolean;
}

export interface CustomerAddressInput {
  label?: string;
  addressText: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
}

export interface MobileCartItemInput {
  productId: string;
  quantity: number;
  modifierOptionIds: string[];
  notes?: string;
}

export interface CreateCustomerOrderInput {
  branchId: string;
  customerName: string;
  customerPhone: string;
  address: CustomerAddressInput;
  items: MobileCartItemInput[];
  notes?: string;
}

export interface CaptainOrderSummary {
  orderId: string;
  orderNumber: string;
  branchId: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  total: number;
  paymentStatus: string | null;
  status: MobileOrderStatus;
  assignedCaptainId: string | null;
}

export interface MobileGateway {
  getCatalog(branchId: string): Promise<MobileCatalogProduct[]>;
  createCustomerOrder(input: CreateCustomerOrderInput): Promise<{ orderId: string; orderNumber: string }>;
  getOrderStatus(orderId: string): Promise<MobileOrderStatus>;
  getCaptainOrders(): Promise<CaptainOrderSummary[]>;
  acceptCaptainOrder(orderId: string): Promise<void>;
  updateDeliveryStatus(orderId: string, status: MobileOrderStatus): Promise<void>;
}
