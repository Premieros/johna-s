import type { DiningTable, Order, OrderItem, ProductModifierSnapshot } from '@/lib/types';

export interface OrderKitchenSend {
  id: string;
  branch_id: string;
  order_id: string;
  order_item_id: string;
  sent_at: string;
  sent_by: string | null;
  /** Cumulative quantity actually sent to the kitchen for this order item. */
  sent_quantity: number;
}

export interface KitchenSendItem {
  send_id: string;
  order_item_id: string;
  product_id: string | null;
  product_name: string | null;
  unit_name: string | null;
  /** Authoritative KDS station code used for local printer routing. */
  station_code?: string | null;
  /** Delta quantity included in this specific send_to_kitchen call. */
  quantity: number;
  unit_price: number;
  discount_amount: number;
  bonus_quantity: number;
  total: number;
  notes: string | null;
  modifiers?: ProductModifierSnapshot[] | null;
}


export type KitchenStationDispatchState = 'queued' | 'local_printed' | 'failed';

export interface KitchenStationDispatchResult {
  station_code: string;
  item_count: number;
  state: KitchenStationDispatchState;
  detail?: string;
}

export interface KitchenStationDispatchSummary {
  status: 'not_needed' | 'complete' | 'partial' | 'failed';
  stations: KitchenStationDispatchResult[];
  failed_stations: string[];
  missing_station_items: number;
}

export interface KitchenSendResult {
  success: boolean;
  order_id?: string;
  order_number?: string | null;
  table_name?: string | null;
  order_type?: string | null;
  guest_count?: number | null;
  warehouse_id?: string | null;
  sent?: KitchenSendItem[];
  items_sent_count?: number;
  all_sent?: boolean;
  inventory_deducted?: boolean;
  product_id?: string | null;
  product_name?: string | null;
  error?: string;
  detail?: string;
  dispatch?: KitchenStationDispatchSummary;
}

export interface PosRealtimeData {
  orders: Order[];
  tables: DiningTable[];
  orderItems: OrderItem[];
  kitchenSends: OrderKitchenSend[];
}
