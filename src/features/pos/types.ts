import type { DiningTable, Order, OrderItem, ProductModifierSnapshot, RpcResult } from '@/lib/types';

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
  /** Cumulative quantity sent for this order item after this delta. Used to distinguish incremental sends safely. */
  current_quantity?: number;
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
  /** Prevent automatic duplicate paper when the server print may already exist. */
  suppress_kitchen_browser_popup?: boolean;
}

export interface PosRealtimeData {
  orders: Order[];
  tables: DiningTable[];
  orderItems: OrderItem[];
  kitchenSends: OrderKitchenSend[];
  /** All branch open/held order ids, including empty shells hidden from operational UI. */
  watchedOrderIds: string[];
}

export interface PosItemTransferRequest {
  operation_id: string;
  quantities: Array<{
    order_item_id: string;
    quantity: number;
    expected: Pick<OrderItem, 'quantity' | 'product_id' | 'unit_name' | 'unit_price' | 'discount_amount' | 'bonus_quantity'> & {
      notes: string;
      modifier_option_ids: string[];
    };
  }>;
}

export interface PosItemTransferSnapshot extends Pick<PosRealtimeData, 'orders' | 'tables' | 'orderItems' | 'kitchenSends'> {
  order_ids: string[];
}

export interface PosItemTransferResult extends RpcResult {
  source_order_id?: string;
  target_order_id?: string;
  target_order_number?: string;
  moved_item_count?: number;
  source_order_empty?: boolean;
  inventory_changed?: boolean;
  kds_changed?: boolean;
  replayed?: boolean;
  quantity_transfers?: Array<{ source_item_id: string; moved_item_id: string; quantity: number }>;
  snapshot?: PosItemTransferSnapshot;
}
